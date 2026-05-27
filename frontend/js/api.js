const API = {
  _headers() {
    const h = { "Content-Type": "application/json" };
    return h;
  },

  _opts(method, body) {
    const opts = {
      method,
      credentials: "include",
      headers: this._headers(),
    };
    if (body !== undefined) {
      opts.body = JSON.stringify(body);
    }
    return opts;
  },

  async _parseError(r) {
    const err = await r.json().catch(() => ({}));
    const e = new Error(err.detail || r.statusText);
    e.status = r.status;
    return e;
  },

  async get(path) {
    const r = await fetch(path, { credentials: "include" });
    if (!r.ok) throw await this._parseError(r);
    return r.json();
  },

  async post(path, body) {
    const r = await fetch(path, this._opts("POST", body));
    if (!r.ok) throw await this._parseError(r);
    return r.json();
  },

  async put(path, body) {
    const r = await fetch(path, this._opts("PUT", body));
    if (!r.ok) throw await this._parseError(r);
    return r.json();
  },

  async del(path) {
    const r = await fetch(path, { credentials: "include", method: "DELETE" });
    if (!r.ok) throw await this._parseError(r);
    return r.json();
  },

  /**
   * SSE 流式聊天。onEvent({ type, ... }) 类型：
   * route_start | route_thought_delta | route_done | chat_start | reply_delta | chat_done | error
   */
  async streamChat(message, onEvent) {
    const r = await fetch("/api/chat/stream", this._opts("POST", { message }));
    if (!r.ok) throw await this._parseError(r);
    if (!r.body) throw new Error("浏览器不支持流式响应");

    const reader = r.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    const dispatchBlock = (block) => {
      for (const line of block.split("\n")) {
        const trimmed = line.trim();
        if (!trimmed.startsWith("data:")) continue;
        const jsonStr = trimmed.slice(5).trim();
        if (!jsonStr) continue;
        let payload;
        try {
          payload = JSON.parse(jsonStr);
        } catch {
          continue;
        }
        onEvent(payload);
        if (payload.type === "error") {
          throw new Error(payload.message || "流式请求失败");
        }
      }
    };

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const blocks = buffer.split("\n\n");
      buffer = blocks.pop() || "";
      for (const block of blocks) dispatchBlock(block);
    }
    if (buffer.trim()) dispatchBlock(buffer);
  },
};
