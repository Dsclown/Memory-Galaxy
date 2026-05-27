/** @type {typeof d3} */
const d3g = window.d3;

const EXPANDED_W = 288;
const EXPANDED_H = 228;
const EXPANDED_MIN_W = 220;
const EXPANDED_MIN_H = 180;
const EXPANDED_MAX_W = 520;
const EXPANDED_MAX_H = 420;

const StarMap = (() => {
  let svg, g, gLinks, gNodes, simulation, zoomBehavior;
  let userName = "用户";
  let modules = [];
  let callbacks = {};
  let expandedId = null;
  let expandedHtml = "";
  let dragMoved = false;
  let graphNodes = [];
  let graphLinks = [];
  let nodePositions = new Map();
  let graphReady = false;
  /** @type {Map<string, {w: number, h: number}>} */
  const expandedSizes = new Map();
  let persistLayoutTimer = null;

  const LAYOUT_KEY_PREFIX = "memory_galaxy:layout:";

  function layoutStorageKey() {
    return `${LAYOUT_KEY_PREFIX}${userName || "default"}`;
  }

  function loadLayoutFromStorage() {
    try {
      const raw = localStorage.getItem(layoutStorageKey());
      if (!raw) return;
      const data = JSON.parse(raw);
      if (data.nodes && typeof data.nodes === "object") {
        for (const [id, p] of Object.entries(data.nodes)) {
          if (p && typeof p.x === "number" && typeof p.y === "number") {
            nodePositions.set(id, {
              x: p.x,
              y: p.y,
              fx: p.fx ?? null,
              fy: p.fy ?? null,
            });
          }
        }
      }
      if (data.expandedSizes && typeof data.expandedSizes === "object") {
        for (const [id, sz] of Object.entries(data.expandedSizes)) {
          if (sz && typeof sz.w === "number" && typeof sz.h === "number") {
            expandedSizes.set(id, { w: sz.w, h: sz.h });
          }
        }
      }
      if (data.zoom && svg && zoomBehavior) {
        const { x = 0, y = 0, k = 1 } = data.zoom;
        svg.call(zoomBehavior.transform, d3g.zoomIdentity.translate(x, y).scale(k));
      }
    } catch (e) {
      console.warn("读取星图布局缓存失败", e);
    }
  }

  function persistLayout() {
    if (!userName) return;
    savePositions();
    const nodes = {};
    nodePositions.forEach((p, id) => {
      if (id === "__center__") return;
      nodes[id] = { x: p.x, y: p.y, fx: p.fx, fy: p.fy };
    });
    const sizes = {};
    expandedSizes.forEach((sz, id) => {
      sizes[id] = { w: sz.w, h: sz.h };
    });
    let zoom = null;
    if (svg) {
      const t = d3g.zoomTransform(svg.node());
      zoom = { x: t.x, y: t.y, k: t.k };
    }
    try {
      localStorage.setItem(
        layoutStorageKey(),
        JSON.stringify({ nodes, expandedSizes: sizes, zoom })
      );
    } catch (e) {
      console.warn("保存星图布局缓存失败", e);
    }
  }

  function schedulePersistLayout() {
    if (persistLayoutTimer) clearTimeout(persistLayoutTimer);
    persistLayoutTimer = setTimeout(() => {
      persistLayoutTimer = null;
      persistLayout();
    }, 350);
  }

  function init(containerId, cbs) {
    callbacks = cbs || {};
    const wrap = document.getElementById(containerId)?.parentElement;
    const el = document.getElementById(containerId);
    if (!el || !wrap) return;

    const resize = () => {
      const w = wrap.clientWidth;
      const h = wrap.clientHeight;
      el.setAttribute("width", w);
      el.setAttribute("height", h);
      const center = graphNodes.find((n) => n.type === "center");
      if (center) {
        center.fx = w / 2;
        center.fy = h / 2;
        center.x = w / 2;
        center.y = h / 2;
        nodePositions.set(center.id, { x: w / 2, y: h / 2, fx: w / 2, fy: h / 2 });
      }
      if (simulation) simulation.alpha(0.2).restart();
    };

    svg = d3g.select(el);
    g = svg.append("g");

    zoomBehavior = d3g
      .zoom()
      .scaleExtent([0.25, 3])
      .filter((event) => {
        if (event.type === "wheel") return true;
        const t = event.target;
        if (event.type === "mousedown") {
          if (t === el || t.classList?.contains("galaxy-bg") || t.classList?.contains("galaxy-pan-bg"))
            return true;
        }
        return false;
      })
      .on("zoom", (event) => {
        g.attr("transform", event.transform);
      })
      .on("end", schedulePersistLayout);

    svg.call(zoomBehavior).on("dblclick.zoom", null);

    svg
      .insert("rect", ":first-child")
      .attr("class", "galaxy-bg")
      .attr("width", "100%")
      .attr("height", "100%")
      .attr("fill", "transparent")
      .style("cursor", "grab");

    g.append("rect")
      .attr("class", "galaxy-pan-bg")
      .attr("x", -4000)
      .attr("y", -4000)
      .attr("width", 8000)
      .attr("height", 8000)
      .attr("fill", "transparent");

    gLinks = g.append("g").attr("class", "links");
    gNodes = g.append("g").attr("class", "nodes");

    resize();
    window.addEventListener("resize", resize);

    svg.on("click", (event) => {
      if (event.target.classList?.contains("galaxy-bg") || event.target.classList?.contains("galaxy-pan-bg")) {
        collapseExpand();
      }
    });
  }

  function savePositions() {
    graphNodes.forEach((n) => {
      if (n.x == null || n.y == null) return;
      const pinned = n.fx != null && n.fy != null;
      nodePositions.set(n.id, {
        x: n.x,
        y: n.y,
        fx: pinned ? n.fx : null,
        fy: pinned ? n.fy : null,
      });
    });
  }

  function pinNodeAtCurrent(n) {
    if (!n || n.type === "center") return;
    n.fx = n.x;
    n.fy = n.y;
    nodePositions.set(n.id, { x: n.x, y: n.y, fx: n.fx, fy: n.fy });
    schedulePersistLayout();
  }

  function restorePositions(nodes) {
    nodes.forEach((n) => {
      const p = nodePositions.get(n.id);
      if (!p) return;
      n.x = p.x;
      n.y = p.y;
      if (p.fx != null && p.fy != null) {
        n.fx = p.fx;
        n.fy = p.fy;
      } else if (n.type !== "center") {
        n.fx = null;
        n.fy = null;
      }
    });
  }

  function isExpandedNode(d) {
    return d.type === "module" && d.id === expandedId;
  }

  function canDragNode(event, d) {
    if (d.type === "center") return false;
    const t = event.target;
    if (t.closest?.(".node-resize-handle")) return false;
    if (t.closest?.("button")) return false;
    if (t.closest?.(".wiki-toolbar, .wiki-sec-bar, .wiki-sec-actions")) return false;
    if (t.closest?.(".wiki-col-actions, .wiki-li-tools, .wiki-dl-tools")) return false;
    if (isExpandedNode(d)) {
      if (t.closest?.(".module-inline-editor, .wiki-doc, .module-inline-actions")) return false;
      if (t.closest?.(".module-inline-header")) return true;
      return false;
    }
    return true;
  }

  function moduleCursor(d) {
    if (isExpandedNode(d)) return "default";
    return d.type === "module" ? "grab" : "default";
  }

  function buildGraph() {
    const wrap = document.getElementById("galaxy-svg").parentElement;
    const w = wrap.clientWidth;
    const h = wrap.clientHeight;
    const center = {
      id: "__center__",
      label: userName,
      type: "center",
      x: w / 2,
      y: h / 2,
      fx: w / 2,
      fy: h / 2,
    };
    const nodes = [
      center,
      ...modules.map((m) => {
        const sz = expandedSizes.get(m.id);
        return {
          id: m.id,
          label: m.title || m.id,
          type: "module",
          expandedW: sz?.w,
          expandedH: sz?.h,
        };
      }),
    ];
    const links = modules.map((m) => ({ source: "__center__", target: m.id }));
    return { nodes, links };
  }

  function getExpandedSize(d) {
    const w = d.expandedW ?? expandedSizes.get(d.id)?.w ?? EXPANDED_W;
    const h = d.expandedH ?? expandedSizes.get(d.id)?.h ?? EXPANDED_H;
    return {
      w: Math.max(EXPANDED_MIN_W, Math.min(EXPANDED_MAX_W, w)),
      h: Math.max(EXPANDED_MIN_H, Math.min(EXPANDED_MAX_H, h)),
    };
  }

  function setExpandedSize(d, w, h) {
    const size = {
      w: Math.max(EXPANDED_MIN_W, Math.min(EXPANDED_MAX_W, w)),
      h: Math.max(EXPANDED_MIN_H, Math.min(EXPANDED_MAX_H, h)),
    };
    d.expandedW = size.w;
    d.expandedH = size.h;
    expandedSizes.set(d.id, size);
    schedulePersistLayout();
    return size;
  }

  function collisionRadius(d) {
    if (d.type === "center") return 48;
    if (d.id === expandedId) {
      const { w, h } = getExpandedSize(d);
      return Math.hypot(w, h) / 2 + 16;
    }
    return 32;
  }

  function linkDistance(d) {
    const tid = typeof d.target === "object" ? d.target.id : d.target;
    const sid = typeof d.source === "object" ? d.source.id : d.source;
    return expandedId && (tid === expandedId || sid === expandedId) ? 200 : 120;
  }

  function updateForces() {
    if (!simulation) return;
    simulation.force("collision", d3g.forceCollide(collisionRadius));
    simulation.force("link").distance(linkDistance);
    simulation.alpha(0.25).restart();
  }

  function escapeHtml(s) {
    return String(s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function bindExpandActions(container, d) {
    container.selectAll("[data-action]").on("click", async (event) => {
      event.stopPropagation();
      const action = event.currentTarget.getAttribute("data-action");
      const editor = container.select(".module-inline-editor").node();
      const html =
        editor && typeof WikiEditor !== "undefined"
          ? WikiEditor.getContent(editor)
          : editor
            ? editor.innerHTML
            : expandedHtml;

      if (action === "collapse") {
        collapseExpand();
        return;
      }
      if (action === "save" && callbacks.onModuleSave) {
        await callbacks.onModuleSave(d.id, html);
        expandedHtml = html;
      }
      if (action === "delete" && callbacks.onModuleDelete) {
        if (!confirm(`确定删除模块「${d.id}」？`)) return;
        await callbacks.onModuleDelete(d.id);
        expandedId = null;
        expandedHtml = "";
        syncGraph(true);
      }
    });
  }

  function applyExpandedGeometry(shape, d, w, h) {
    const hw = w / 2;
    const hh = h / 2;
    shape
      .select(".node-body-rect")
      .attr("x", -hw)
      .attr("y", -hh)
      .attr("width", w)
      .attr("height", h);
    shape
      .select(".node-inline-fo")
      .attr("x", -hw)
      .attr("y", -hh)
      .attr("width", w)
      .attr("height", h);
    shape
      .select(".node-resize-handle")
      .attr("transform", `translate(${hw - 5}, ${hh - 5})`);
  }

  /** 左上角固定，向右下拉伸（类似系统窗口） */
  function resizeFromBottomRight(d, pointerX, pointerY, anchorTLX, anchorTLY) {
    const newW = Math.max(EXPANDED_MIN_W, Math.min(EXPANDED_MAX_W, pointerX - anchorTLX));
    const newH = Math.max(EXPANDED_MIN_H, Math.min(EXPANDED_MAX_H, pointerY - anchorTLY));
    const cx = anchorTLX + newW / 2;
    const cy = anchorTLY + newH / 2;
    d.x = cx;
    d.y = cy;
    d.fx = cx;
    d.fy = cy;
    return setExpandedSize(d, newW, newH);
  }

  function mountResizeHandles(shape, d) {
    const { w, h } = getExpandedSize(d);
    const hw = w / 2;
    const hh = h / 2;

    let handle = shape.select(".node-resize-handle");
    if (handle.empty()) {
      handle = shape
        .append("rect")
        .attr("class", "node-resize-handle")
        .attr("width", 10)
        .attr("height", 10)
        .attr("x", 0)
        .attr("y", 0)
        .attr("rx", 2)
        .style("cursor", "se-resize")
        .attr("pointer-events", "all");
    }

    handle.attr("transform", `translate(${hw - 5}, ${hh - 5})`);

    handle.call(
      d3g
        .drag()
        .clickDistance(4)
        .on("start", (event) => {
          if (event.sourceEvent) {
            event.sourceEvent.stopPropagation();
          }
          dragMoved = true;
          const sz = getExpandedSize(d);
          d._resizeTLX = d.x - sz.w / 2;
          d._resizeTLY = d.y - sz.h / 2;
        })
        .on("drag", (event) => {
          const [px, py] = d3g.pointer(event, g.node());
          const { w: nw, h: nh } = resizeFromBottomRight(
            d,
            px,
            py,
            d._resizeTLX,
            d._resizeTLY
          );
          applyExpandedGeometry(shape, d, nw, nh);
          pinNodeAtCurrent(d);
          updateForces();
        })
        .on("end", () => {
          delete d._resizeTLX;
          delete d._resizeTLY;
          pinNodeAtCurrent(d);
        })
    );
  }

  function renderNodeShape(nodeSel) {
    nodeSel.each(function (d) {
      const root = d3g.select(this);
      root.selectAll(".node-shape").remove();

      const shape = root.append("g").attr("class", "node-shape");

      if (d.type === "center") {
        shape.append("circle").attr("class", "node-circle").attr("r", 42);
        shape
          .append("text")
          .attr("class", "node-label")
          .attr("text-anchor", "middle")
          .attr("dy", 5)
          .text(d.label.length > 8 ? d.label.slice(0, 7) + "…" : d.label);
        return;
      }

      if (d.id === expandedId) {
        const { w, h } = getExpandedSize(d);
        const hw = w / 2;
        const hh = h / 2;
        shape
          .append("rect")
          .attr("class", "node-body-rect")
          .attr("x", -hw)
          .attr("y", -hh)
          .attr("width", w)
          .attr("height", h)
          .attr("rx", 14)
          .attr("ry", 14);

        const fo = shape
          .append("foreignObject")
          .attr("class", "node-inline-fo")
          .attr("x", -hw)
          .attr("y", -hh)
          .attr("width", w)
          .attr("height", h);

        const body = fo
          .append("xhtml:div")
          .attr("xmlns", "http://www.w3.org/1999/xhtml")
          .attr("class", "module-inline-body");

        body.append("div").attr("class", "module-inline-header").html(`
          <span class="module-inline-title">${escapeHtml(d.label)}</span>
          <button type="button" data-action="collapse" title="收起">×</button>
        `);

        const editor = body.append("div").attr("class", "module-inline-editor");

        editor.html(expandedHtml);
        const editorNode = editor.node();
        if (editorNode && typeof WikiEditor !== "undefined") {
          WikiEditor.enhanceEditor(editorNode);
        }

        body.append("div").attr("class", "module-inline-actions").html(`
          <button type="button" class="btn-danger-sm" data-action="delete">删除</button>
          <button type="button" class="btn-primary-sm" data-action="save">保存</button>
        `);

        fo.attr("pointer-events", "all");
        body.on("click", (event) => event.stopPropagation());
        editor.on("mousedown pointerdown", (event) => event.stopPropagation());
        body.select(".module-inline-actions").on("mousedown pointerdown", (event) => event.stopPropagation());
        bindExpandActions(body, d);
        mountResizeHandles(shape, d);
        return;
      }

      shape.append("circle").attr("class", "node-circle").attr("r", 28);
      shape
        .append("text")
        .attr("class", "node-label")
        .attr("text-anchor", "middle")
        .attr("dy", 4)
        .text(d.label.length > 8 ? d.label.slice(0, 7) + "…" : d.label);
    });
  }

  function getDrag() {
    return d3g
      .drag()
      .clickDistance(6)
      .filter(canDragNode)
      .on("start", (event, d) => {
        dragMoved = false;
        if (!event.active) simulation.alphaTarget(0.15).restart();
        const [px, py] = d3g.pointer(event, g.node());
        d._dragOx = d.x - px;
        d._dragOy = d.y - py;
        d.fx = d.x;
        d.fy = d.y;
      })
      .on("drag", (event, d) => {
        dragMoved = true;
        const [px, py] = d3g.pointer(event, g.node());
        d.fx = px + (d._dragOx ?? 0);
        d.fy = py + (d._dragOy ?? 0);
      })
      .on("end", (event, d) => {
        if (!event.active) simulation.alphaTarget(0);
        delete d._dragOx;
        delete d._dragOy;
        pinNodeAtCurrent(d);
      });
  }

  function syncGraph(fullReset) {
    if (!svg) return;

    savePositions();

    const { nodes, links } = buildGraph();
    restorePositions(nodes);

    graphNodes = nodes;

    if (expandedId) {
      const expanded = nodes.find((n) => n.id === expandedId);
      if (expanded) pinNodeAtCurrent(expanded);
    }
    graphLinks = links;

    if (!graphReady || fullReset) {
      if (simulation) simulation.stop();

      simulation = d3g
        .forceSimulation(nodes)
        .force("charge", d3g.forceManyBody().strength((d) => (d.type === "center" ? 0 : -280)))
        .force(
          "link",
          d3g
            .forceLink(links)
            .id((d) => d.id)
            .distance(linkDistance)
            .strength(0.9)
        )
        .force("collision", d3g.forceCollide(collisionRadius));

      graphReady = true;
    } else {
      simulation.nodes(nodes);
      simulation.force("link").links(links);
      updateForces();
    }

    const linkKey = (d) =>
      `${typeof d.source === "object" ? d.source.id : d.source}-${typeof d.target === "object" ? d.target.id : d.target}`;
    const link = gLinks.selectAll("line").data(links, linkKey);

    link.exit().remove();
    link.enter().append("line").attr("class", "link-module").merge(link);

    const node = gNodes.selectAll("g.node").data(nodes, (d) => d.id);

    node.exit().each((d) => nodePositions.delete(d.id)).remove();

    const nodeEnter = node
      .enter()
      .append("g")
      .style("cursor", moduleCursor)
      .call(getDrag())
      .on("click", (event, d) => {
        event.stopPropagation();
        if (d.type !== "module" || dragMoved) return;
        toggleModule(d);
      });

    const nodeAll = nodeEnter.merge(node);

    nodeAll.attr("class", (d) => {
      let c = d.type === "center" ? "node node-center" : "node node-module";
      if (d.id === expandedId) c += " node-expanded";
      return c;
    });
    nodeAll.style("cursor", moduleCursor);

    renderNodeShape(nodeAll);

    simulation.on("tick", () => {
      gLinks
        .selectAll("line")
        .attr("x1", (d) => d.source.x)
        .attr("y1", (d) => d.source.y)
        .attr("x2", (d) => d.target.x)
        .attr("y2", (d) => d.target.y);
      gNodes.selectAll("g.node").attr("transform", (d) => `translate(${d.x},${d.y})`);
    });

    simulation.alpha(fullReset ? 0.5 : 0.25).restart();
  }

  function applyExpandVisual() {
    gNodes.selectAll("g.node").attr("class", (d) => {
      let c = d.type === "center" ? "node node-center" : "node node-module";
      if (d.id === expandedId) c += " node-expanded";
      return c;
    });
    gNodes.selectAll("g.node").style("cursor", moduleCursor);
    renderNodeShape(gNodes.selectAll("g.node"));
    updateForces();
  }

  function releaseExpandedPin() {
    const prev = graphNodes.find((n) => n.id === expandedId);
    if (prev) pinNodeAtCurrent(prev);
  }

  function collapseExpand() {
    if (!expandedId) return;
    releaseExpandedPin();
    expandedId = null;
    expandedHtml = "";
    applyExpandVisual();
  }

  async function toggleModule(d) {
    if (expandedId === d.id) {
      collapseExpand();
      return;
    }

    if (expandedId) releaseExpandedPin();

    if (!callbacks.onModuleOpen) return;

    const target = graphNodes.find((n) => n.id === d.id) || d;
    pinNodeAtCurrent(target);

    try {
      expandedHtml = await callbacks.onModuleOpen(d.id);
      expandedId = d.id;
      applyExpandVisual();
    } catch (e) {
      console.error(e);
    }
  }

  function setData(name, moduleList) {
    userName = name || "用户";
    modules = moduleList || [];
    loadLayoutFromStorage();
    if (expandedId && !modules.find((m) => m.id === expandedId)) {
      expandedId = null;
      expandedHtml = "";
    }
    syncGraph(!graphReady);
  }

  return { init, setData, collapseExpand };
})();
