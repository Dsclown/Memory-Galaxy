import json
from datetime import date, datetime
from pathlib import Path
from typing import Any

from backend.config import settings
from backend.services import auth_context
from backend.services.module_html import WikiFormatError, prepare_module_html
from backend.services.module_id import (
    MODULE_ID_PATTERN,
    extract_module_title,
    sanitize_module_id,
)

def _resolve_username(username: str | None = None) -> str:
    if username:
        return auth_context.sanitize_username(username)
    return auth_context.get_current_user()


def _user_root(username: str | None = None) -> Path:
    name = _resolve_username(username)
    return settings.data_path / "users" / auth_context.username_to_dirname(name)


def chats_path(username: str | None = None) -> Path:
    return _user_root(username) / "chats"


def modules_path(username: str | None = None) -> Path:
    return _user_root(username) / "modules"


def _ensure_dirs(username: str | None = None) -> None:
    chats_path(username).mkdir(parents=True, exist_ok=True)
    modules_path(username).mkdir(parents=True, exist_ok=True)


def ensure_user_storage(username: str) -> None:
    username = auth_context.sanitize_username(username)
    _ensure_dirs(username)
    profile = _user_root(username) / "profile.json"
    if not profile.exists():
        profile.write_text(
            json.dumps(
                {"username": username, "created_at": datetime.now().isoformat(timespec="seconds")},
                ensure_ascii=False,
                indent=2,
            ),
            encoding="utf-8",
        )


def today_chat_file(username: str | None = None) -> Path:
    _ensure_dirs(username)
    return chats_path(username) / f"{date.today().isoformat()}.json"


def load_today_messages(username: str | None = None) -> list[dict[str, Any]]:
    path = today_chat_file(username)
    if not path.exists():
        return []
    with path.open(encoding="utf-8") as f:
        return json.load(f)


def append_message(role: str, content: str, username: str | None = None) -> dict[str, Any]:
    messages = load_today_messages(username)
    entry = {
        "role": role,
        "content": content,
        "timestamp": datetime.now().isoformat(timespec="seconds"),
    }
    messages.append(entry)
    with today_chat_file(username).open("w", encoding="utf-8") as f:
        json.dump(messages, f, ensure_ascii=False, indent=2)
    return entry


def list_chat_dates(username: str | None = None) -> list[str]:
    _ensure_dirs(username)
    dates = []
    for p in sorted(chats_path(username).glob("*.json")):
        dates.append(p.stem)
    return dates


def load_chat_by_date(day: str, username: str | None = None) -> list[dict[str, Any]]:
    path = chats_path(username) / f"{day}.json"
    if not path.exists():
        return []
    with path.open(encoding="utf-8") as f:
        return json.load(f)


def list_modules(username: str | None = None) -> list[dict[str, str]]:
    _ensure_dirs(username)
    modules = []
    for p in sorted(modules_path(username).glob("*.html")):
        module_id = p.stem
        if not MODULE_ID_PATTERN.match(module_id):
            continue
        raw = p.read_text(encoding="utf-8")
        title = extract_module_title(raw, module_id)
        modules.append(
            {
                "id": module_id,
                "title": title,
                "updated_at": datetime.fromtimestamp(p.stat().st_mtime).isoformat(
                    timespec="seconds"
                ),
            }
        )
    return modules


def read_module(module_id: str, username: str | None = None) -> str:
    module_id = sanitize_module_id(module_id)
    path = modules_path(username) / f"{module_id}.html"
    if not path.exists():
        raise FileNotFoundError(module_id)
    raw = path.read_text(encoding="utf-8")
    title = extract_module_title(raw, module_id)
    return prepare_module_html(raw, module_id, title)


def write_module(module_id: str, content_html: str, username: str | None = None) -> None:
    module_id = sanitize_module_id(module_id)
    _ensure_dirs(username)
    title = extract_module_title(content_html, module_id)
    html = prepare_module_html(content_html, module_id, title)
    path = modules_path(username) / f"{module_id}.html"
    path.write_text(html, encoding="utf-8")


def delete_module(module_id: str, username: str | None = None) -> None:
    module_id = sanitize_module_id(module_id)
    path = modules_path(username) / f"{module_id}.html"
    if path.exists():
        path.unlink()
