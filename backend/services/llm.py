import json
import logging
from collections.abc import AsyncIterator
from typing import Any

import httpx

from backend.config import settings
from backend.services import prompts, storage
from backend.services.json_util import extract_json_object, extract_partial_json_string
from backend.services.module_html import WikiFormatError

logger = logging.getLogger(__name__)


def _completion_payload(
    messages: list[dict[str, str]], temperature: float | None, *, stream: bool
) -> dict[str, Any]:
    payload: dict[str, Any] = {
        "model": settings.llm_model,
        "messages": messages,
        "temperature": temperature if temperature is not None else settings.llm_temperature_default,
        "stream": stream,
    }
    if settings.llm_json_mode:
        payload["response_format"] = {"type": "json_object"}
    return payload


def _completion_headers() -> dict[str, str]:
    api_key = settings.llm_api_key
    if not api_key:
        raise RuntimeError("未配置 LLM API Key，请在 config.yaml 的 llm.api_key 中设置")
    return {
        "Authorization": f"Bearer {api_key}",
        "Content-Type": "application/json",
    }


async def _iter_completion_chunks(
    messages: list[dict[str, str]], temperature: float | None = None
) -> AsyncIterator[str]:
    url = f"{settings.llm_api_base.rstrip('/')}/chat/completions"
    payload = _completion_payload(messages, temperature, stream=True)
    headers = _completion_headers()

    async with httpx.AsyncClient(timeout=settings.llm_timeout) as client:
        async with client.stream("POST", url, json=payload, headers=headers) as resp:
            resp.raise_for_status()
            async for line in resp.aiter_lines():
                if not line or not line.startswith("data:"):
                    continue
                data = line[5:].strip()
                if data == "[DONE]":
                    break
                try:
                    chunk = json.loads(data)
                except json.JSONDecodeError:
                    continue
                choices = chunk.get("choices") or []
                if not choices:
                    continue
                delta = choices[0].get("delta") or {}
                content = delta.get("content")
                if content:
                    yield content


async def _chat_completion(messages: list[dict[str, str]], temperature: float | None = None) -> str:
    parts: list[str] = []
    async for piece in _iter_completion_chunks(messages, temperature):
        parts.append(piece)
    return "".join(parts)


def _recent_turns(messages: list[dict], limit: int | None = None) -> list[dict[str, str]]:
    limit = limit or settings.recent_turns_limit
    pairs: list[dict[str, str]] = []
    for m in messages:
        if m["role"] in ("user", "assistant"):
            pairs.append({"role": m["role"], "content": m["content"]})
    return pairs[-limit:]


def _format_turns(turns: list[dict[str, str]]) -> str:
    return "\n".join(f"{t['role']}: {t['content']}" for t in turns)


def format_route_thinking(thinking: Any) -> str:
    """将路由 CoT 格式化为界面可读的折叠正文。"""
    if not thinking:
        return ""
    if isinstance(thinking, dict):
        labels = (
            ("user_intent", "用户意图"),
            ("module_scan", "已有模块"),
            ("relevance", "相关性判断"),
            ("conclusion", "结论"),
        )
        parts: list[str] = []
        for key, label in labels:
            val = thinking.get(key)
            if val:
                parts.append(f"{label}：{val}")
        return "\n\n".join(parts)
    return str(thinking).strip()


def _log_thinking(stage: str, thinking: Any) -> None:
    if not thinking:
        return
    if isinstance(thinking, dict):
        text = json.dumps(thinking, ensure_ascii=False, indent=2)
    else:
        text = str(thinking).strip()
    if text:
        logger.info("[%s] CoT thinking:\n%s", stage, text)


def _normalize_route_result(result: dict[str, Any], username: str) -> dict[str, Any]:
    _log_thinking("module_router", result.get("thinking"))
    related = result.get("related_modules", [])
    valid = {m["id"] for m in storage.list_modules(username)}
    result["related_modules"] = [m for m in related if m in valid]
    if not result.get("reason") and result.get("thinking"):
        thinking = result["thinking"]
        if isinstance(thinking, dict):
            result["reason"] = thinking.get("conclusion") or thinking.get("user_intent") or ""
        else:
            result["reason"] = str(thinking)[:200]
    if not result.get("route_thought"):
        result["route_thought"] = result.get("reason") or format_route_thinking(result.get("thinking"))[:280]
    result["thinking_text"] = format_route_thinking(result.get("thinking"))
    return result


def _build_route_messages(
    recent_messages: list[dict], user_input: str, username: str
) -> list[dict[str, str]]:
    existing = [m["id"] for m in storage.list_modules(username)]
    turns_text = _format_turns(_recent_turns(recent_messages))
    system = prompts.load_prompt("module_router_system")
    user = prompts.render_prompt(
        "module_router_user",
        existing_modules=json.dumps(existing, ensure_ascii=False),
        turns_text=turns_text,
        user_input=user_input,
    )
    return [{"role": "system", "content": system}, {"role": "user", "content": user}]


