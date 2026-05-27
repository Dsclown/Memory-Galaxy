from fastapi import HTTPException, Request

from backend.services import auth_context


def get_session_user(request: Request) -> str | None:
    raw = request.session.get("username")
    if not raw:
        return None
    try:
        return auth_context.sanitize_username(str(raw))
    except ValueError:
        return None


async def require_user(request: Request) -> str:
    """须为 async：同步依赖在线程池执行，ContextVar 无法传回路由协程。"""
    user = get_session_user(request)
    if not user:
        raise HTTPException(status_code=401, detail="请先登录")
    auth_context.set_current_user(user)
    return user
