const ChatUI = (() => {
  const box = () => document.getElementById("chat-messages");
  function renderMessages(messages) {
    const el = box();
    el.innerHTML = "";
    for (const m of messages) {
      appendBubble(m.role, m.content, false);
    }
    el.scrollTop = el.scrollHeight;
  }

  function appendBubble(role, content, scroll = true) {
    const el = box();
    const div = document.createElement("div");
    div.className = `msg ${role}`;
    const label = role === "user" ? "你" : "助手";
    div.innerHTML = `<div class="meta">${label}</div>${escapeHtml(content)}`;
    el.appendChild(div);
    if (scroll) el.scrollTop = el.scrollHeight;
    return div;
  }

  function escapeHtml(s) {
    return String(s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/\n/g, "<br>");
  }

  function scrollToBottom() {
    box().scrollTop = box().scrollHeight;
  }

  function bindThinkingToggle(wrap) {
    const toggle = wrap.querySelector(".thinking-toggle");
    const body = wrap.querySelector(".thinking-body");
    if (!toggle || !body) return;
    toggle.addEventListener("click", () => {
      const open = toggle.getAttribute("aria-expanded") === "true";
      toggle.setAttribute("aria-expanded", open ? "false" : "true");
      body.classList.toggle("is-collapsed", open);
      body.hidden = open;
      const chev = toggle.querySelector(".thinking-chevron");
      if (chev) chev.textContent = open ? "▸" : "▾";
    });
  }

  /** 单条助手消息：Thinking（可折叠）+ 流式/最终回复 */
  function appendAssistantBlock() {
    const el = box();
    const div = document.createElement("div");
    div.className = "msg assistant msg-assistant-block";
    div.innerHTML =
      '<div class="meta">助手</div>' +
      '<div class="assistant-block">' +
      '<div class="thinking-wrap">' +
      '<button type="button" class="thinking-toggle" aria-expanded="false">' +
      '<span class="thinking-toggle-label">Thinking</span> <span class="thinking-chevron">▸</span>' +
      "</button>" +
      '<div class="thinking-body is-collapsed" hidden></div>' +
      '<div class="thinking-status"><span class="thinking-dot"></span>正在分析相关模块…</div>' +
      "</div>" +
      '<div class="reply-stream hidden"></div>' +
      "</div>";
    el.appendChild(div);
    bindThinkingToggle(div.querySelector(".thinking-wrap"));
    scrollToBottom();
    return div;
  }

  function setThinkingStatus(blockEl, text, loading = false) {
    if (!blockEl) return;
    const status = blockEl.querySelector(".thinking-status");
    if (!status) return;
    if (!text) {
      status.classList.add("hidden");
      status.innerHTML = "";
      status.style.display = "none";
      return;
    }
    status.style.display = "";
    status.classList.remove("hidden");
    const dot = loading ? '<span class="thinking-dot"></span>' : "";
    status.innerHTML = `${dot}${escapeHtml(text)}`;
    scrollToBottom();
  }

  function updateRouteThoughtPreview(blockEl, text) {
    if (!blockEl || !text) return;
    const body = blockEl.querySelector(".thinking-body");
    if (!body) return;
    body.innerHTML = escapeHtml(text);
    body.classList.remove("is-collapsed");
    body.hidden = false;
    const toggle = blockEl.querySelector(".thinking-toggle");
    if (toggle) toggle.setAttribute("aria-expanded", "true");
    const chev = blockEl.querySelector(".thinking-chevron");
    if (chev) chev.textContent = "▾";
    scrollToBottom();
  }

  function showReplyArea(blockEl) {
    if (!blockEl) return;
    const reply = blockEl.querySelector(".reply-stream");
    if (reply) reply.classList.remove("hidden");
  }

  function updateStreamingReply(blockEl, text) {
    if (!blockEl) return;
    showReplyArea(blockEl);
    const target = blockEl.querySelector(".reply-stream");
    if (target) {
      target.innerHTML = text ? escapeHtml(text) : '<span class="reply-placeholder">…</span>';
    }
    scrollToBottom();
  }

  function finalizeStreamingReply(blockEl, text) {
    if (!blockEl) return;
    blockEl.classList.remove("is-streaming");
    updateStreamingReply(blockEl, text);
  }

  function finishRouteThinking(blockEl, route) {
    if (!blockEl) return;
    const body = blockEl.querySelector(".thinking-body");
    const toggle = blockEl.querySelector(".thinking-toggle");

    const thought = route.route_thought || route.route_reason || "";
    const detail = route.thinking_text || "";
    const related = route.related_modules || [];

    const lines = [];
    if (thought) lines.push(thought);
    if (detail && detail !== thought) lines.push(detail);
    if (related.length) {
      lines.push(`关联模块：${related.join("、")}`);
    } else if (thought || detail) {
      lines.push("关联模块：（无）");
    }
    const full = lines.join("\n\n");

    if (body) {
      body.innerHTML = full ? escapeHtml(full) : '<span class="thinking-empty">暂无详细推理</span>';
      body.classList.add("is-collapsed");
      body.hidden = true;
    }
    if (toggle) {
      toggle.setAttribute("aria-expanded", "false");
      const chev = toggle.querySelector(".thinking-chevron");
      if (chev) chev.textContent = "▸";
    }

    setThinkingStatus(blockEl, "", false);
    blockEl.classList.add("thinking-done");
    scrollToBottom();
  }

  function setLoading(loading) {
    const btn = document.getElementById("send-btn");
    const input = document.getElementById("chat-input");
    btn.disabled = loading;
    input.disabled = loading;
  }

  return {
    renderMessages,
    appendBubble,
    appendAssistantBlock,
    setThinkingStatus,
    updateRouteThoughtPreview,
    finishRouteThinking,
    updateStreamingReply,
    finalizeStreamingReply,
    setLoading,
  };
})();
