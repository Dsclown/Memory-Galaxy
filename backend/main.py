from datetime import date
from typing import Annotated

from fastapi import Depends, FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, StreamingResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field
from starlette.middleware.sessions import SessionMiddleware

from backend.config import PROJECT_ROOT, settings
from backend.deps import get_session_user, require_user
from backend.services import auth_context, llm, storage
from backend.services.module_html import WikiFormatError

FRONTEND_DIR = PROJECT_ROOT / "frontend"

app = FastAPI(title="Memory Galaxy", version="0.2.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)
app.add_middleware(SessionMiddleware, secret_key=settings.session_secret, same_site="lax")


class LoginRequest(BaseModel):
    username: str = Field(..., min_length=2, max_length=24)  # 实际校验见 auth_context + config.yaml


class ChatRequest(BaseModel):
    message: str = Field(..., min_length=1)


class ChatCompleteRequest(BaseModel):
    message: str = Field(..., min_length=1)
    related_modules: list[str] = Field(default_factory=list)


class ModuleWriteRequest(BaseModel):
    content_html: str


UserDep = Annotated[str, Depends(require_user)]


@app.get("/api/health")
async def health():
    return {"ok": True}


@app.get("/api/config")
async def get_config():
    return {
        "llm_configured": bool(settings.llm_api_key),
        "model": settings.llm_model,
    }


@app.get("/api/auth/me")
async def auth_me(request: Request):
    user = get_session_user(request)
    if not user:
        raise HTTPException(status_code=401, detail="未登录")
    return {"username": user}


@app.post("/api/auth/login")
async def auth_login(req: LoginRequest, request: Request):
    try:
        username = auth_context.sanitize_username(req.username)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e
    storage.ensure_user_storage(username)
    request.session["username"] = username
    return {"username": username}


@app.post("/api/auth/logout")
async def auth_logout(request: Request):
    request.session.clear()
    return {"ok": True}


@app.get("/api/chats/today")
async def get_today_chat(user: UserDep):
    return {"date": date.today().isoformat(), "messages": storage.load_today_messages(user)}


@app.get("/api/chats/{day}")
async def get_chat_by_day(day: str, user: UserDep):
    return {"date": day, "messages": storage.load_chat_by_date(day, user)}


@app.get("/api/chats")
async def list_chats(user: UserDep):
    return {"dates": storage.list_chat_dates(user)}


@app.post("/api/chat/stream")
async def post_chat_stream(req: ChatRequest, user: UserDep):
    """流式聊天：SSE 推送路由 Thinking 与回复增量。"""
    user_text = req.message.strip()

    async def event_gen():
        async for chunk in llm.iter_chat_sse(user, user_text):
            yield chunk

    return StreamingResponse(
        event_gen(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )


@app.post("/api/chat/route")
async def post_chat_route(req: ChatRequest, user: UserDep):
    """步骤 1：模块路由（用户消息会先写入当日聊天）。"""
    user_text = req.message.strip()
    messages = storage.load_today_messages(user)
    storage.append_message("user", user_text, user)

    try:
        route = await llm.route_related_modules(messages, user_text, user)
    except Exception as e:
        raise HTTPException(status_code=502, detail=str(e)) from e

    return {
        "related_modules": route.get("related_modules", []),
        "route_reason": route.get("reason", ""),
        "route_thought": route.get("route_thought", ""),
        "thinking": route.get("thinking"),
        "thinking_text": route.get("thinking_text", ""),
    }


@app.post("/api/chat/complete")
async def post_chat_complete(req: ChatCompleteRequest, user: UserDep):
    """步骤 2：在已路由的前提下生成回复并更新记忆。"""
    user_text = req.message.strip()
    messages = storage.load_today_messages(user)
    related = req.related_modules

    try:
        result = await llm.chat_with_memory(messages, user_text, related, user)
        reply = result.get("reply", "")
        changed = llm.apply_module_updates(result.get("module_updates", []), user)
    except Exception as e:
        raise HTTPException(status_code=502, detail=str(e)) from e

    storage.append_message("assistant", reply, user)
    return {
        "reply": reply,
        "related_modules": related,
        "module_changes": changed,
        "modules": storage.list_modules(user),
        "username": user,
    }


@app.post("/api/chat")
async def post_chat(req: ChatRequest, user: UserDep):
    """兼容：一次请求完成路由 + 对话（无分步 Thinking UI）。"""
    user_text = req.message.strip()
    messages = storage.load_today_messages(user)
    storage.append_message("user", user_text, user)

    try:
        route = await llm.route_related_modules(messages, user_text, user)
        related = route.get("related_modules", [])
        result = await llm.chat_with_memory(messages, user_text, related, user)
        reply = result.get("reply", "")
        changed = llm.apply_module_updates(result.get("module_updates", []), user)
    except Exception as e:
        raise HTTPException(status_code=502, detail=str(e)) from e

    storage.append_message("assistant", reply, user)
    return {
        "reply": reply,
        "related_modules": related,
        "route_reason": route.get("reason", ""),
        "route_thought": route.get("route_thought", ""),
        "thinking_text": route.get("thinking_text", ""),
        "module_changes": changed,
        "modules": storage.list_modules(user),
        "username": user,
    }


@app.get("/api/modules")
async def list_modules(user: UserDep):
    return {"modules": storage.list_modules(user), "user_name": user}


@app.get("/api/modules/{module_id}")
async def get_module(module_id: str, user: UserDep):
    try:
        content = storage.read_module(module_id, user)
    except WikiFormatError as e:
        raise HTTPException(status_code=422, detail=f"模块文件格式不合规: {e}") from e
    except (FileNotFoundError, ValueError) as e:
        raise HTTPException(status_code=404, detail=str(e)) from e
    return {"id": module_id, "content_html": content}


@app.put("/api/modules/{module_id}")
async def put_module(module_id: str, req: ModuleWriteRequest, user: UserDep):
    try:
        storage.write_module(module_id, req.content_html, user)
    except WikiFormatError as e:
        raise HTTPException(status_code=400, detail=f"Wiki 格式不合规: {e}") from e
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e
    return {"id": module_id, "ok": True}


@app.delete("/api/modules/{module_id}")
async def remove_module(module_id: str, user: UserDep):
    try:
        storage.delete_module(module_id, user)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e
    return {"id": module_id, "deleted": True}


@app.get("/")
async def index():
    return FileResponse(FRONTEND_DIR / "index.html")


if FRONTEND_DIR.exists():
    app.mount("/assets", StaticFiles(directory=FRONTEND_DIR), name="assets")
