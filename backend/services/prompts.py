from functools import lru_cache
from pathlib import Path

from backend.config import settings


class PromptNotFoundError(FileNotFoundError):
    pass


@lru_cache
def _prompts_dir() -> Path:
    path = settings.prompts_path
    if not path.is_dir():
        raise PromptNotFoundError(f"Prompt 目录不存在: {path}")
    return path


def load_prompt(name: str) -> str:
    """读取 prompts/{name}.md，不含扩展名。"""
    path = _prompts_dir() / f"{name}.md"
    if not path.exists():
        raise PromptNotFoundError(f"Prompt 文件不存在: {path}")
    return path.read_text(encoding="utf-8").strip()


def render_prompt(name: str, **kwargs: str) -> str:
    """加载并渲染 prompt，占位符使用 {key} 形式。"""
    return load_prompt(name).format(**kwargs)