def _build_chat_messages(
    recent_messages: list[dict],
    user_input: str,
    related_module_ids: list[str],
    username: str,
) -> list[dict[str, str]]:
    turns_text = _format_turns(_recent_turns(recent_messages))
    modules_context = []
    for mid in related_module_ids:
        try:
            html = storage.read_module(mid, username)
            modules_context.append(f"### 模块【{mid}】\n{html}")
        except FileNotFoundError:
            pass
    modules_block = (
        "\n\n".join(modules_context) if modules_context else settings.empty_modules_hint
    )
    system = prompts.render_prompt("chat_memory_system", username=username)
    system += "\n\n" + prompts.load_prompt("module_content_format")
    user = prompts.render_prompt(
        "chat_memory_user",
        modules_block=modules_block,
        turns_text=turns_text,
        user_input=user_input,
    )
    return [{"role": "system", "content": system}, {"role": "user", "content": user}]


def _normalize_chat_result(result: dict[str, Any], raw: str) -> dict[str, Any]:
    _log_thinking("chat_memory", result.get("thinking"))
    if "reply" not in result:
        result["reply"] = raw
    if "module_updates" not in result:
        result["module_updates"] = []
    return result


def _sse_line(payload: dict[str, Any]) -> str:
    return f"data: {json.dumps(payload, ensure_ascii=False)}\n\n"


async def iter_chat_sse(username: str, user_text: str) -> AsyncIterator[str]:
    """完整聊天流水线：路由 → 对话，以 SSE 事件推送。"""
    messages = storage.load_today_messages(username)
    storage.append_message("user", user_text, username)

    try:
        yield _sse_line({"type": "route_start"})

        route_buf = ""
        last_thought = ""
        route_messages = _build_route_messages(messages, user_text, username)
        async for piece in _iter_completion_chunks(
            route_messages, temperature=settings.llm_temperature_router
        ):
            route_buf += piece
            thought = extract_partial_json_string(route_buf, "route_thought")
            if thought is not None and thought != last_thought:
                last_thought = thought
                yield _sse_line({"type": "route_thought_delta", "text": thought})

        route = _normalize_route_result(extract_json_object(route_buf), username)
        related = route.get("related_modules", [])
        yield _sse_line(
            {
                "type": "route_done",
                "related_modules": related,
                "route_reason": route.get("reason", ""),
                "route_thought": route.get("route_thought", ""),
                "thinking_text": route.get("thinking_text", ""),
            }
        )

        yield _sse_line({"type": "chat_start"})

        chat_buf = ""
        last_reply = ""
        chat_messages = _build_chat_messages(messages, user_text, related, username)
        async for piece in _iter_completion_chunks(
            chat_messages, temperature=settings.llm_temperature_chat
        ):
            chat_buf += piece
            reply = extract_partial_json_string(chat_buf, "reply")
            if reply is not None and reply != last_reply:
                last_reply = reply
                yield _sse_line({"type": "reply_delta", "text": reply})

        chat_result = _normalize_chat_result(extract_json_object(chat_buf), chat_buf)
        reply = chat_result.get("reply", "")
        changed = apply_module_updates(chat_result.get("module_updates", []), username)
        storage.append_message("assistant", reply, username)

        yield _sse_line(
            {
                "type": "chat_done",
                "reply": reply,
                "related_modules": related,
                "route_reason": route.get("reason", ""),
                "route_thought": route.get("route_thought", ""),
                "module_changes": changed,
                "modules": storage.list_modules(username),
            }
        )
    except Exception as e:
        logger.exception("chat stream failed")
        yield _sse_line({"type": "error", "message": str(e)})


async def route_related_modules(
    recent_messages: list[dict], user_input: str, username: str
) -> dict[str, Any]:
    route_buf = ""
    async for piece in _iter_completion_chunks(
        _build_route_messages(recent_messages, user_input, username),
        temperature=settings.llm_temperature_router,
    ):
        route_buf += piece
    return _normalize_route_result(extract_json_object(route_buf), username)


async def chat_with_memory(
    recent_messages: list[dict],
    user_input: str,
    related_module_ids: list[str],
    username: str,
) -> dict[str, Any]:
    chat_buf = ""
    async for piece in _iter_completion_chunks(
        _build_chat_messages(recent_messages, user_input, related_module_ids, username),
        temperature=settings.llm_temperature_chat,
    ):
        chat_buf += piece
    return _normalize_chat_result(extract_json_object(chat_buf), chat_buf)


def apply_module_updates(updates: list[dict[str, Any]], username: str) -> list[str]:
    changed: list[str] = []
    for u in updates:
        action = u.get("action", "update")
        module_id = u.get("module_id") or u.get("id")
        if not module_id:
            continue
        module_id = storage.sanitize_module_id(str(module_id))
        if action == "delete":
            storage.delete_module(module_id, username)
            changed.append(f"deleted:{module_id}")
        elif action in ("create", "update"):
            html = u.get("content_html", "")
            if not html:
                continue
            try:
                storage.write_module(module_id, html, username)
                changed.append(f"{action}:{module_id}")
            except WikiFormatError as e:
                logger.error(
                    "丢弃不合规的 module_update [module_id=%s action=%s]: %s",
                    module_id,
                    action,
                    e,
                )
    return changed
