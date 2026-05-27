"""记忆模块 HTML：Wiki 格式校验（不合规则拒绝，不做自动转换）。"""

from __future__ import annotations

import html
import logging
import re

from backend.services.module_id import ensure_data_title

logger = logging.getLogger(__name__)

ARTICLE_RE = re.compile(
    r'<article[^>]*class=["\'][^"\']*\bwiki-doc\b',
    re.IGNORECASE,
)
SECTION_RE = re.compile(
    r'<section[^>]*class=["\'][^"\']*\bwiki-section\b',
    re.IGNORECASE,
)
H3_RE = re.compile(r"<h3[^>]*>", re.IGNORECASE)
BODY_BLOCK_RE = re.compile(r"<(p|table|ul|ol|dl)\b", re.IGNORECASE)


class WikiFormatError(ValueError):
    """模块 HTML 不符合 Wiki 结构要求。"""


def wiki_empty_doc(module_id: str = "module", title: str | None = None) -> str:
    t = title or module_id
    return f"""<article class="wiki-doc" data-title="{html.escape(t, quote=True)}">
<section class="wiki-section"><h3>概览</h3><p></p></section>
</article>"""


def validate_wiki_html(content: str) -> tuple[bool, str]:
    c = content.strip()
    if not c:
        return False, "内容为空"
    if not ARTICLE_RE.search(c):
        return False, '缺少 <article class="wiki-doc">'
    if not SECTION_RE.search(c):
        return False, '缺少 <section class="wiki-section">'
    if not H3_RE.search(c):
        return False, "缺少分节标题 <h3>"
    if not BODY_BLOCK_RE.search(c):
        return False, "缺少正文块（p / table / ul / ol / dl）"
    return True, ""


def prepare_module_html(
    content: str,
    module_id: str = "module",
    title: str | None = None,
) -> str:
    """校验 Wiki 格式，通过则补全 data-title 并返回；否则记录日志并抛出 WikiFormatError。"""
    ok, reason = validate_wiki_html(content)
    if not ok:
        preview = content.strip().replace("\n", " ")[:240]
        logger.error(
            "模块 HTML 格式不合规 [module_id=%s] %s | 片段: %s",
            module_id,
            reason,
            preview,
        )
        raise WikiFormatError(reason)
    return ensure_data_title(content.strip(), title, module_id)
