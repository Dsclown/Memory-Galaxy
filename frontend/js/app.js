(async function main() {
  const badge = document.getElementById("status-badge");
  const userBadge = document.getElementById("user-badge");
  const logoutBtn = document.getElementById("logout-btn");
  const appMain = document.getElementById("app-main");
  const loginDialog = document.getElementById("login-dialog");
  let userName = "";

  StarMap.init("galaxy-svg", {
    onModuleOpen: async (id) => {
      const data = await API.get(`/api/modules/${encodeURIComponent(id)}`);
      return data.content_html;
    },
    onModuleSave: async (id, html) => {
      await API.put(`/api/modules/${encodeURIComponent(id)}`, { content_html: html });
      await reloadModules();
    },
    onModuleDelete: async (id) => {
      await API.del(`/api/modules/${encodeURIComponent(id)}`);
      await reloadModules();
    },
  });

  logoutBtn.addEventListener("click", async () => {
    await API.post("/api/auth/logout", {});
    showLogin();
  });

  document.getElementById("login-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const input = document.getElementById("login-username");
    const username = input.value.trim();
    if (!username) return;
    try {
      const res = await API.post("/api/auth/login", { username });
      loginDialog.close();
      await enterApp(res.username);
    } catch (err) {
      alert(err.message);
    }
  });

  try {
    const cfg = await API.get("/api/config");
    badge.textContent = cfg.llm_configured ? `已连接 · ${cfg.model}` : "未配置 API Key";
    badge.classList.add(cfg.llm_configured ? "ok" : "warn");
  } catch {
    badge.textContent = "后端未启动";
    badge.classList.add("warn");
  }

  try {
    const me = await API.get("/api/auth/me");
    await enterApp(me.username);
  } catch (err) {
    if (err.status === 401) {
      showLogin();
    } else {
      console.warn(err);
      showLogin();
    }
  }

  function showLogin() {
    appMain.classList.add("hidden");
    userBadge.classList.add("hidden");
    logoutBtn.classList.add("hidden");
    userName = "";
    loginDialog.showModal();
    document.getElementById("login-username").focus();
  }

  async function enterApp(username) {
    userName = username;
    userBadge.textContent = username;
    userBadge.classList.remove("hidden");
    logoutBtn.classList.remove("hidden");
    appMain.classList.remove("hidden");

    ChatUI.renderMessages([]);
    try {
      const today = await API.get("/api/chats/today");
      ChatUI.renderMessages(today.messages || []);
    } catch (e) {
      console.warn(e);
    }
    await reloadModules();
  }

  document.getElementById("chat-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const input = document.getElementById("chat-input");
    const text = input.value.trim();
    if (!text) return;

    input.value = "";
    ChatUI.appendBubble("user", text);
    ChatUI.setLoading(true);
    const assistantEl = ChatUI.appendAssistantBlock();
    assistantEl.classList.add("is-streaming");

    let routeDone = null;
    let modulesToReload = null;

    try {
      await API.streamChat(text, (ev) => {
        switch (ev.type) {
          case "route_start":
            break;
          case "route_thought_delta":
            ChatUI.updateRouteThoughtPreview(assistantEl, ev.text);
            break;
          case "route_done":
            routeDone = ev;
            ChatUI.finishRouteThinking(assistantEl, ev);
            ChatUI.setThinkingStatus(assistantEl, "正在生成回复…", true);
            break;
          case "chat_start":
            ChatUI.setThinkingStatus(assistantEl, "", false);
            break;
          case "reply_delta":
            ChatUI.updateStreamingReply(assistantEl, ev.text);
            break;
          case "chat_done":
            ChatUI.finalizeStreamingReply(assistantEl, ev.reply);
            modulesToReload = ev.modules;
            break;
          default:
            break;
        }
      });
      if (modulesToReload) await reloadModules(modulesToReload);
    } catch (err) {
      if (err.status === 401) {
        showLogin();
      } else {
        ChatUI.setThinkingStatus(assistantEl, "", false);
        ChatUI.finalizeStreamingReply(assistantEl, `错误: ${err.message}`);
      }
    } finally {
      ChatUI.setLoading(false);
      input.focus();
    }
  });

  document.getElementById("chat-input").addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      document.getElementById("chat-form").requestSubmit();
    }
  });

  async function reloadModules(cached) {
    let list = cached;
    if (!list) {
      const data = await API.get("/api/modules");
      userName = data.user_name || userName;
      list = data.modules;
    }
    StarMap.setData(userName, list);
  }
})();
