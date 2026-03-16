(function () {
  "use strict";

  var DEFAULT_VISIBLE_FIELDS = 10;

  var activeMode = "legacy";
  var relationMode = true;
  var selectedNodeId = "";
  var collapsedCards = {};
  var expandedCards = {};
  var cardOffsets = {};
  var latestResult = null;
  var visualEdges = [];
  var renderTicking = false;
  var exprTooltipTimer = null;
  var tooltipPinned = false;
  var tooltipOwnerId = "";
  var dragState = null;

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
  var looseModeToggle = document.getElementById("loose-mode-toggle");
  var labels = Array.from(document.querySelectorAll(".label"));

  var tooltip = createTooltip();

  function createTooltip() {
    var el = document.createElement("div");
    el.className = "expr-tooltip hidden";
    el.innerHTML = '<div class="expr-tooltip-text"></div><button class="expr-copy-btn" type="button">复制</button>';
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
    var top = rect.top + window.scrollY - tooltip.offsetHeight - 8;
    if (top < window.scrollY + 10) {
      top = rect.bottom + window.scrollY + 8;
    }
    var left = Math.min(rect.left + window.scrollX, window.scrollX + window.innerWidth - tooltip.offsetWidth - 12);
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

  function escapeHtml(text) {
    return String(text)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function cssEscape(raw) {
    return String(raw).replace(/\\/g, "\\\\").replace(/"/g, '\\"');
  }

  function currentInput() {
    return activeMode === "legacy" ? legacyInput : standardInput;
  }

  function setMessage(text, type) {
    messageEl.textContent = text || "";
    messageEl.className = "message" + (type ? " " + type : "");
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

  function clearOutputs() {
    resultBody.innerHTML = '<tr><td colspan="6" class="empty">暂无结果</td></tr>';
    lineageBody.innerHTML = '<tr><td colspan="4" class="empty">暂无血缘</td></tr>';
    treeView.innerHTML = '<div class="graph-empty">暂无图形数据</div>';
    mermaidText.textContent = "graph LR";
    astSummaryEl.textContent = "AST 摘要：暂无";
    latestResult = null;
    visualEdges = [];
    selectedNodeId = "";
    collapsedCards = {};
    expandedCards = {};
    cardOffsets = {};
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
      var sourceLabel = e.sourceAlias && e.sourceAlias !== e.sourceTable
        ? (e.sourceTable + " " + e.sourceAlias)
        : e.sourceTable;
      return [
        "<tr>",
        "<td>" + escapeHtml(sourceLabel || "UNRESOLVED") + "</td>",
        "<td>" + escapeHtml(e.sourceField || "UNRESOLVED") + "</td>",
        "<td>" + escapeHtml(e.targetTable || "RESULT_1") + "</td>",
        "<td>" + escapeHtml(e.targetField || "UNRESOLVED") + "</td>",
        "</tr>",
      ].join("");
    }).join("");
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
    return window.SQLParser.analyzeSqlLineage(sql, {
      looseMainAlias: !looseModeToggle || !!looseModeToggle.checked,
    });
  }

  function buildGraphModel(result) {
    var edges = (result.graphEdges && result.graphEdges.length ? result.graphEdges : result.lineageEdges) || [];
    var cards = {};
    var deps = {};
    var parentMap = {};
    var childMap = {};
    var exprMap = {};
    var exprList = [];
    var edgeInstances = [];

    function ensureCard(cardKey, label) {
      if (!cards[cardKey]) {
        cards[cardKey] = {
          key: cardKey,
          label: label,
          fieldSet: {},
          fields: [],
          inDegree: 0,
          out: {},
          depth: 0,
        };
      }
      return cards[cardKey];
    }

    edges.forEach(function (e) {
      var sourceAlias = e.sourceAlias || e.sourceTable;
      var sourceCardKey = sourceAlias && sourceAlias !== e.sourceTable
        ? (e.sourceTable + " " + sourceAlias)
        : e.sourceTable;
      var targetCardKey = e.targetTable;
      var exprKey = targetCardKey + "::" + e.targetField;

      var srcCard = ensureCard(sourceCardKey, sourceCardKey);
      var tgtCard = ensureCard(targetCardKey, targetCardKey);
      srcCard.fieldSet[e.sourceField] = true;
      tgtCard.fieldSet[e.targetField] = true;

      if (sourceCardKey !== targetCardKey) {
        var depKey = sourceCardKey + "->" + targetCardKey;
        if (!deps[depKey]) {
          deps[depKey] = true;
          srcCard.out[targetCardKey] = true;
          tgtCard.inDegree += 1;
          if (!parentMap[targetCardKey]) {
            parentMap[targetCardKey] = {};
          }
          parentMap[targetCardKey][sourceCardKey] = true;
          if (!childMap[sourceCardKey]) {
            childMap[sourceCardKey] = {};
          }
          childMap[sourceCardKey][targetCardKey] = true;
        }
      }

      if (!exprMap[exprKey]) {
        exprMap[exprKey] = {
          key: exprKey,
          targetCardKey: targetCardKey,
          targetField: e.targetField,
          expression: e.expression || e.targetField,
          sourceCards: {},
          depth: 0.5,
        };
        exprList.push(exprMap[exprKey]);
      }
      exprMap[exprKey].sourceCards[sourceCardKey] = true;

      edgeInstances.push({
        sourceCardKey: sourceCardKey,
        sourceField: e.sourceField,
        exprKey: exprKey,
        targetCardKey: targetCardKey,
        targetField: e.targetField,
      });
    });

    Object.keys(cards).forEach(function (k) {
      cards[k].fields = Object.keys(cards[k].fieldSet).sort();
    });

    var queue = [];
    Object.keys(cards).forEach(function (k) {
      if (cards[k].inDegree === 0) {
        queue.push(k);
      }
      cards[k]._ind = cards[k].inDegree;
    });

    while (queue.length) {
      var cur = queue.shift();
      var nextKeys = Object.keys(cards[cur].out);
      for (var i = 0; i < nextKeys.length; i += 1) {
        var next = nextKeys[i];
        cards[next].depth = Math.max(cards[next].depth, cards[cur].depth + 1);
        cards[next]._ind -= 1;
        if (cards[next]._ind === 0) {
          queue.push(next);
        }
      }
    }

    var uniqDepths = {};
    Object.keys(cards).forEach(function (k) {
      uniqDepths[cards[k].depth] = true;
    });
    var sortedDepths = Object.keys(uniqDepths).map(function (x) { return Number(x); }).sort(function (a, b) { return a - b; });
    var depthMap = {};
    sortedDepths.forEach(function (d, idx) {
      depthMap[d] = idx;
    });
    Object.keys(cards).forEach(function (k) {
      cards[k].depth = depthMap[cards[k].depth];
    });

    exprList.forEach(function (expr) {
      var srcMax = 0;
      Object.keys(expr.sourceCards).forEach(function (sk) {
        if (cards[sk]) {
          srcMax = Math.max(srcMax, cards[sk].depth);
        }
      });
      var targetDepth = cards[expr.targetCardKey] ? cards[expr.targetCardKey].depth : (srcMax + 1);
      var d = srcMax + 0.5;
      if (d >= targetDepth) {
        d = targetDepth - 0.5;
      }
      if (d < 0) {
        d = 0.5;
      }
      expr.depth = d;
    });

    var columns = {};
    Object.keys(cards).forEach(function (k) {
      var d = String(cards[k].depth);
      if (!columns[d]) {
        columns[d] = { depth: cards[k].depth, cards: [], exprs: [] };
      }
      columns[d].cards.push(cards[k]);
    });
    exprList.forEach(function (expr) {
      var d = String(expr.depth);
      if (!columns[d]) {
        columns[d] = { depth: expr.depth, cards: [], exprs: [] };
      }
      columns[d].exprs.push(expr);
    });

    var colOrder = Object.keys(columns)
      .map(function (k) { return columns[k]; })
      .sort(function (a, b) { return a.depth - b.depth; });

    colOrder.forEach(function (col) {
      col.cards.sort(function (a, b) { return a.label.localeCompare(b.label); });
      col.exprs.sort(function (a, b) { return a.key.localeCompare(b.key); });
    });

    function buildPosMap() {
      var map = {};
      colOrder.forEach(function (col) {
        col.cards.forEach(function (card, idx) {
          map[card.key] = idx;
        });
      });
      return map;
    }

    function avgNeighborPos(cardKey, relMap, posMap) {
      var rel = relMap[cardKey] ? Object.keys(relMap[cardKey]) : [];
      if (!rel.length) {
        return Number.POSITIVE_INFINITY;
      }
      var sum = 0;
      var cnt = 0;
      for (var i = 0; i < rel.length; i += 1) {
        if (posMap[rel[i]] !== undefined) {
          sum += posMap[rel[i]];
          cnt += 1;
        }
      }
      return cnt ? (sum / cnt) : Number.POSITIVE_INFINITY;
    }

    for (var pass = 0; pass < 2; pass += 1) {
      var posMapL = buildPosMap();
      for (var li = 1; li < colOrder.length; li += 1) {
        colOrder[li].cards.sort(function (a, b) {
          var sa = avgNeighborPos(a.key, parentMap, posMapL);
          var sb = avgNeighborPos(b.key, parentMap, posMapL);
          if (sa !== sb) {
            return sa - sb;
          }
          return a.label.localeCompare(b.label);
        });
        posMapL = buildPosMap();
      }

      var posMapR = buildPosMap();
      for (var ri = colOrder.length - 2; ri >= 0; ri -= 1) {
        colOrder[ri].cards.sort(function (a, b) {
          var sa = avgNeighborPos(a.key, childMap, posMapR);
          var sb = avgNeighborPos(b.key, childMap, posMapR);
          if (sa !== sb) {
            return sa - sb;
          }
          return a.label.localeCompare(b.label);
        });
        posMapR = buildPosMap();
      }
    }

    return {
      cards: cards,
      exprList: exprList,
      columns: colOrder,
      edgeInstances: edgeInstances,
    };
  }

  function renderCard(card) {
    var isCollapsed = !!collapsedCards[card.key];
    var isExpanded = !!expandedCards[card.key];
    var fields = card.fields || [];
    var visibleCount = isCollapsed ? 0 : (isExpanded ? fields.length : Math.min(DEFAULT_VISIBLE_FIELDS, fields.length));
    var hiddenCount = Math.max(fields.length - visibleCount, 0);

    var html = [];
    html.push('<article class="lineage-card draggable-card graph-node table" data-node-id="card:' + escapeHtml(card.key) + '" data-draggable-id="card:' + escapeHtml(card.key) + '" data-card-key="' + escapeHtml(card.key) + '">');
    html.push('<div class="source-card-head drag-handle">');
    html.push('<div class="table-title">' + escapeHtml(card.label) + "</div>");
    html.push('<button class="table-toggle" data-table="' + escapeHtml(card.key) + '">' + (isCollapsed ? "展开" : "折叠") + "</button>");
    html.push("</div>");
    html.push('<div class="source-field-list">');
    for (var i = 0; i < visibleCount; i += 1) {
      var field = fields[i];
      var nodeId = "field:" + card.key + "::" + field;
      html.push('<button type="button" class="field-pill lineage-node graph-node field" data-node-id="' + escapeHtml(nodeId) + '" data-card-key="' + escapeHtml(card.key) + '" data-field="' + escapeHtml(field) + '">' + escapeHtml(field) + "</button>");
    }
    html.push("</div>");
    html.push('<button type="button" class="other-anchor lineage-node" data-node-id="other:' + escapeHtml(card.key) + '" data-action="toggle-fields" data-card="' + escapeHtml(card.key) + '">' + "Other fields(+" + hiddenCount + ")" + "</button>");
    html.push("</article>");
    return html.join("");
  }

  function renderExpr(expr) {
    var nodeId = "expr:" + expr.key;
    return [
      '<article class="expr-card draggable-card lineage-node graph-node expr" data-node-id="' + escapeHtml(nodeId) + '" data-draggable-id="' + escapeHtml(nodeId) + '" data-expr="' + escapeHtml(expr.expression) + '">',
      '<div class="drag-handle expr-handle">SELECT 原始表达式</div>',
      '<div class="expr-preview">' + escapeHtml(expr.expression) + "</div>",
      "</article>",
    ].join("");
  }

  function renderGraph(result) {
    if (!result || !(result.graphEdges && result.graphEdges.length) && !(result.lineageEdges && result.lineageEdges.length)) {
      treeView.innerHTML = '<div class="graph-empty">暂无图形数据</div>';
      visualEdges = [];
      return;
    }

    var model = buildGraphModel(result);
    var html = [];
    html.push('<div class="graph-toolbar">');
    html.push('<label class="toggle-wrap"><input id="relation-toggle" type="checkbox" ' + (relationMode ? "checked" : "") + ' />查看上下游关系</label>');
    html.push('<button class="mini-btn" data-action="toggle-fullscreen">' + (isTreeFullscreen() ? "退出全屏" : "血缘图全屏") + "</button>");
    html.push('<button class="mini-btn" data-action="expand-all">全部展开</button>');
    html.push('<button class="mini-btn" data-action="collapse-all">全部折叠</button>');
    html.push("</div>");

    html.push('<div class="graph-canvas datahub-canvas">');
    html.push('<svg class="graph-svg"></svg>');
    html.push('<div class="graph-columns graph-columns-dynamic" style="grid-template-columns:repeat(' + model.columns.length + ', minmax(320px, 1fr));">');

    model.columns.forEach(function (col) {
      html.push('<section class="graph-col dynamic-col" data-depth="' + col.depth + '">');
      if (Math.abs(col.depth % 1) > 0.001) {
        html.push("<h3>SELECT 原始表达式</h3>");
      } else {
        html.push("<h3>依赖层 " + (Math.floor(col.depth) + 1) + "</h3>");
      }
      col.cards.forEach(function (card) {
        html.push(renderCard(card));
      });
      col.exprs.forEach(function (expr) {
        html.push(renderExpr(expr));
      });
      html.push("</section>");
    });

    html.push("</div></div>");
    treeView.innerHTML = html.join("");

    applyCardOffsets();
    bindColumnInteractions();
    scheduleEdgeRender();
  }

  function bindColumnInteractions() {
    var toggle = treeView.querySelector("#relation-toggle");
    if (toggle) {
      toggle.addEventListener("change", function () {
        relationMode = !!toggle.checked;
        applySelectionStyles();
      });
    }
    var canvas = treeView.querySelector(".datahub-canvas");
    if (canvas) {
      canvas.addEventListener("scroll", scheduleEdgeRender);
    }
  }

  function applyCardOffsets() {
    var cards = treeView.querySelectorAll(".draggable-card");
    cards.forEach(function (el) {
      var id = el.getAttribute("data-draggable-id");
      var offset = cardOffsets[id];
      if (!offset) {
        el.style.transform = "";
        return;
      }
      el.style.transform = "translate(" + offset.x + "px," + offset.y + "px)";
    });
  }

  function isWithinViewport(el, container) {
    if (!el || !container || el.offsetParent === null) {
      return false;
    }
    var a = el.getBoundingClientRect();
    var b = container.getBoundingClientRect();
    return a.bottom > b.top && a.top < b.bottom && a.right > b.left && a.left < b.right;
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

  function getFieldNode(cardKey, field) {
    return treeView.querySelector('[data-node-id="field:' + cssEscape(cardKey + "::" + field) + '"]');
  }

  function getOtherNode(cardKey) {
    return treeView.querySelector('[data-node-id="other:' + cssEscape(cardKey) + '"]');
  }

  function renderEdges() {
    var canvas = treeView.querySelector(".datahub-canvas");
    var svg = treeView.querySelector(".graph-svg");
    if (!canvas || !svg || !latestResult) {
      visualEdges = [];
      return;
    }

    var model = buildGraphModel(latestResult);
    var canvasRect = canvas.getBoundingClientRect();
    var width = Math.max(canvas.scrollWidth, canvas.clientWidth);
    var height = Math.max(canvas.scrollHeight, canvas.clientHeight);
    svg.setAttribute("viewBox", "0 0 " + width + " " + height);
    svg.setAttribute("width", String(width));
    svg.setAttribute("height", String(height));

    var parts = [];
    parts.push('<defs><marker id="arrow" markerWidth="10" markerHeight="8" refX="9" refY="4" orient="auto"><path d="M0,0 L10,4 L0,8 z" fill="#4b5563"></path></marker></defs>');
    visualEdges = [];
    var seen = {};

    model.edgeInstances.forEach(function (edge) {
      var sourceFieldId = "field:" + edge.sourceCardKey + "::" + edge.sourceField;
      var exprId = "expr:" + edge.exprKey;
      var targetFieldId = "field:" + edge.targetCardKey + "::" + edge.targetField;

      var srcEl = getFieldNode(edge.sourceCardKey, edge.sourceField);
      var srcOther = getOtherNode(edge.sourceCardKey);
      var exprEl = treeView.querySelector('[data-node-id="' + cssEscape(exprId) + '"]');
      var tgtEl = getFieldNode(edge.targetCardKey, edge.targetField);
      var tgtOther = getOtherNode(edge.targetCardKey);

      if (!exprEl) {
        return;
      }

      var startEl = srcEl || srcOther;
      var endEl = tgtEl || tgtOther;
      var sourceFallback = !srcEl;
      var targetFallback = !tgtEl;
      if (!startEl || !endEl) {
        return;
      }

      var key1 = (sourceFallback ? "other:" + edge.sourceCardKey : sourceFieldId) + "->" + exprId;
      if (!seen[key1]) {
        seen[key1] = true;
        var d1 = edgePath(startEl.getBoundingClientRect(), exprEl.getBoundingClientRect(), canvasRect);
        var c1 = "graph-edge" + (sourceFallback ? " dashed" : "");
        parts.push('<path class="' + c1 + '" marker-end="url(#arrow)" d="' + d1 + '"></path>');
        visualEdges.push({
          from: sourceFallback ? ("other:" + edge.sourceCardKey) : sourceFieldId,
          to: exprId,
          dashed: sourceFallback,
        });
      }

      var key2 = exprId + "->" + (targetFallback ? ("other:" + edge.targetCardKey) : targetFieldId);
      if (!seen[key2]) {
        seen[key2] = true;
        var d2 = edgePath(exprEl.getBoundingClientRect(), endEl.getBoundingClientRect(), canvasRect);
        var c2 = "graph-edge" + (targetFallback ? " dashed" : "");
        parts.push('<path class="' + c2 + '" marker-end="url(#arrow)" d="' + d2 + '"></path>');
        visualEdges.push({
          from: exprId,
          to: targetFallback ? ("other:" + edge.targetCardKey) : targetFieldId,
          dashed: targetFallback,
        });
      }
    });

    svg.innerHTML = parts.join("");
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
    var selected = treeView.querySelector('[data-node-id="' + cssEscape(selectedNodeId) + '"]');
    if (selected) {
      selected.classList.add("selected");
    }

    if (!relationMode) {
      visualEdges.forEach(function (e, idx) {
        if (e.from === selectedNodeId || e.to === selectedNodeId) {
          paths[idx] && paths[idx].classList.add("active");
        }
      });
      return;
    }

    var adjacency = {};
    visualEdges.forEach(function (e) {
      if (!adjacency[e.from]) {
        adjacency[e.from] = [];
      }
      if (!adjacency[e.to]) {
        adjacency[e.to] = [];
      }
      adjacency[e.from].push(e.to);
      adjacency[e.to].push(e.from);
    });

    var related = {};
    var queue = [selectedNodeId];
    related[selectedNodeId] = true;
    while (queue.length) {
      var cur = queue.shift();
      var nexts = adjacency[cur] || [];
      for (var i = 0; i < nexts.length; i += 1) {
        var next = nexts[i];
        if (cur.indexOf("other:") === 0 && cur !== selectedNodeId) {
          continue;
        }
        if (!related[next]) {
          related[next] = true;
          queue.push(next);
        }
      }
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
      var e = visualEdges[idx];
      if (e && related[e.from] && related[e.to]) {
        p.classList.add("active");
      } else {
        p.classList.add("dim");
      }
    });
  }

  function clearSelection() {
    selectedNodeId = "";
    hideTooltip();
    applySelectionStyles();
  }

  function isTreeFullscreen() {
    return document.fullscreenElement === treeView;
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

  function syncFullscreenState() {
    treeView.classList.toggle("is-fullscreen", isTreeFullscreen());
    var btn = treeView.querySelector('[data-action="toggle-fullscreen"]');
    if (btn) {
      btn.textContent = isTreeFullscreen() ? "退出全屏" : "血缘图全屏";
    }
    scheduleEdgeRender();
  }

  function handleDragStart(event) {
    var handle = event.target.closest(".drag-handle");
    if (!handle) {
      return;
    }
    var card = handle.closest(".draggable-card");
    if (!card) {
      return;
    }
    var id = card.getAttribute("data-draggable-id");
    var base = cardOffsets[id] || { x: 0, y: 0 };
    dragState = {
      id: id,
      startX: event.clientX,
      startY: event.clientY,
      baseX: base.x,
      baseY: base.y,
    };
    event.preventDefault();
  }

  function handleDragMove(event) {
    if (!dragState) {
      return;
    }
    var dx = event.clientX - dragState.startX;
    var dy = event.clientY - dragState.startY;
    cardOffsets[dragState.id] = { x: dragState.baseX + dx, y: dragState.baseY + dy };
    applyCardOffsets();
    scheduleEdgeRender();
  }

  function handleDragEnd() {
    dragState = null;
  }

  tabs.forEach(function (tab) {
    tab.addEventListener("click", function () {
      switchMode(tab.getAttribute("data-mode"));
    });
  });

  treeView.addEventListener("click", function (event) {
    var actionBtn = event.target.closest(".mini-btn");
    if (actionBtn) {
      var cmd = actionBtn.getAttribute("data-action");
      if (cmd === "toggle-fullscreen") {
        toggleTreeFullscreen().catch(function (err) {
          setMessage("切换全屏失败：" + err.message, "error");
        });
        return;
      }
      if (!latestResult) {
        return;
      }
      var model = buildGraphModel(latestResult);
      if (cmd === "expand-all") {
        Object.keys(model.cards).forEach(function (k) {
          collapsedCards[k] = false;
          expandedCards[k] = true;
        });
      } else if (cmd === "collapse-all") {
        Object.keys(model.cards).forEach(function (k) {
          collapsedCards[k] = true;
          expandedCards[k] = false;
        });
      }
      renderGraph(latestResult);
      return;
    }

    var tableToggle = event.target.closest(".table-toggle");
    if (tableToggle) {
      var cardKey = tableToggle.getAttribute("data-table");
      collapsedCards[cardKey] = !collapsedCards[cardKey];
      renderGraph(latestResult);
      return;
    }

    var otherToggle = event.target.closest('[data-action="toggle-fields"]');
    if (otherToggle) {
      var key = otherToggle.getAttribute("data-card");
      if (!collapsedCards[key]) {
        expandedCards[key] = !expandedCards[key];
      }
      renderGraph(latestResult);
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
    var expr = event.target.closest(".expr-card");
    if (!expr) {
      return;
    }
    clearTimeout(exprTooltipTimer);
    var text = expr.getAttribute("data-expr") || "";
    exprTooltipTimer = setTimeout(function () {
      showTooltip(expr, text);
    }, 280);
  }, true);

  treeView.addEventListener("mouseleave", function (event) {
    var expr = event.target.closest(".expr-card");
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

  treeView.addEventListener("pointerdown", handleDragStart);
  window.addEventListener("pointermove", handleDragMove);
  window.addEventListener("pointerup", handleDragEnd);

  parseBtn.addEventListener("click", function () {
    try {
      var sql = currentInput().value;
      if (!sql || !sql.trim()) {
        setMessage("请输入 SQL 后再解析", "error");
        clearOutputs();
        return;
      }

      var result = runAnalysis(sql);
      latestResult = result;
      selectedNodeId = "";
      collapsedCards = {};
      expandedCards = {};
      cardOffsets = {};

      renderFieldRows(result.rows || []);
      renderLineage(result.lineageEdges || []);
      renderGraph(result);
      mermaidText.textContent = result.mermaid || "graph LR";
      astSummaryEl.textContent = "AST 摘要：\n" + JSON.stringify({
        astSummary: result.astSummary,
        consistencyCheck: result.consistencyCheck || { pass: true },
      }, null, 2);

      if (!result.rows || !result.rows.length) {
        setMessage("解析失败：未提取到字段", "error");
      } else if (result.warnings && result.warnings.length) {
        setMessage("解析完成（存在未识别链路）", "error");
      } else {
        setMessage("解析成功", "success");
      }
    } catch (err) {
      setMessage("解析失败：" + err.message, "error");
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
      if (!latestResult || !latestResult.rows || !latestResult.rows.length) {
        setMessage("暂无可复制结果", "error");
        return;
      }
      await navigator.clipboard.writeText(toTsv(latestResult.rows));
      setMessage("字段映射已复制", "success");
    } catch (err) {
      setMessage("复制失败：" + err.message, "error");
    }
  });

  window.addEventListener("resize", scheduleEdgeRender);
  document.addEventListener("fullscreenchange", syncFullscreenState);
  window.addEventListener("scroll", function () {
    if (!tooltip.classList.contains("hidden")) {
      var owner = treeView.querySelector('[data-node-id="' + cssEscape(tooltipOwnerId) + '"]');
      if (owner) {
        showTooltip(owner, owner.getAttribute("data-expr") || "");
      }
    }
    scheduleEdgeRender();
  }, { passive: true });

  switchMode("legacy");
})();
