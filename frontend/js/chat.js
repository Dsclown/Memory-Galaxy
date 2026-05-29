const ChatUI = (() => {
  const box = () => document.getElementById("chat-messages");
  const sidebar = () => document.getElementById("chat-date-sidebar");
  const form = () => document.getElementById("chat-form");
  const readonlyHint = () => document.getElementById("chat-readonly-hint");

  let selectedDate = null;
  let todayDate = null;
  let onDateSelect = null;

  function setTodayDate(iso) {
    todayDate = iso;
  }

  function getSelectedDate() {
    return selectedDate;
  }

  function isViewingToday() {
    return selectedDate && todayDate && selectedDate === todayDate;
  }

  function parseTs(ts) {
    if (!ts) return null;
    const d = new Date(ts);
    return Number.isNaN(d.getTime()) ? null : d;
  }

  function formatTime(ts) {
    const d = parseTs(ts);
    if (!d) return "";
    const h = String(d.getHours()).padStart(2, "0");
    const m = String(d.getMinutes()).padStart(2, "0");
    return `${h}:${m}`;
  }

  function formatDateLabel(iso) {
    if (!iso) return iso;
    if (iso === todayDate) return "今天";
    const d = new Date(`${iso}T12:00:00`);
    if (Number.isNaN(d.getTime())) return iso;
    const now = todayDate ? new Date(`${todayDate}T12:00:00`) : new Date();
    const yesterday = new Date(now);
    yesterday.setDate(yesterday.getDate() - 1);
    const yIso = yesterday.toISOString().slice(0, 10);
    if (iso === yIso) return "昨天";
    if (d.getFullYear() === now.getFullYear()) {
      return `${d.getMonth() + 1}月${d.getDate()}日`;
    }
    return iso;
  }

  function formatWeekday(iso) {
    const d = new Date(`${iso}T12:00:00`);
    if (Number.isNaN(d.getTime())) return "";
    const w = ["日", "一", "二", "三", "四", "五", "六"];
    return `周${w[d.getDay()]}`;
  }

  function renderMeta(role, timestamp) {
    const label = role === "user" ? "你" : "助手";
    const time = formatTime(timestamp);
    const timeHtml = time ? `<span class="msg-time">${time}</span>` : "";
    return `<div class="meta"><span class="msg-role">${label}</span>${timeHtml}</div>`;
  }

  function updateComposerState() {
    const viewingToday = isViewingToday();
    const f = form();
    const hint = readonlyHint();
    if (f) f.classList.toggle("hidden", !viewingToday);
    if (hint) hint.classList.toggle("hidden", viewingToday);
  }

  function renderDateSidebar(dates, activeDate) {
    selectedDate = activeDate;
    const el = sidebar();
    if (!el) return;
    el.innerHTML = "";

    const list = [...(dates || [])].reverse();
    if (todayDate && !list.includes(todayDate)) {
      list.unshift(todayDate);
    }

    if (!list.length && todayDate) {
      list.push(todayDate);
    }

    for (const iso of list) {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "chat-date-item";
      if (iso === activeDate) btn.classList.add("is-active");
      btn.dataset.date = iso;
      const main = formatDateLabel(iso);
      const sub = iso === todayDate || iso === activeDate ? formatWeekday(iso) : iso.slice(5);
      btn.innerHTML =
        `<span class="chat-date-main">${escapeHtml(main)}</span>` +
        `<span class="chat-date-sub">${escapeHtml(sub)}</span>`;
      btn.addEventListener("click", () => {
        if (iso === selectedDate) return;
        if (typeof onDateSelect === "function") onDateSelect(iso);
      });
      el.appendChild(btn);
    }
    updateComposerState();
  }

  function setDateSelectHandler(fn) {
    onDateSelect = fn;
  }

  function renderMessages(messages, activeDate) {
    if (activeDate) selectedDate = activeDate;
    const el = box();
    el.innerHTML = "";
    for (const m of messages) {
      appendBubble(m.role, m.content, { scroll: false, timestamp: m.timestamp });
    }
    el.scrollTop = el.scrollHeight;
    updateComposerState();
  }

  function appendBubble(role, content, opts = {}) {
    const { scroll = true, timestamp = null } = opts;
    const el = box();
    const div = document.createElement("div");
    div.className = `msg ${role}`;
    div.innerHTML = `${renderMeta(role, timestamp)}${escapeHtml(content)}`;
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

  function appendAssistantBlock(timestamp = null) {
    const el = box();
    const div = document.createElement("div");
    div.className = "msg assistant msg-assistant-block";
    const ts = timestamp || new Date().toISOString();
    div.innerHTML =
      renderMeta("assistant", ts) +
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
    if (!isViewingToday()) return;
    btn.disabled = loading;
    input.disabled = loading;
  }

  return {
    setTodayDate,
    getSelectedDate,
    isViewingToday,
    setDateSelectHandler,
    renderDateSidebar,
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
