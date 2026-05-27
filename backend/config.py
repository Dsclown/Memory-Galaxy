from __future__ import annotations

from functools import lru_cache
from pathlib import Path
from typing import Any

import yaml
from pydantic import BaseModel, Field

PROJECT_ROOT = Path(__file__).resolve().parent.parent
CONFIG_FILE = PROJECT_ROOT / "config.yaml"


class ServerConfig(BaseModel):
    host: str = "0.0.0.0"
    port: int = 8765
    reload: bool = True


class LLMTemperatureConfig(BaseModel):
    router: float = 0.1
    chat: float = 0.5
    default: float = 0.3


class LLMConfig(BaseModel):
    api_base: str = "https://api.openai.com/v1"
    api_key: str = ""
    model: str = "gpt-4o-mini"
    timeout: float = 120.0
    json_mode: bool = True  # OpenAI 兼容接口：强制 JSON 输出
    stream: bool = True  # 使用 SSE 流式输出
    temperature: LLMTemperatureConfig = Field(default_factory=LLMTemperatureConfig)


class ChatConfig(BaseModel):
    recent_turns_limit: int = 5
    empty_modules_hint: str = "（无相关已有模块）"


class AuthConfig(BaseModel):
    session_secret: str = "memory-galaxy-dev-secret-change-me"
    username_min_length: int = 2
    username_max_length: int = 24


class DataConfig(BaseModel):
    dir: str = "data"


class PromptsConfig(BaseModel):
    dir: str = "prompts"


class Settings(BaseModel):
    """从 config.yaml 加载的运行时配置。"""

    server: ServerConfig = Field(default_factory=ServerConfig)
    llm: LLMConfig = Field(default_factory=LLMConfig)
    chat: ChatConfig = Field(default_factory=ChatConfig)
    auth: AuthConfig = Field(default_factory=AuthConfig)
    data: DataConfig = Field(default_factory=DataConfig)
    prompts: PromptsConfig = Field(default_factory=PromptsConfig)

    @property
    def server_host(self) -> str:
        return self.server.host

    @property
    def server_port(self) -> int:
        return self.server.port

    @property
    def server_reload(self) -> bool:
        return self.server.reload

    @property
    def llm_api_base(self) -> str:
        return self.llm.api_base

    @property
    def llm_api_key(self) -> str:
        return self.llm.api_key

    @property
    def llm_model(self) -> str:
        return self.llm.model

    @property
    def llm_timeout(self) -> float:
        return self.llm.timeout

    @property
    def llm_json_mode(self) -> bool:
        return self.llm.json_mode

    @property
    def llm_stream(self) -> bool:
        return self.llm.stream

    @property
    def llm_temperature_router(self) -> float:
        return self.llm.temperature.router

    @property
    def llm_temperature_chat(self) -> float:
        return self.llm.temperature.chat

    @property
    def llm_temperature_default(self) -> float:
        return self.llm.temperature.default

    @property
    def session_secret(self) -> str:
        return self.auth.session_secret

    @property
    def recent_turns_limit(self) -> int:
        return self.chat.recent_turns_limit

    @property
    def empty_modules_hint(self) -> str:
        return self.chat.empty_modules_hint

    @property
    def username_min_length(self) -> int:
        return self.auth.username_min_length

    @property
    def username_max_length(self) -> int:
        return self.auth.username_max_length

    @property
    def data_path(self) -> Path:
        p = Path(self.data.dir)
        if not p.is_absolute():
            p = PROJECT_ROOT / p
        return p

    @property
    def prompts_path(self) -> Path:
        p = Path(self.prompts.dir)
        if not p.is_absolute():
            p = PROJECT_ROOT / p
        return p


def _load_config_file() -> Settings:
    if not CONFIG_FILE.exists():
        return Settings()
    with CONFIG_FILE.open(encoding="utf-8") as f:
        raw: dict[str, Any] = yaml.safe_load(f) or {}
    return Settings.model_validate(raw)


@lru_cache
def get_settings() -> Settings:
    return _load_config_file()


settings = get_settings()
