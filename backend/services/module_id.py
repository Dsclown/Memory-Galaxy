"""模块 ID：仅英文文件名，中文标题写在 HTML 内。"""

from __future__ import annotations

import re

# 小写字母开头，仅 a-z 0-9 _ -
MODULE_ID_PATTERN = re.compile(r"^[a-z][a-z0-9_-]{0,31}$")

TITLE_IN_HTML_RE = re.compile(
    r'<article[^>]*\sdata-title=["\']([^"\']+)["\']',
    re.IGNORECASE,
)
FIRST_H3_RE = re.compile(r"<h3[^>]*>([^<]+)</h3>", re.IGNORECASE)


def sanitize_module_id(name: str) -> str:
    name = name.strip().lower().replace(" ", "_")
    if not name or not MODULE_ID_PATTERN.match(name):
        raise ValueError(
            "模块 ID 须为英文 slug：小写字母开头，仅含 a-z、0-9、下划线、连字符，"
            "例如 hobbies、work_experience；中文标题请写在模块 HTML 的 data-title 中"
        )
    return name


def extract_module_title(html: str, fallback_id: str) -> str:
    m = TITLE_IN_HTML_RE.search(html)
    if m:
        return m.group(1).strip()
    m = FIRST_H3_RE.search(html)
    if m:
        return m.group(1).strip()
    return fallback_id


def ensure_data_title(html: str, title: str | None, module_id: str) -> str:
    """确保 article 带有 data-title（中文展示名）。"""
    display = (title or "").strip() or module_id
    if TITLE_IN_HTML_RE.search(html):
        return html
    if re.search(r"<article[^>]*class=[\"']wiki-doc[\"']", html, re.I):
        return re.sub(
            r"(<article\s+class=[\"']wiki-doc[\"'])",
            rf'\1 data-title="{_escape_attr(display)}"',
            html,
            count=1,
            flags=re.I,
        )
    return html


def _escape_attr(s: str) -> str:
    return s.replace("&", "&amp;").replace('"', "&quot;").replace("<", "&lt;")
