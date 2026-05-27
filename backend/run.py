"""启动入口，端口等参数从 config.yaml 读取。"""

import uvicorn

from backend.config import settings

if __name__ == "__main__":
    uvicorn.run(
        "backend.main:app",
        host=settings.server_host,
        port=settings.server_port,
        reload=settings.server_reload,
    )
