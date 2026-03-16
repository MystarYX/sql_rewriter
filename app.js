(function () {
  "use strict";

  var activeMode = "legacy";
  var collapsedTables = {};
  var latestTreeRows = [];
  var latestRows = [];
  var latestSummary = null;
  var selectedNodeId = "";
  var relationMode = true;
  var graphEdges = [];
  var renderTicking = false;
  var exprTooltipTimer = null;
  var tooltipPinned = false;
  var tooltipOwnerId = "";

  var tabs = Array.from(document.querySelectorAll(".tab"));
  var parseBtn = document.getElementById("parse-btn");
  var clearBtn = document.getElementById("clear-btn");
  var copyBtn = document.getElementById("copy-btn");
  var messageEl = document.getElementById("message");
  var astSummaryEl = document.getElementById("ast-summary");

  var resultBody = document.getElementById("result-body");
  var lineageBody = document.getElementById("lineage-body");
  var treeView = document.getElementById("tree-view");
  var mermaidText = document.getElementById("mermaid-text");

  var legacyInput = document.getElementById("legacy-input");
  var standardInput = document.getElementById("standard-input");
  var labels = Array.from(document.querySelectorAll(".label"));

  var tooltip = createTooltip();

  function createTooltip() {
    var el = document.createElement("div");
    el.className = "expr-tooltip hidden";
    el.innerHTML = [
      '<div class="expr-tooltip-text"></div>',
      '<button class="expr-copy-btn" type="button">复制</button>',
    ].join("");
    document.body.appendChild(el);
    el.addEventListener("mouseenter", function () {
      tooltipPinned = true;
    });
    el.addEventListener("mouseleave", function () {
      tooltipPinned = false;
      hideTooltip();
    });
    el.querySelector(".expr-copy-btn").addEventListener("click", function () {
      var text = el.querySelector(".expr-tooltip-text").textContent || "";
      navigator.clipboard.writeText(text).then(function () {
        setMessage("表达式已复制", "success");
      }).catch(function (err) {
        setMessage("复制失败：" + err.message, "error");
      });
    });
    return el;
  }

  function showTooltip(owner, text) {
    if (!owner) {
      return;
    }
    tooltipOwnerId = owner.getAttribute("data-node-id") || "";
    tooltip.querySelector(".expr-tooltip-text").textContent = text || "";
    tooltip.classList.remove("hidden");
    var rect = owner.getBoundingClientRect();
    var top = rect.top + window.scrollY - tooltip.offsetHeight - 10;
    if (top < window.scrollY + 8) {
      top = rect.bottom + window.scrollY + 8;
    }
    var left = Math.min(
      rect.left + window.scrollX,
      window.scrollX + window.innerWidth - tooltip.offsetWidth - 12
    );
    tooltip.style.top = top + "px";
    tooltip.style.left = Math.max(window.scrollX + 12, left) + "px";
  }

  function hideTooltip() {
    if (tooltipPinned) {
      return;
    }
    tooltip.classList.add("hidden");
    tooltipOwnerId = "";
  }

  function currentInput() {
    return activeMode === "legacy" ? legacyInput : standardInput;
  }

  function setMessage(text, type) {
    messageEl.textContent = text || "";
    messageEl.className = "message" + (type ? " " + type : "");
  }

  function clearOutputs() {
    resultBody.innerHTML = '<tr><td colspan="6" class="empty">暂无结果</td></tr>';
    lineageBody.innerHTML = '<tr><td colspan="4" class="empty">暂无血缘</td></tr>';
    treeView.innerHTML = '<div class="graph-empty">暂无图形数据</div>';
    mermaidText.textContent = "graph LR";
    astSummaryEl.textContent = "AST 摘要：暂无";
    latestTreeRows = [];
    latestRows = [];
    latestSummary = null;
    collapsedTables = {};
    selectedNodeId = "";
    graphEdges = [];
    hideTooltip();
  }

  function renderFieldRows(rows) {
    if (!rows || !rows.length) {
      resultBody.innerHTML = '<tr><td colspan="6" class="empty">暂无结果</td></tr>';
      return;
    }

    resultBody.innerHTML = rows.map(function (row, idx) {
      return [
        "<tr>",
        "<td>" + (idx + 1) + "</td>",
        "<td>" + escapeHtml(row.sourceTable || "UNRESOLVED") + "</td>",
        "<td>" + escapeHtml(row.sourceField || "UNRESOLVED") + "</td>",
        "<td>" + escapeHtml(row.mappedField || "UNRESOLVED") + "</td>",
        "<td>" + escapeHtml(row.targetTable || "RESULT_1") + "</td>",
        "<td>" + escapeHtml(row.comment || "") + "</td>",
        "</tr>",
      ].join("");
    }).join("");
  }

  function renderLineage(edges) {
    if (!edges || !edges.length) {
      lineageBody.innerHTML = '<tr><td colspan="4" class="empty">暂无血缘</td></tr>';
      return;
    }

    lineageBody.innerHTML = edges.map(function (e) {
      return [
        "<tr>",
        "<td>" + escapeHtml(e.sourceTable || "UNRESOLVED") + "</td>",
        "<td>" + escapeHtml(e.sourceField || "UNRESOLVED") + "</td>",
        "<td>" + escapeHtml(e.targetTable || "RESULT_1") + "</td>",
        "<td>" + escapeHtml(e.targetField || "UNRESOLVED") + "</td>",
        "</tr>",
      ].join("");
    }).join("");
  }

  function escapeHtml(text) {
    return String(text)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function switchMode(mode) {
    activeMode = mode;
    tabs.forEach(function (tab) {
      var isActive = tab.getAttribute("data-mode") === mode;
      tab.classList.toggle("active", isActive);
      tab.setAttribute("aria-selected", String(isActive));
    });

    legacyInput.classList.toggle("active", mode === "legacy");
    standardInput.classList.toggle("active", mode === "standard");

    labels.forEach(function (label) {
      var forId = label.getAttribute("for");
      var show = (mode === "legacy" && forId === "legacy-input") || (mode === "standard" && forId === "standard-input");
      label.classList.toggle("hidden", !show);
    });
    setMessage("");
  }

  function toTsv(rows) {
    var header = ["序号", "来源表", "原始字段", "映射字段", "目标表", "注释"];
    var content = rows.map(function (row, idx) {
      return [
        idx + 1,
        row.sourceTable || "UNRESOLVED",
        row.sourceField || "UNRESOLVED",
        row.mappedField || "UNRESOLVED",
        row.targetTable || "RESULT_1",
        row.comment || "",
      ].join("\t");
    });
    return [header.join("\t")].concat(content).join("\n");
  }

  function runAnalysis(sql) {
    if (!window.SQLParser || typeof window.SQLParser.analyzeSqlLineage !== "function") {
      throw new Error("解析器未加载或版本不兼容，请刷新页面");
    }
    return window.SQLParser.analyzeSqlLineage(sql, {});
  }

  function buildGraphModel(treeRows, rows) {
    var exprByTargetKey = {};
    rows.forEach(function (r) {
      var key = (r.targetTable || "RESULT_1") + "::" + r.mappedField;
      if (!exprByTargetKey[key] && r.expression) {
        exprByTargetKey[key] = r.expression;
      }
    });

    var tableMap = {};
    var sourceSet = {};
    treeRows.forEach(function (row) {
      row.sources.forEach(function (s) {
        var key = s.table + "::" + s.field;
        sourceSet[key] = true;
        if (!tableMap[s.table]) {
          tableMap[s.table] = [];
        }
        tableMap[s.table].push({ table: s.table, field: s.field, key: key });
      });
    });

    Object.keys(tableMap).forEach(function (table) {
      var seen = {};
      tableMap[table] = tableMap[table].filter(function (x) {
        if (seen[x.key]) {
          return false;
        }
        seen[x.key] = true;
        return true;
      }).sort(function (a, b) {
        return a.field.localeCompare(b.field);
      });
    });

    var targetItems = [];
    var targetSeen = {};
    treeRows.forEach(function (row) {
      var tKey = row.targetTable + "::" + row.targetField;
      if (!targetSeen[tKey]) {
        targetSeen[tKey] = true;
        targetItems.push({
          key: tKey,
          targetField: row.targetField,
          targetTable: row.targetTable,
        });
      }
    });

    return {
      tableMap: tableMap,
      tableOrder: Object.keys(tableMap).sort(),
      targetItems: targetItems,
      expressionByTargetKey: exprByTargetKey,
      treeRows: treeRows,
    };
  }

  function renderGraph(treeRows, rows) {
    if (!treeRows || !treeRows.length) {
      treeView.innerHTML = '<div class="graph-empty">暂无图形数据</div>';
      graphEdges = [];
      return;
    }

    var model = buildGraphModel(treeRows, rows || []);
    var html = [];
    html.push('<div class="graph-toolbar">');
    html.push('<label class="toggle-wrap"><input id="relation-toggle" type="checkbox" ' + (relationMode ? "checked" : "") + ' />查看上下游关系</label>');
    html.push('<button class="mini-btn" data-action="toggle-fullscreen">' + (isTreeFullscreen() ? "退出全屏" : "血缘图全屏") + "</button>");
    html.push('<button class="mini-btn" data-action="expand-all">全部展开</button>');
    html.push('<button class="mini-btn" data-action="collapse-all">全部折叠</button>');
    html.push("</div>");

    html.push('<div class="graph-canvas datahub-canvas">');
    html.push('<svg class="graph-svg"></svg>');
    html.push('<div class="graph-columns">');

    html.push('<section class="graph-col source-col"><h3>来源字段</h3>');
    model.tableOrder.forEach(function (tableName) {
      var collapsed = !!collapsedTables[tableName];
      var fields = model.tableMap[tableName] || [];
      html.push('<article class="source-card graph-node table" data-table="' + escapeHtml(tableName) + '">');
      html.push('<div class="source-card-head"><div class="table-title">' + escapeHtml(tableName) + '</div><button class="table-toggle" data-table="' + escapeHtml(tableName) + '">' + (collapsed ? "展开" : "折叠") + "</button></div>");
      html.push('<div class="source-field-list" data-table-list="' + escapeHtml(tableName) + '"' + (collapsed ? ' style="display:none;"' : "") + ">");
      fields.forEach(function (f) {
        var nid = "source:" + f.key;
        html.push('<button type="button" class="source-field lineage-node graph-node field" data-node-id="' + escapeHtml(nid) + '" data-table="' + escapeHtml(f.table) + '" data-field="' + escapeHtml(f.field) + '">' + escapeHtml(f.field) + "</button>");
      });
      html.push("</div>");
      html.push('<button type="button" class="other-anchor lineage-node" data-node-id="anchor:' + escapeHtml(tableName) + '" data-table="' + escapeHtml(tableName) + '">其他字段(+0)</button>');
      html.push("</article>");
    });
    html.push("</section>");

    html.push('<section class="graph-col expr-col"><h3>SELECT 原始表达式（AS前）</h3>');
    model.targetItems.forEach(function (item) {
      var expr = model.expressionByTargetKey[item.key] || item.targetField;
      var nid = "expr:" + item.key;
      html.push('<button type="button" class="expr-item lineage-node graph-node expr" data-node-id="' + escapeHtml(nid) + '" data-expr="' + escapeHtml(expr) + '">' + escapeHtml(expr) + "</button>");
    });
    html.push("</section>");

    html.push('<section class="graph-col target-col"><h3>目标字段（AS后）</h3>');
    model.targetItems.forEach(function (item) {
      var nid = "target:" + item.key;
      html.push('<button type="button" class="target-field lineage-node graph-node target" data-node-id="' + escapeHtml(nid) + '" title="' + escapeHtml(item.targetTable) + '"><span class="target-name">' + escapeHtml(item.targetField) + '</span><span class="target-table">' + escapeHtml(item.targetTable) + "</span></button>");
    });
    html.push("</section>");

    html.push("</div></div>");
    treeView.innerHTML = html.join("");

    treeView.querySelectorAll(".source-field-list").forEach(function (listEl) {
      listEl.addEventListener("scroll", scheduleEdgeRender);
    });
    treeView.querySelector(".datahub-canvas").addEventListener("scroll", scheduleEdgeRender);

    var toggle = treeView.querySelector("#relation-toggle");
    if (toggle) {
      toggle.addEventListener("change", function () {
        relationMode = !!toggle.checked;
        applySelectionStyles();
      });
    }

    scheduleEdgeRender();
  }

  function isWithinViewport(el, container) {
    if (!el || !container) {
      return false;
    }
    if (el.offsetParent === null) {
      return false;
    }
    var a = el.getBoundingClientRect();
    var b = container.getBoundingClientRect();
    return a.bottom > b.top && a.top < b.bottom;
  }

  function edgePath(fromRect, toRect, baseRect) {
    var sx = fromRect.right - baseRect.left;
    var sy = fromRect.top + fromRect.height / 2 - baseRect.top;
    var ex = toRect.left - baseRect.left;
    var ey = toRect.top + toRect.height / 2 - baseRect.top;
    var dx = ex - sx;
    var c1x = sx + Math.max(28, dx * 0.42);
    var c2x = ex - Math.max(28, dx * 0.42);
    return "M" + sx + "," + sy + " C" + c1x + "," + sy + " " + c2x + "," + ey + " " + ex + "," + ey;
  }

  function scheduleEdgeRender() {
    if (renderTicking) {
      return;
    }
    renderTicking = true;
    window.requestAnimationFrame(function () {
      renderTicking = false;
      renderEdges();
      applySelectionStyles();
    });
  }

  function renderEdges() {
    var canvas = treeView.querySelector(".datahub-canvas");
    var svg = treeView.querySelector(".graph-svg");
    if (!canvas || !svg) {
      graphEdges = [];
      return;
    }

    var canvasRect = canvas.getBoundingClientRect();
    var width = Math.max(canvas.scrollWidth, canvas.clientWidth);
    var height = Math.max(canvas.scrollHeight, canvas.clientHeight);
    svg.setAttribute("viewBox", "0 0 " + width + " " + height);
    svg.setAttribute("width", String(width));
    svg.setAttribute("height", String(height));

    var parts = [];
    parts.push('<defs><marker id="arrow" markerWidth="10" markerHeight="8" refX="9" refY="4" orient="auto"><path d="M0,0 L10,4 L0,8 z" fill="#4b5563"></path></marker></defs>');
    graphEdges = [];

    var treeRows = latestTreeRows || [];
    var edgeSeen = {};

    treeRows.forEach(function (row) {
      var tKey = row.targetTable + "::" + row.targetField;
      var exprEl = treeView.querySelector('[data-node-id="expr:' + cssEscape(tKey) + '"]');
      var targetEl = treeView.querySelector('[data-node-id="target:' + cssEscape(tKey) + '"]');
      if (!exprEl || !targetEl) {
        return;
      }

      row.sources.forEach(function (s) {
        var tableName = s.table;
        var fieldName = s.field;
        var sourceId = "source:" + tableName + "::" + fieldName;
        var fromEl = treeView.querySelector('[data-node-id="' + cssEscape(sourceId) + '"]');
        var listEl = treeView.querySelector('[data-table-list="' + cssEscape(tableName) + '"]');
        var anchorEl = treeView.querySelector('[data-node-id="anchor:' + cssEscape(tableName) + '"]');
        var useAnchor = false;

        if (collapsedTables[tableName]) {
          useAnchor = true;
        } else if (!fromEl || !listEl || !isWithinViewport(fromEl, listEl)) {
          useAnchor = true;
        }

        var startEl = useAnchor ? anchorEl : fromEl;
        if (!startEl || !exprEl) {
          return;
        }

        var exprId = "expr:" + tKey;
        var edgeFrom = useAnchor ? ("anchor:" + tableName) : sourceId;
        var eKey = "S2E|" + edgeFrom + "|" + tKey;
        if (!edgeSeen[eKey]) {
          edgeSeen[eKey] = true;
          var d1 = edgePath(startEl.getBoundingClientRect(), exprEl.getBoundingClientRect(), canvasRect);
          var cls1 = "graph-edge" + (useAnchor ? " dashed" : "");
          parts.push('<path class="' + cls1 + '" marker-end="url(#arrow)" d="' + d1 + '"></path>');
          graphEdges.push({
            from: edgeFrom,
            to: exprId,
            dashed: useAnchor,
          });
        }
      });

      var eKey2 = "E2T|" + tKey;
      if (!edgeSeen[eKey2]) {
        edgeSeen[eKey2] = true;
        var d2 = edgePath(exprEl.getBoundingClientRect(), targetEl.getBoundingClientRect(), canvasRect);
        parts.push('<path class="graph-edge" marker-end="url(#arrow)" d="' + d2 + '"></path>');
        graphEdges.push({
          from: "expr:" + tKey,
          to: "target:" + tKey,
          dashed: false,
        });
      }
    });

    svg.innerHTML = parts.join("");
    updateAnchorCounts();
  }

  function updateAnchorCounts() {
    treeView.querySelectorAll(".source-card").forEach(function (card) {
      var table = card.getAttribute("data-table");
      var listEl = card.querySelector(".source-field-list");
      var fields = Array.from(card.querySelectorAll(".source-field"));
      var anchor = card.querySelector(".other-anchor");
      if (!anchor) {
        return;
      }
      if (collapsedTables[table]) {
        anchor.textContent = "其他字段(+" + fields.length + ")";
        return;
      }
      var visible = 0;
      fields.forEach(function (f) {
        if (isWithinViewport(f, listEl)) {
          visible += 1;
        }
      });
      var hidden = Math.max(fields.length - visible, 0);
      anchor.textContent = "其他字段(+" + hidden + ")";
    });
  }

  function applySelectionStyles() {
    var nodes = Array.from(treeView.querySelectorAll(".lineage-node"));
    var paths = Array.from(treeView.querySelectorAll(".graph-edge"));

    nodes.forEach(function (n) {
      n.classList.remove("selected", "active", "dim");
    });
    paths.forEach(function (p) {
      p.classList.remove("active", "dim");
    });

    if (!selectedNodeId) {
      return;
    }

    var selectedNode = treeView.querySelector('[data-node-id="' + cssEscape(selectedNodeId) + '"]');
    if (selectedNode) {
      selectedNode.classList.add("selected");
    }

    if (!relationMode) {
      graphEdges.forEach(function (edge, idx) {
        if (edge.from === selectedNodeId || edge.to === selectedNodeId) {
          paths[idx] && paths[idx].classList.add("active");
        }
      });
      return;
    }

    var related = {};
    related[selectedNodeId] = true;
    var selectedType = selectedNodeId.split(":")[0];

    function markDirect(from, to) {
      related[from] = true;
      related[to] = true;
    }

    if (selectedType === "source" || selectedType === "anchor") {
      var exprHits = {};
      graphEdges.forEach(function (edge) {
        if (edge.from === selectedNodeId && edge.to.indexOf("expr:") === 0) {
          markDirect(edge.from, edge.to);
          exprHits[edge.to] = true;
        }
      });
      graphEdges.forEach(function (edge) {
        if (exprHits[edge.from] && edge.to.indexOf("target:") === 0) {
          markDirect(edge.from, edge.to);
        }
      });
    } else if (selectedType === "expr") {
      graphEdges.forEach(function (edge) {
        if (edge.to === selectedNodeId && (edge.from.indexOf("source:") === 0 || edge.from.indexOf("anchor:") === 0)) {
          markDirect(edge.from, edge.to);
        }
        if (edge.from === selectedNodeId && edge.to.indexOf("target:") === 0) {
          markDirect(edge.from, edge.to);
        }
      });
    } else if (selectedType === "target") {
      var exprUp = {};
      graphEdges.forEach(function (edge) {
        if (edge.to === selectedNodeId && edge.from.indexOf("expr:") === 0) {
          markDirect(edge.from, edge.to);
          exprUp[edge.from] = true;
        }
      });
      graphEdges.forEach(function (edge) {
        if (exprUp[edge.to] && (edge.from.indexOf("source:") === 0 || edge.from.indexOf("anchor:") === 0)) {
          markDirect(edge.from, edge.to);
        }
      });
    }

    nodes.forEach(function (n) {
      var id = n.getAttribute("data-node-id");
      if (related[id]) {
        n.classList.add("active");
      } else {
        n.classList.add("dim");
      }
    });
    paths.forEach(function (p, idx) {
      var e = graphEdges[idx];
      if (e && related[e.from] && related[e.to]) {
        p.classList.add("active");
      } else {
        p.classList.add("dim");
      }
    });
  }

  function cssEscape(raw) {
    return String(raw).replace(/\\/g, "\\\\").replace(/"/g, '\\"');
  }

  function clearSelection() {
    selectedNodeId = "";
    hideTooltip();
    applySelectionStyles();
  }

  function isTreeFullscreen() {
    return document.fullscreenElement === treeView;
  }

  function syncFullscreenState() {
    treeView.classList.toggle("is-fullscreen", isTreeFullscreen());
    var btn = treeView.querySelector('[data-action="toggle-fullscreen"]');
    if (btn) {
      btn.textContent = isTreeFullscreen() ? "退出全屏" : "血缘图全屏";
    }
    scheduleEdgeRender();
  }

  function toggleTreeFullscreen() {
    if (!document.fullscreenEnabled) {
      setMessage("当前浏览器不支持全屏", "error");
      return Promise.resolve();
    }
    if (isTreeFullscreen()) {
      return document.exitFullscreen();
    }
    return treeView.requestFullscreen();
  }

  tabs.forEach(function (tab) {
    tab.addEventListener("click", function () {
      switchMode(tab.getAttribute("data-mode"));
    });
  });

  treeView.addEventListener("click", function (event) {
    var toggle = event.target.closest(".table-toggle");
    if (toggle) {
      var tableName = toggle.getAttribute("data-table");
      collapsedTables[tableName] = !collapsedTables[tableName];
      renderGraph(latestTreeRows, latestRows);
      return;
    }

    var action = event.target.closest(".mini-btn");
    if (action) {
      var cmd = action.getAttribute("data-action");
      if (cmd === "toggle-fullscreen") {
        toggleTreeFullscreen().catch(function (err) {
          setMessage("切换全屏失败：" + err.message, "error");
        });
        return;
      } else if (cmd === "expand-all") {
        Object.keys(collapsedTables).forEach(function (k) { collapsedTables[k] = false; });
      } else if (cmd === "collapse-all") {
        var tables = {};
        latestTreeRows.forEach(function (row) {
          row.sources.forEach(function (s) { tables[s.table] = true; });
        });
        Object.keys(tables).forEach(function (k) { collapsedTables[k] = true; });
      }
      renderGraph(latestTreeRows, latestRows);
      return;
    }

    var node = event.target.closest(".lineage-node");
    if (node) {
      selectedNodeId = node.getAttribute("data-node-id") || "";
      applySelectionStyles();
      return;
    }

    clearSelection();
  });

  treeView.addEventListener("mouseenter", function (event) {
    var expr = event.target.closest(".expr-item");
    if (!expr) {
      return;
    }
    clearTimeout(exprTooltipTimer);
    var text = expr.getAttribute("data-expr") || expr.textContent || "";
    exprTooltipTimer = setTimeout(function () {
      showTooltip(expr, text);
    }, 320);
  }, true);

  treeView.addEventListener("mouseleave", function (event) {
    var expr = event.target.closest(".expr-item");
    if (!expr) {
      return;
    }
    clearTimeout(exprTooltipTimer);
    setTimeout(function () {
      if (!tooltipPinned) {
        hideTooltip();
      }
    }, 80);
  }, true);

  parseBtn.addEventListener("click", function () {
    try {
      var sql = currentInput().value;
      if (!sql || !sql.trim()) {
        setMessage("请输入 SQL 后再解析", "error");
        clearOutputs();
        return;
      }

      var result = runAnalysis(sql);
      latestTreeRows = result.lineageTree || [];
      latestRows = result.rows || [];
      latestSummary = {
        astSummary: result.astSummary,
        consistencyCheck: result.consistencyCheck || { pass: true },
      };

      renderFieldRows(latestRows);
      renderLineage(result.lineageEdges || []);
      renderGraph(latestTreeRows, latestRows);
      mermaidText.textContent = result.mermaid || "graph LR";
      astSummaryEl.textContent = "AST 摘要：\n" + JSON.stringify(latestSummary, null, 2);

      if (!latestRows.length) {
        setMessage("解析失败：未提取到字段", "error");
      } else if (result.warnings && result.warnings.length) {
        setMessage("解析完成（存在未识别链路）", "error");
      } else {
        setMessage("解析成功", "success");
      }
    } catch (error) {
      setMessage("解析失败：" + error.message, "error");
      clearOutputs();
    }
  });

  clearBtn.addEventListener("click", function () {
    currentInput().value = "";
    clearOutputs();
    setMessage("已清空", "success");
  });

  copyBtn.addEventListener("click", async function () {
    try {
      var rows = Array.from(resultBody.querySelectorAll("tr"))
        .map(function (tr) {
          var tds = Array.from(tr.querySelectorAll("td"));
          if (tds.length !== 6) {
            return null;
          }
          return {
            sourceTable: tds[1].textContent,
            sourceField: tds[2].textContent,
            mappedField: tds[3].textContent,
            targetTable: tds[4].textContent,
            comment: tds[5].textContent,
          };
        })
        .filter(Boolean);

      if (!rows.length) {
        setMessage("暂无可复制结果", "error");
        return;
      }

      await navigator.clipboard.writeText(toTsv(rows));
      setMessage("字段映射已复制", "success");
    } catch (error) {
      setMessage("复制失败：" + error.message, "error");
    }
  });

  window.addEventListener("resize", scheduleEdgeRender);
  document.addEventListener("fullscreenchange", syncFullscreenState);
  window.addEventListener("scroll", function () {
    if (!tooltip.classList.contains("hidden")) {
      var owner = treeView.querySelector('[data-node-id="' + cssEscape(tooltipOwnerId) + '"]');
      if (owner) {
        showTooltip(owner, owner.getAttribute("data-expr") || owner.textContent || "");
      }
    }
    scheduleEdgeRender();
  }, { passive: true });

  switchMode("legacy");
})();
