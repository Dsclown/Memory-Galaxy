"""解析 LLM 返回的 JSON（兼容单引号、代码块包裹等常见格式）。"""

from __future__ import annotations

import ast
import json
import re
from typing import Any

JSON_BLOCK_RE = re.compile(r"```(?:json)?\s*([\s\S]*?)\s*```", re.IGNORECASE)


def _try_parse_object(text: str) -> dict[str, Any]:
    text = text.strip()
    if not text:
        raise ValueError("空字符串")

    try:
        obj = json.loads(text)
        if isinstance(obj, dict):
            return obj
    except json.JSONDecodeError:
        pass

    try:
        obj = ast.literal_eval(text)
        if isinstance(obj, dict):
            return obj
    except (ValueError, SyntaxError):
        pass

    raise ValueError("不是合法 JSON 对象")


def extract_json_object(text: str) -> dict[str, Any]:
    """从 LLM 原始输出中提取并解析 JSON 对象。"""
    raw = text.strip()
    if not raw:
        raise ValueError("LLM 返回为空")

    candidates: list[str] = [raw]
    m = JSON_BLOCK_RE.search(raw)
    if m:
        candidates.insert(0, m.group(1).strip())
    start = raw.find("{")
    end = raw.rfind("}")
    if start != -1 and end > start:
        candidates.append(raw[start : end + 1])

    seen: set[str] = set()
    errors: list[str] = []
    for cand in candidates:
        if cand in seen:
            continue
        seen.add(cand)
        try:
            return _try_parse_object(cand)
        except ValueError as e:
            errors.append(str(e))

    preview = raw[:400].replace("\n", "\\n")
    raise ValueError(f"无法解析 JSON（{'; '.join(errors)}）; 原文片段: {preview}")


def extract_partial_json_string(text: str, field: str) -> str | None:
    """从流式生成中的 JSON 文本提取某字符串字段的已输出前缀（可未闭合）。"""
    marker = f'"{field}"'
    idx = text.find(marker)
    if idx < 0:
        return None
    i = idx + len(marker)
    n = len(text)
    while i < n and text[i] in " \t\r\n":
        i += 1
    if i >= n or text[i] != ":":
        return None
    i += 1
    while i < n and text[i] in " \t\r\n":
        i += 1
    if i >= n or text[i] != '"':
        return None
    i += 1
    out: list[str] = []
    escapes = {"n": "\n", "t": "\t", "r": "\r", '"': '"', "\\": "\\", "/": "/"}
    while i < n:
        ch = text[i]
        if ch == '"':
            break
        if ch == "\\":
            if i + 1 >= n:
                break
            nxt = text[i + 1]
            if nxt in escapes:
                out.append(escapes[nxt])
                i += 2
                continue
            if nxt == "u" and i + 5 < n:
                try:
                    out.append(chr(int(text[i + 2 : i + 6], 16)))
                    i += 6
                    continue
                except ValueError:
                    pass
            out.append(nxt)
            i += 2
            continue
        out.append(ch)
        i += 1
    return "".join(out)
