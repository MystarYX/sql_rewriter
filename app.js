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
  var latestModel = null;
  var visualEdges = [];
  var renderTicking = false;
  var dragState = null;
  var tooltipTimer = null;
  var tooltipPinned = false;

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

  function esc(text) {
    return String(text)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function cssEsc(text) {
    return String(text).replace(/\\/g, "\\\\").replace(/"/g, '\\"');
  }

  function setMessage(text, type) {
    messageEl.textContent = text || "";
    messageEl.className = "message" + (type ? " " + type : "");
  }

  function currentInput() {
    return activeMode === "legacy" ? legacyInput : standardInput;
  }

  function copyText(text) {
    if (navigator.clipboard && window.isSecureContext) {
      return navigator.clipboard.writeText(text || "");
    }
    return new Promise(function (resolve, reject) {
      try {
        var ta = document.createElement("textarea");
        ta.value = text || "";
        ta.style.position = "fixed";
        ta.style.opacity = "0";
        document.body.appendChild(ta);
        ta.focus();
        ta.select();
        var ok = document.execCommand("copy");
        document.body.removeChild(ta);
        if (!ok) {
          reject(new Error("浏览器不允许复制"));
          return;
        }
        resolve();
      } catch (e) {
        reject(e);
      }
    });
  }

  function createTooltip() {
    var el = document.createElement("div");
    el.className = "expr-tooltip hidden";
    el.innerHTML = '<div class="expr-tooltip-text"></div><button class="expr-copy-btn" type="button">复制</button>';
    document.body.appendChild(el);
    el.addEventListener("mouseenter", function () { tooltipPinned = true; });
    el.addEventListener("mouseleave", function () { tooltipPinned = false; hideTooltip(); });
    el.querySelector(".expr-copy-btn").addEventListener("click", function () {
      var text = el.querySelector(".expr-tooltip-text").textContent || "";
      copyText(text).then(function () {
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
    if (!tooltipPinned) {
      tooltip.classList.add("hidden");
    }
  }

  function clearOutputs() {
    resultBody.innerHTML = '<tr><td colspan="6" class="empty">暂无结果</td></tr>';
    lineageBody.innerHTML = '<tr><td colspan="4" class="empty">暂无血缘</td></tr>';
    treeView.innerHTML = '<div class="graph-empty">暂无图形数据</div>';
    mermaidText.textContent = "graph LR";
    astSummaryEl.textContent = "AST 摘要：暂无";
    latestResult = null;
    latestModel = null;
    selectedNodeId = "";
    visualEdges = [];
    collapsedCards = {};
    expandedCards = {};
    cardOffsets = {};
    hideTooltip();
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

  function runAnalysis(sql) {
    if (!window.SQLParser || typeof window.SQLParser.analyzeSqlLineage !== "function") {
      throw new Error("解析器未加载或版本不兼容，请刷新页面");
    }
    return window.SQLParser.analyzeSqlLineage(sql, {
      looseMainAlias: !looseModeToggle || !!looseModeToggle.checked,
    });
  }

  function cardKey(table, alias) {
    if (!table) {
      return "UNRESOLVED";
    }
    if (alias && alias !== table) {
      return table + " " + alias;
    }
    return table;
  }

  function buildModel(result) {
    var edges = (result.graphEdges && result.graphEdges.length ? result.graphEdges : result.lineageEdges) || [];
    var cards = {};
    var exprMap = {};
    var deps = {};
    var parentMap = {};
    var layoutParents = {};
    var edgeInstances = [];

    function ensureCard(key) {
      if (!cards[key]) {
        cards[key] = {
          key: key,
          label: key,
          fields: {},
          inDegree: 0,
          out: {},
          depth: 0,
        };
      }
      return cards[key];
    }

    function addLayoutParent(childId, parentId) {
      if (!layoutParents[childId]) {
        layoutParents[childId] = {};
      }
      layoutParents[childId][parentId] = true;
    }

    edges.forEach(function (e) {
      var srcKey = cardKey(e.sourceTable, e.sourceAlias);
      var tgtKey = e.targetTable || "RESULT_1";
      var exprKey = tgtKey + "::" + e.targetField;
      var src = ensureCard(srcKey);
      var tgt = ensureCard(tgtKey);
      var srcCardId = "card:" + srcKey;
      var exprNodeId = "expr:" + exprKey;
      var tgtCardId = "card:" + tgtKey;
      src.fields[e.sourceField || "UNRESOLVED"] = true;
      tgt.fields[e.targetField || "UNRESOLVED"] = true;

      if (srcKey !== tgtKey) {
        var dep = srcKey + "->" + tgtKey;
        if (!deps[dep]) {
          deps[dep] = true;
          src.out[tgtKey] = true;
          tgt.inDegree += 1;
          if (!parentMap[tgtKey]) {
            parentMap[tgtKey] = {};
          }
          parentMap[tgtKey][srcKey] = true;
        }
      }

      if (!exprMap[exprKey]) {
        exprMap[exprKey] = {
          key: exprKey,
          targetCardKey: tgtKey,
          targetField: e.targetField,
          expression: e.expression || e.targetField,
          sourceCards: {},
          depth: 0.5,
        };
      }
      exprMap[exprKey].sourceCards[srcKey] = true;
      addLayoutParent(exprNodeId, srcCardId);
      addLayoutParent(tgtCardId, exprNodeId);

      edgeInstances.push({
        sourceCardKey: srcKey,
        sourceField: e.sourceField,
        exprKey: exprKey,
        targetCardKey: tgtKey,
        targetField: e.targetField,
      });
    });

    Object.keys(cards).forEach(function (k) {
      cards[k].fieldList = Object.keys(cards[k].fields).sort();
      cards[k]._in = cards[k].inDegree;
    });

    var queue = Object.keys(cards).filter(function (k) { return cards[k]._in === 0; });
    while (queue.length) {
      var cur = queue.shift();
      Object.keys(cards[cur].out).forEach(function (next) {
        cards[next].depth = Math.max(cards[next].depth, cards[cur].depth + 1);
        cards[next]._in -= 1;
        if (cards[next]._in === 0) {
          queue.push(next);
        }
      });
    }

    var depthVals = Object.keys(cards).map(function (k) { return cards[k].depth; }).filter(function (v, i, a) {
      return a.indexOf(v) === i;
    }).sort(function (a, b) { return a - b; });

    var depthMap = {};
    depthVals.forEach(function (d, idx) { depthMap[d] = idx; });
    Object.keys(cards).forEach(function (k) {
      cards[k].depth = depthMap[cards[k].depth];
    });

    Object.keys(exprMap).forEach(function (k) {
      var expr = exprMap[k];
      var srcMax = 0;
      Object.keys(expr.sourceCards).forEach(function (srcKey) {
        if (cards[srcKey]) {
          srcMax = Math.max(srcMax, cards[srcKey].depth);
        }
      });
      var tgtDepth = cards[expr.targetCardKey] ? cards[expr.targetCardKey].depth : srcMax + 1;
      var d = srcMax + 0.5;
      if (d >= tgtDepth) {
        d = tgtDepth - 0.5;
      }
      expr.depth = d < 0 ? 0.5 : d;
    });

    var cols = {};
    Object.keys(cards).forEach(function (k) {
      var d = String(cards[k].depth);
      if (!cols[d]) {
        cols[d] = { depth: cards[k].depth, cards: [], exprs: [] };
      }
      cols[d].cards.push(cards[k]);
    });
    Object.keys(exprMap).forEach(function (k) {
      var expr = exprMap[k];
      var d = String(expr.depth);
      if (!cols[d]) {
        cols[d] = { depth: expr.depth, cards: [], exprs: [] };
      }
      cols[d].exprs.push(expr);
    });

    var columns = Object.keys(cols).map(function (k) { return cols[k]; }).sort(function (a, b) { return a.depth - b.depth; });
    columns.forEach(function (c) {
      c.exprs.sort(function (a, b) { return a.key.localeCompare(b.key); });
    });

    var cardOrder = {};
    columns.forEach(function (col, colIndex) {
      col.cards.sort(function (a, b) {
        if (colIndex === 0) {
          return a.label.localeCompare(b.label);
        }
        var pa = parentMap[a.key] ? Object.keys(parentMap[a.key]) : [];
        var pb = parentMap[b.key] ? Object.keys(parentMap[b.key]) : [];
        function parentScore(parents) {
          if (!parents.length) {
            return Number.POSITIVE_INFINITY;
          }
          var total = 0;
          var count = 0;
          parents.forEach(function (p) {
            if (cardOrder[p] !== undefined) {
              total += cardOrder[p];
              count += 1;
            }
          });
          return count ? (total / count) : Number.POSITIVE_INFINITY;
        }
        var sa = parentScore(pa);
        var sb = parentScore(pb);
        if (sa !== sb) {
          return sa - sb;
        }
        return a.label.localeCompare(b.label);
      });
      col.cards.forEach(function (card, idx) {
        cardOrder[card.key] = idx;
      });
    });

    Object.keys(cards).forEach(function (k) {
      var card = cards[k];
      var outDegree = Object.keys(card.out || {}).length;
      if (card.key === "SYS_FUNC" || card.inDegree === 0) {
        card.kind = "src";
      } else if (outDegree === 0 || /^RESULT_/i.test(card.key)) {
        card.kind = "dst";
      } else {
        card.kind = "sub";
      }
    });

    Object.keys(layoutParents).forEach(function (nodeId) {
      layoutParents[nodeId] = Object.keys(layoutParents[nodeId]);
    });

    return {
      columns: columns,
      edgeInstances: edgeInstances,
      layoutParents: layoutParents,
    };
  }

  function renderFieldRows(rows) {
    if (!rows || !rows.length) {
      resultBody.innerHTML = '<tr><td colspan="6" class="empty">暂无结果</td></tr>';
      return;
    }
    resultBody.innerHTML = rows.map(function (row, idx) {
      return '<tr><td>' + (idx + 1) + '</td><td>' + esc(row.sourceTable || 'UNRESOLVED') + '</td><td>' + esc(row.sourceField || 'UNRESOLVED') + '</td><td>' + esc(row.mappedField || 'UNRESOLVED') + '</td><td>' + esc(row.targetTable || 'RESULT_1') + '</td><td>' + esc(row.comment || '') + '</td></tr>';
    }).join('');
  }

  function renderLineage(edges) {
    if (!edges || !edges.length) {
      lineageBody.innerHTML = '<tr><td colspan="4" class="empty">暂无血缘</td></tr>';
      return;
    }
    lineageBody.innerHTML = edges.map(function (e) {
      var sourceLabel = e.sourceAlias && e.sourceAlias !== e.sourceTable ? (e.sourceTable + ' ' + e.sourceAlias) : e.sourceTable;
      return '<tr><td>' + esc(sourceLabel || 'UNRESOLVED') + '</td><td>' + esc(e.sourceField || 'UNRESOLVED') + '</td><td>' + esc(e.targetTable || 'RESULT_1') + '</td><td>' + esc(e.targetField || 'UNRESOLVED') + '</td></tr>';
    }).join('');
  }

  function renderCard(card) {
    var isCollapsed = !!collapsedCards[card.key];
    var isExpanded = !!expandedCards[card.key];
    var fields = card.fieldList || [];
    var visibleCount = isCollapsed ? 0 : (isExpanded ? fields.length : Math.min(DEFAULT_VISIBLE_FIELDS, fields.length));
    var hiddenCount = Math.max(fields.length - visibleCount, 0);
    var kind = card.kind || "sub";
    var meta = kind === "src" ? "来源表" : (kind === "dst" ? "目标表" : "派生表");
    var kindLabel = kind === "src" ? "源" : (kind === "dst" ? "目标" : "中间");
    var html = [];
    html.push('<article class="lineage-card draggable-card graph-node table ' + kind + '" data-draggable-id="card:' + esc(card.key) + '" data-card-key="' + esc(card.key) + '">');
    html.push('<div class="source-card-head drag-handle"><div class="table-head"><div class="table-meta">' + meta + '</div><div class="table-title">' + esc(card.label) + '</div></div><span class="kind-pill ' + kind + '">' + kindLabel + '</span><button class="table-toggle" data-table="' + esc(card.key) + '">' + (isCollapsed ? '展开' : '折叠') + '</button></div>');
    html.push('<div class="source-field-list">');
    for (var i = 0; i < visibleCount; i += 1) {
      var field = fields[i];
      var nodeId = 'field:' + card.key + '::' + field;
      html.push('<button type="button" class="field-pill lineage-node graph-node field field-row" data-node-id="' + esc(nodeId) + '">' + esc(field) + '</button>');
    }
    html.push('</div>');
    html.push('<button type="button" class="other-anchor lineage-node" data-node-id="other:' + esc(card.key) + '" data-action="toggle-fields" data-card="' + esc(card.key) + '"><span>其他字段</span><span class="other-count">+' + hiddenCount + '</span></button>');
    html.push('</article>');
    return html.join('');
  }

  function renderExpr(expr) {
    var nodeId = 'expr:' + expr.key;
    return '<article class="expr-card draggable-card lineage-node graph-node expr" data-node-id="' + esc(nodeId) + '" data-draggable-id="' + esc(nodeId) + '" data-expr="' + esc(expr.expression || '') + '"><div class="drag-handle expr-handle">SELECT 原始表达式</div><div class="expr-preview">' + esc(expr.expression || '') + '</div><div class="expr-target">映射到：' + esc(expr.targetField || "") + '</div></article>';
  }

  function renderGraph(result) {
    if (!result || (!(result.graphEdges && result.graphEdges.length) && !(result.lineageEdges && result.lineageEdges.length))) {
      treeView.innerHTML = '<div class="graph-empty">暂无图形数据</div>';
      latestModel = null;
      visualEdges = [];
      return;
    }

    var model = buildModel(result);
    latestModel = model;

    var html = [];
    html.push('<div class="graph-toolbar"><label class="toggle-wrap"><input id="relation-toggle" type="checkbox" ' + (relationMode ? 'checked' : '') + ' />查看上下游关系</label><button class="mini-btn" data-action="toggle-fullscreen">' + (document.fullscreenElement === treeView ? '退出全屏' : '血缘图全屏') + '</button><button class="mini-btn" data-action="expand-all">全部展开</button><button class="mini-btn" data-action="collapse-all">全部折叠</button></div>');
    html.push('<div class="graph-canvas datahub-canvas"><svg class="graph-svg"></svg><div class="graph-columns graph-columns-dynamic" style="grid-template-columns:repeat(' + model.columns.length + ', minmax(460px, 460px));">');
    model.columns.forEach(function (col, colIndex) {
      html.push('<section class="graph-col dynamic-col" data-depth="' + col.depth + '">');
      var title = '来源字段';
      if (Math.abs(col.depth % 1) > 0.001) {
        title = 'SELECT 原始表达式';
      } else if (colIndex === 0) {
        title = '来源表';
      } else if (colIndex === model.columns.length - 1) {
        title = '目标表';
      } else {
        title = '中间表';
      }
      html.push('<h3>' + title + '</h3>');
      col.cards.forEach(function (card) { html.push(renderCard(card)); });
      col.exprs.forEach(function (expr) { html.push(renderExpr(expr)); });
      html.push('</section>');
    });
    html.push('</div></div>');
    treeView.innerHTML = html.join('');
  }

  function bindInteractions() {
    var toggle = treeView.querySelector('#relation-toggle');
    if (toggle) {
      toggle.addEventListener('change', function () {
        relationMode = !!toggle.checked;
        applySelectionStyles();
      });
    }
    var canvas = treeView.querySelector('.datahub-canvas');
    if (canvas) {
      canvas.addEventListener('scroll', scheduleEdgeRender, { passive: true });
    }
  }

  function layoutGraph() {
    var cols = Array.from(treeView.querySelectorAll('.dynamic-col'));
    var maxHeight = 760;
    var topStart = 52;
    var gap = 28;
    var centerByCard = {};

    cols.forEach(function (col) {
      var cards = Array.from(col.querySelectorAll('.draggable-card'));
      var items = cards.map(function (card, idx) {
        var id = card.getAttribute('data-draggable-id') || '';
        var height = Math.max(card.offsetHeight || 0, 90);
        var parents = latestModel && latestModel.layoutParents ? (latestModel.layoutParents[id] || []) : [];
        var parentCenters = parents
          .map(function (parentId) { return centerByCard[parentId]; })
          .filter(function (v) { return typeof v === "number" && !Number.isNaN(v); });
        var desiredTop = parentCenters.length
          ? (parentCenters.reduce(function (sum, v) { return sum + v; }, 0) / parentCenters.length - height / 2)
          : (topStart + idx * (height + gap));
        return {
          id: id,
          card: card,
          order: idx,
          height: height,
          desiredTop: desiredTop,
        };
      });

      items.sort(function (a, b) {
        if (a.desiredTop !== b.desiredTop) {
          return a.desiredTop - b.desiredTop;
        }
        return a.order - b.order;
      });

      var cursor = topStart;
      items.forEach(function (item) {
        var top = Math.max(cursor, item.desiredTop);
        item.card.style.top = Math.round(top) + 'px';
        var offset = cardOffsets[item.id];
        item.card.style.transform = offset ? ('translate(' + offset.x + 'px,' + offset.y + 'px)') : '';
        centerByCard[item.id] = top + item.height / 2 + (offset ? offset.y : 0);
        cursor = top + item.height + gap;
      });

      var colHeight = Math.max(cursor + 20, 420);
      col.style.height = colHeight + 'px';
      maxHeight = Math.max(maxHeight, colHeight);
    });

    var canvas = treeView.querySelector('.graph-canvas');
    if (canvas) {
      canvas.style.minHeight = Math.max(maxHeight + 20, 820) + 'px';
    }
  }

  function isVisible(el, container) {
    if (!el) {
      return false;
    }
    if (el.classList.contains('other-anchor')) {
      return true;
    }
    if (el.offsetParent === null) {
      return false;
    }
    if (!container) {
      return true;
    }
    var a = el.getBoundingClientRect();
    var b = container.getBoundingClientRect();
    return a.top >= b.top && a.bottom <= b.bottom;
  }

  function pathD(fromRect, toRect, baseRect) {
    var sx = fromRect.right - baseRect.left;
    var sy = fromRect.top + fromRect.height / 2 - baseRect.top;
    var ex = toRect.left - baseRect.left;
    var ey = toRect.top + toRect.height / 2 - baseRect.top;
    var dx = ex - sx;
    var c1x = sx + Math.max(48, dx * 0.42);
    var c2x = ex - Math.max(48, dx * 0.42);
    return 'M' + sx + ',' + sy + ' C' + c1x + ',' + sy + ' ' + c2x + ',' + ey + ' ' + ex + ',' + ey;
  }

  function scheduleEdgeRender() {
    if (renderTicking) {
      return;
    }
    renderTicking = true;
    requestAnimationFrame(function () {
      renderTicking = false;
      renderEdges();
      applySelectionStyles();
    });
  }

  function renderEdges() {
    var canvas = treeView.querySelector('.datahub-canvas');
    var svg = treeView.querySelector('.graph-svg');
    if (!canvas || !svg || !latestModel) {
      visualEdges = [];
      return;
    }

    var base = canvas.getBoundingClientRect();
    var width = Math.max(canvas.scrollWidth, canvas.clientWidth);
    var height = Math.max(canvas.scrollHeight, canvas.clientHeight);
    svg.setAttribute('viewBox', '0 0 ' + width + ' ' + height);
    svg.setAttribute('width', String(width));
    svg.setAttribute('height', String(height));

    var parts = ['<defs><marker id="arrow" markerWidth="10" markerHeight="8" refX="9" refY="4" orient="auto"><path d="M0,0 L10,4 L0,8 z" fill="#4b5563"></path></marker></defs>'];
    var seen = {};
    visualEdges = [];

    latestModel.edgeInstances.forEach(function (edge) {
      var srcId = 'field:' + edge.sourceCardKey + '::' + edge.sourceField;
      var exprId = 'expr:' + edge.exprKey;
      var tgtId = 'field:' + edge.targetCardKey + '::' + edge.targetField;

      var src = treeView.querySelector('[data-node-id="' + cssEsc(srcId) + '"]');
      var srcOther = treeView.querySelector('[data-node-id="' + cssEsc('other:' + edge.sourceCardKey) + '"]');
      var expr = treeView.querySelector('[data-node-id="' + cssEsc(exprId) + '"]');
      var tgt = treeView.querySelector('[data-node-id="' + cssEsc(tgtId) + '"]');
      var tgtOther = treeView.querySelector('[data-node-id="' + cssEsc('other:' + edge.targetCardKey) + '"]');
      if (!expr) {
        return;
      }

      var srcFallback = !src || !isVisible(src, src ? src.closest('.source-field-list') : null);
      var tgtFallback = !tgt || !isVisible(tgt, tgt ? tgt.closest('.source-field-list') : null);
      var startEl = srcFallback ? srcOther : src;
      var endEl = tgtFallback ? tgtOther : tgt;
      if (!startEl || !endEl) {
        return;
      }

      var fromNode = srcFallback ? ('other:' + edge.sourceCardKey) : srcId;
      var toNode = tgtFallback ? ('other:' + edge.targetCardKey) : tgtId;

      var k1 = fromNode + '->' + exprId;
      if (!seen[k1]) {
        seen[k1] = true;
        parts.push('<path class="graph-edge' + (srcFallback ? ' dashed' : '') + '" marker-end="url(#arrow)" d="' + pathD(startEl.getBoundingClientRect(), expr.getBoundingClientRect(), base) + '"></path>');
        visualEdges.push({ from: fromNode, to: exprId });
      }

      var k2 = exprId + '->' + toNode;
      if (!seen[k2]) {
        seen[k2] = true;
        parts.push('<path class="graph-edge' + (tgtFallback ? ' dashed' : '') + '" marker-end="url(#arrow)" d="' + pathD(expr.getBoundingClientRect(), endEl.getBoundingClientRect(), base) + '"></path>');
        visualEdges.push({ from: exprId, to: toNode });
      }
    });

    svg.innerHTML = parts.join('');
  }

  function applySelectionStyles() {
    var nodes = Array.from(treeView.querySelectorAll('.lineage-node'));
    var edges = Array.from(treeView.querySelectorAll('.graph-edge'));
    nodes.forEach(function (n) { n.classList.remove('selected', 'active', 'dim'); });
    edges.forEach(function (e) { e.classList.remove('active', 'dim'); });
    if (!selectedNodeId) {
      return;
    }

    var selected = treeView.querySelector('[data-node-id="' + cssEsc(selectedNodeId) + '"]');
    if (selected) {
      selected.classList.add('selected');
      selected.classList.add('active');
    }

    if (!relationMode) {
      visualEdges.forEach(function (e, idx) {
        if (e.from === selectedNodeId || e.to === selectedNodeId) {
          edges[idx] && edges[idx].classList.add('active');
        }
      });
      return;
    }

    var out = {}, inn = {};
    visualEdges.forEach(function (e) {
      (out[e.from] = out[e.from] || []).push(e.to);
      (inn[e.to] = inn[e.to] || []).push(e.from);
    });

    function walk(start, graph) {
      var q = [start], seen = {};
      seen[start] = true;
      while (q.length) {
        var cur = q.shift();
        if (cur.indexOf('other:') === 0 && cur !== start) {
          continue;
        }
        (graph[cur] || []).forEach(function (next) {
          if (!seen[next]) {
            seen[next] = true;
            q.push(next);
          }
        });
      }
      return seen;
    }

    var up = walk(selectedNodeId, inn);
    var down = walk(selectedNodeId, out);
    var related = {};
    Object.keys(up).forEach(function (k) { related[k] = true; });
    Object.keys(down).forEach(function (k) { related[k] = true; });

    nodes.forEach(function (n) {
      var id = n.getAttribute('data-node-id') || '';
      n.classList.add(related[id] ? 'active' : 'dim');
    });
    edges.forEach(function (p, idx) {
      var e = visualEdges[idx];
      p.classList.add(e && related[e.from] && related[e.to] ? 'active' : 'dim');
    });
  }

  function clearSelection() {
    selectedNodeId = '';
    applySelectionStyles();
  }

  tabs.forEach(function (tab) {
    tab.addEventListener('click', function () {
      switchMode(tab.getAttribute('data-mode'));
    });
  });

  treeView.addEventListener('click', function (event) {
    var btn = event.target.closest('.mini-btn');
    if (btn) {
      var cmd = btn.getAttribute('data-action');
      if (cmd === 'toggle-fullscreen') {
        if (!document.fullscreenEnabled) {
          setMessage('当前浏览器不支持全屏', 'error');
        } else if (document.fullscreenElement === treeView) {
          document.exitFullscreen();
        } else {
          treeView.requestFullscreen();
        }
        return;
      }
      if (!latestModel || !latestResult) {
        return;
      }
      if (cmd === 'expand-all') {
        latestModel.columns.forEach(function (col) {
          col.cards.forEach(function (card) {
            collapsedCards[card.key] = false;
            expandedCards[card.key] = true;
          });
        });
      }
      if (cmd === 'collapse-all') {
        latestModel.columns.forEach(function (col) {
          col.cards.forEach(function (card) {
            collapsedCards[card.key] = true;
            expandedCards[card.key] = false;
          });
        });
      }
      renderGraph(latestResult);
      layoutGraph();
      bindInteractions();
      scheduleEdgeRender();
      return;
    }

    var tableToggle = event.target.closest('.table-toggle');
    if (tableToggle && latestResult) {
      var key = tableToggle.getAttribute('data-table');
      collapsedCards[key] = !collapsedCards[key];
      if (collapsedCards[key]) {
        expandedCards[key] = false;
      }
      renderGraph(latestResult);
      layoutGraph();
      bindInteractions();
      scheduleEdgeRender();
      return;
    }

    var otherToggle = event.target.closest('[data-action="toggle-fields"]');
    if (otherToggle && latestResult) {
      var cardKey = otherToggle.getAttribute('data-card');
      if (collapsedCards[cardKey]) {
        collapsedCards[cardKey] = false;
      } else {
        expandedCards[cardKey] = !expandedCards[cardKey];
      }
      renderGraph(latestResult);
      layoutGraph();
      bindInteractions();
      scheduleEdgeRender();
      return;
    }

    var node = event.target.closest('.lineage-node');
    if (node) {
      var nodeId = node.getAttribute('data-node-id') || '';
      selectedNodeId = selectedNodeId === nodeId ? '' : nodeId;
      applySelectionStyles();
      return;
    }

    clearSelection();
  });

  treeView.addEventListener('mouseenter', function (event) {
    var expr = event.target.closest('.expr-card');
    if (!expr) {
      return;
    }
    clearTimeout(tooltipTimer);
    var text = expr.getAttribute('data-expr') || '';
    tooltipTimer = setTimeout(function () { showTooltip(expr, text); }, 280);
  }, true);

  treeView.addEventListener('mouseleave', function (event) {
    if (!event.target.closest('.expr-card')) {
      return;
    }
    clearTimeout(tooltipTimer);
    setTimeout(function () { hideTooltip(); }, 90);
  }, true);

  treeView.addEventListener('pointerdown', function (event) {
    var handle = event.target.closest('.drag-handle');
    if (!handle) {
      return;
    }
    var card = handle.closest('.draggable-card');
    if (!card) {
      return;
    }
    var id = card.getAttribute('data-draggable-id');
    var base = cardOffsets[id] || { x: 0, y: 0 };
    dragState = { id: id, sx: event.clientX, sy: event.clientY, bx: base.x, by: base.y };
    event.preventDefault();
  });

  window.addEventListener('pointermove', function (event) {
    if (!dragState) {
      return;
    }
    var dx = event.clientX - dragState.sx;
    var dy = event.clientY - dragState.sy;
    cardOffsets[dragState.id] = { x: dragState.bx + dx, y: dragState.by + dy };
    Array.from(treeView.querySelectorAll('.draggable-card')).forEach(function (el) {
      var id = el.getAttribute('data-draggable-id');
      var offset = cardOffsets[id];
      el.style.transform = offset ? ('translate(' + offset.x + 'px,' + offset.y + 'px)') : '';
    });
    scheduleEdgeRender();
  });

  window.addEventListener('pointerup', function () { dragState = null; });
  window.addEventListener('resize', function () {
    if (latestModel) {
      layoutGraph();
      scheduleEdgeRender();
    }
  });

  parseBtn.addEventListener('click', function () {
    try {
      var sql = currentInput().value;
      if (!sql || !sql.trim()) {
        setMessage('请输入 SQL 后再解析', 'error');
        clearOutputs();
        return;
      }
      var result = runAnalysis(sql);
      latestResult = result;
      selectedNodeId = '';
      collapsedCards = {};
      expandedCards = {};
      cardOffsets = {};
      renderFieldRows(result.rows || []);
      renderLineage(result.lineageEdges || []);
      renderGraph(result);
      layoutGraph();
      bindInteractions();
      mermaidText.textContent = result.mermaid || 'graph LR';
      astSummaryEl.textContent = 'AST 摘要：\n' + JSON.stringify({ astSummary: result.astSummary, consistencyCheck: result.consistencyCheck || { pass: true } }, null, 2);
      if (!result.rows || !result.rows.length) {
        setMessage('解析失败：未提取到字段', 'error');
      } else if (result.warnings && result.warnings.length) {
        setMessage('解析完成（存在未识别链路）', 'error');
      } else {
        setMessage('解析成功', 'success');
      }
      scheduleEdgeRender();
    } catch (err) {
      setMessage('解析失败：' + err.message, 'error');
      clearOutputs();
    }
  });

  clearBtn.addEventListener('click', function () {
    currentInput().value = '';
    clearOutputs();
    setMessage('已清空', 'success');
  });

  copyBtn.addEventListener('click', async function () {
    try {
      if (!latestResult || !latestResult.rows || !latestResult.rows.length) {
        setMessage('暂无可复制结果', 'error');
        return;
      }
      var header = ['序号', '来源表', '原始字段', '映射字段', '目标表', '注释'];
      var lines = latestResult.rows.map(function (r, i) {
        return [i + 1, r.sourceTable || '未识别', r.sourceField || '未识别', r.mappedField || '未识别', r.targetTable || 'RESULT_1', r.comment || ''].join('\t');
      });
      await copyText([header.join('\t')].concat(lines).join('\n'));
      setMessage('字段映射已复制', 'success');
    } catch (err) {
      setMessage('复制失败：' + err.message, 'error');
    }
  });

  document.addEventListener('fullscreenchange', function () {
    var btn = treeView.querySelector('[data-action="toggle-fullscreen"]');
    if (btn) {
      btn.textContent = document.fullscreenElement === treeView ? '退出全屏' : '血缘图全屏';
    }
    scheduleEdgeRender();
  });

  clearOutputs();
  switchMode('legacy');
})();
