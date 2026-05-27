import re
from contextvars import ContextVar
from urllib.parse import quote, unquote

from backend.config import settings

_current_username: ContextVar[str | None] = ContextVar("current_username", default=None)
_current_username_pattern: re.Pattern[str] | None = None


def _username_pattern() -> re.Pattern[str]:
    global _current_username_pattern
    if _current_username_pattern is None:
        lo = settings.username_min_length
        hi = settings.username_max_length
        _current_username_pattern = re.compile(rf"^[\w\u4e00-\u9fff\-]{{{lo},{hi}}}$")
    return _current_username_pattern


def sanitize_username(name: str) -> str:
    name = name.strip()
    lo = settings.username_min_length
    hi = settings.username_max_length
    if not name or not _username_pattern().match(name):
        raise ValueError(
            f"用户名须为 {lo}–{hi} 位，仅支持中文、字母、数字、下划线、连字符"
        )
    return name


def username_to_dirname(username: str) -> str:
    """文件系统目录名（可逆编码，支持中文）。"""
    return quote(sanitize_username(username), safe="")


def dirname_to_username(dirname: str) -> str:
    return unquote(dirname)


def set_current_user(username: str) -> None:
    _current_username.set(sanitize_username(username))


def get_current_user() -> str:
    user = _current_username.get()
    if not user:
        raise RuntimeError("未设置当前用户")
    return user


def clear_current_user() -> None:
    _current_username.set(None)
