/**
 * 识别 Wiki HTML 结构：外部 New part、分节内 + 增条目、Del 删分节；正文可点击编辑。
 */
const WikiEditor = (() => {
  const UI_CLASS = "wiki-ui";

  const SECTION_DEFAULT = `<section class="wiki-section"><h3>新分节</h3><p></p></section>`;

  function ensureArticle(editor) {
    let doc = editor.querySelector(":scope > .wiki-doc");
    if (!doc) {
      doc = document.createElement("article");
      doc.className = "wiki-doc";
      doc.innerHTML =
        editor.innerHTML.trim() ||
        '<section class="wiki-section"><h3>概览</h3><p></p></section>';
      editor.innerHTML = "";
      editor.appendChild(doc);
    }
    return doc;
  }

  function btn(label, action, extraClass = "") {
    const b = document.createElement("button");
    b.type = "button";
    b.className = `wiki-ui-btn ${UI_CLASS} ${extraClass}`.trim();
    b.dataset.wiki = action;
    b.textContent = label;
    b.setAttribute("contenteditable", "false");
    b.addEventListener("mousedown", (e) => e.preventDefault());
    b.addEventListener("click", (e) => e.stopPropagation());
    return b;
  }

  function removeUiNodes(root) {
    root
      .querySelectorAll(
        `.${UI_CLASS}, .wiki-toolbar, .wiki-sec-bar, .wiki-sec-actions, .wiki-table-tools, .wiki-list-tools, .wiki-dl-tools`
      )
      .forEach((el) => el.remove());
    root.querySelectorAll("td.wiki-col-actions, th.wiki-col-actions").forEach((el) => el.remove());
    root.querySelectorAll("table.wiki-table").forEach((table) => {
      const headCells = table.querySelectorAll("thead tr th");
      if (headCells.length && headCells[headCells.length - 1].classList.contains("wiki-col-actions")) {
        headCells[headCells.length - 1].remove();
      }
    });
  }

  function getContent(editorEl) {
    const clone = editorEl.cloneNode(true);
    removeUiNodes(clone);
    const doc = clone.querySelector(":scope > .wiki-doc") || clone.querySelector(".wiki-doc");
    if (doc) return doc.outerHTML;
    return clone.innerHTML;
  }

  function focusEditable(el) {
    if (!el) return;
    el.focus?.();
    const range = document.createRange();
    range.selectNodeContents(el);
    range.collapse(true);
    const sel = window.getSelection();
    sel?.removeAllRanges();
    sel?.addRange(range);
  }

  function mountToolbar(editor, doc) {
    let bar = editor.querySelector(":scope > .wiki-toolbar");
    if (!bar) {
      bar = document.createElement("div");
      bar.className = `wiki-toolbar ${UI_CLASS}`;
      bar.setAttribute("contenteditable", "false");
      editor.insertBefore(bar, doc);
    }
    bar.innerHTML = "";
    const addPart = btn("New part", "add-section", "wiki-ui-part");
    addPart.title = "新增分节";
    addPart.addEventListener("click", () => {
      const wrap = document.createElement("div");
      wrap.innerHTML = SECTION_DEFAULT.trim();
      const sec = wrap.firstElementChild;
      doc.appendChild(sec);
      enhance(doc);
      focusEditable(sec.querySelector("h3"));
    });
    bar.append(addPart);
  }

  function addSectionItem(section) {
    const table = section.querySelector("table.wiki-table");
    if (table) {
      let tbody = table.querySelector("tbody");
      if (!tbody) {
        tbody = document.createElement("tbody");
        table.appendChild(tbody);
      }
      const tr = document.createElement("tr");
      tr.innerHTML = "<td></td><td></td>";
      tbody.appendChild(tr);
      enhanceTable(section, table);
      focusEditable(tr.querySelector("td"));
      return;
    }
    const list = section.querySelector("ul.wiki-list, ol.wiki-list");
    if (list) {
      const li = document.createElement("li");
      list.appendChild(li);
      enhanceList(section, list);
      focusEditable(li);
      return;
    }
    const dl = section.querySelector("dl.wiki-dl");
    if (dl) {
      const dt = document.createElement("dt");
      const dd = document.createElement("dd");
      dl.append(dt, dd);
      enhanceDl(section, dl);
      focusEditable(dt);
    }
  }

  function sectionCanAddItem(section) {
    return !!section.querySelector(
      "table.wiki-table, ul.wiki-list, ol.wiki-list, dl.wiki-dl"
    );
  }

  function sectionBar(section, canDelete, canAddItem) {
    let bar = section.querySelector(":scope > .wiki-sec-bar");
    let h3 = section.querySelector("h3");

    if (!bar) {
      bar = document.createElement("div");
      bar.className = `wiki-sec-bar ${UI_CLASS}`;
      bar.setAttribute("contenteditable", "false");
      if (h3) {
        section.insertBefore(bar, h3);
      } else {
        section.prepend(bar);
        h3 = document.createElement("h3");
        h3.textContent = "分节";
      }
      bar.appendChild(h3);
    } else if (h3 && !bar.contains(h3)) {
      bar.insertBefore(h3, bar.firstChild);
    } else {
      h3 = bar.querySelector("h3");
    }

    if (h3) {
      h3.setAttribute("contenteditable", "true");
      h3.setAttribute("spellcheck", "true");
    }

    let actions = bar.querySelector(".wiki-sec-actions");
    if (!actions) {
      actions = document.createElement("div");
      actions.className = `wiki-sec-actions ${UI_CLASS}`;
      actions.setAttribute("contenteditable", "false");
      bar.appendChild(actions);
    }
    actions.innerHTML = "";

    if (canAddItem) {
      const add = btn("+", "add-item", "wiki-ui-add");
      add.title = "添加条目";
      add.addEventListener("click", () => addSectionItem(section));
      actions.appendChild(add);
    }
    if (canDelete) {
      const del = btn("Del", "del-section", "wiki-ui-danger");
      del.title = "删除分节";
      del.addEventListener("click", () => section.remove());
      actions.appendChild(del);
    }
  }

  function markEditableContent(root) {
    root.querySelectorAll("p, .wiki-note, td, th, li, dt, dd").forEach((el) => {
      if (el.closest(`.${UI_CLASS}`)) return;
      el.setAttribute("contenteditable", "true");
      el.setAttribute("spellcheck", "true");
    });
  }

  function enhanceTable(section, table) {
    let thead = table.querySelector("thead");
    if (!thead) {
      thead = document.createElement("thead");
      thead.innerHTML = "<tr><th>项</th><th>说明</th></tr>";
      table.prepend(thead);
    }
    let headRow = thead.querySelector("tr");
    if (!headRow.querySelector(".wiki-col-actions")) {
      const th = document.createElement("th");
      th.className = "wiki-col-actions";
      th.setAttribute("contenteditable", "false");
      headRow.appendChild(th);
    }

    let tbody = table.querySelector("tbody");
    if (!tbody) {
      tbody = document.createElement("tbody");
      table.appendChild(tbody);
    }

    tbody.querySelectorAll("tr").forEach((tr) => {
      let actionCell = tr.querySelector(".wiki-col-actions");
      if (!actionCell) {
        actionCell = document.createElement("td");
        actionCell.className = "wiki-col-actions";
        actionCell.setAttribute("contenteditable", "false");
        tr.appendChild(actionCell);
      }
      actionCell.innerHTML = "";
      const del = btn("−", "del-row", "wiki-ui-mini");
      del.title = "删除行";
      del.addEventListener("click", () => {
        if (tbody.querySelectorAll("tr").length <= 1) {
          tr.querySelectorAll("td:not(.wiki-col-actions)").forEach((c) => {
            c.textContent = "";
          });
          return;
        }
        tr.remove();
      });
      actionCell.appendChild(del);
    });

    section.querySelector(":scope > .wiki-table-tools")?.remove();
  }

  function enhanceList(section, list) {
    list.querySelectorAll("li").forEach((li) => {
      li.setAttribute("contenteditable", "true");
      let tools = li.querySelector(".wiki-li-tools");
      if (!tools) {
        tools = document.createElement("span");
        tools.className = `wiki-li-tools ${UI_CLASS}`;
        tools.setAttribute("contenteditable", "false");
        li.appendChild(tools);
      }
      tools.innerHTML = "";
      const del = btn("−", "del-li", "wiki-ui-mini");
      del.title = "删除项";
      del.addEventListener("click", () => {
        if (list.querySelectorAll("li").length <= 1) {
          li.textContent = "";
          return;
        }
        li.remove();
      });
      tools.appendChild(del);
    });

    section.querySelector(":scope > .wiki-list-tools")?.remove();
  }

  function enhanceDl(section, dl) {
    const dts = [...dl.querySelectorAll("dt")];
    dts.forEach((dt) => {
      let dd = dt.nextElementSibling;
      if (!dd || dd.tagName !== "DD") {
        dd = document.createElement("dd");
        dt.after(dd);
      }
      dt.setAttribute("contenteditable", "true");
      dd.setAttribute("contenteditable", "true");

      let tools = dt.querySelector(".wiki-dl-tools");
      if (!tools) {
        tools = document.createElement("span");
        tools.className = `wiki-dl-tools ${UI_CLASS}`;
        tools.setAttribute("contenteditable", "false");
        dt.appendChild(tools);
      }
      tools.innerHTML = "";
      const del = btn("−", "del-dl", "wiki-ui-mini");
      del.title = "删除属性";
      del.addEventListener("click", () => {
        if (dl.querySelectorAll("dt").length <= 1) {
          const tools = dt.querySelector(".wiki-dl-tools");
          dt.textContent = "";
          if (tools) dt.appendChild(tools);
          dd.textContent = "";
          return;
        }
        dt.remove();
        dd.remove();
      });
      tools.appendChild(del);
    });

    section.querySelector(":scope > .wiki-dl-tools")?.remove();
  }

  function enhance(doc) {
    const sections = [...doc.querySelectorAll(":scope > .wiki-section")];
    if (!sections.length) {
      const sec = document.createElement("section");
      sec.className = "wiki-section";
      sec.innerHTML = "<h3>概览</h3><p></p>";
      doc.appendChild(sec);
      return enhance(doc);
    }

    const multi = sections.length > 1;
    sections.forEach((section) => {
      sectionBar(section, multi, sectionCanAddItem(section));
      markEditableContent(section);
      const table = section.querySelector("table.wiki-table");
      if (table) enhanceTable(section, table);
      const list = section.querySelector("ul.wiki-list, ol.wiki-list");
      if (list) enhanceList(section, list);
      const dl = section.querySelector("dl.wiki-dl");
      if (dl) enhanceDl(section, dl);
    });
    markEditableContent(doc);
  }

  function enhanceEditor(editorEl) {
    if (!editorEl) return;
    removeUiNodes(editorEl);
    const doc = ensureArticle(editorEl);
    mountToolbar(editorEl, doc);
    enhance(doc);
  }

  return { enhanceEditor, getContent };
})();
