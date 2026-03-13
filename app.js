(function () {
  "use strict";

  var activeMode = "legacy";
  var collapsedTables = {};
  var latestTreeRows = [];
  var latestSummary = null;

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
    latestSummary = null;
    collapsedTables = {};
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
        "<td>" + (row.sourceTable || "UNRESOLVED") + "</td>",
        "<td>" + (row.sourceField || "UNRESOLVED") + "</td>",
        "<td>" + (row.mappedField || "UNRESOLVED") + "</td>",
        "<td>" + (row.targetTable || "RESULT_1") + "</td>",
        "<td>" + (row.comment || "") + "</td>",
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
        "<td>" + (e.sourceTable || "UNRESOLVED") + "</td>",
        "<td>" + (e.sourceField || "UNRESOLVED") + "</td>",
        "<td>" + (e.targetTable || "RESULT_1") + "</td>",
        "<td>" + (e.targetField || "UNRESOLVED") + "</td>",
        "</tr>",
      ].join("");
    }).join("");
  }

  function escapeHtml(text) {
    return String(text)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/\"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function getCollapsedRows(treeRows) {
    if (!treeRows || !treeRows.length) {
      return [];
    }

    return treeRows.map(function (row) {
      var filtered = row.sources.filter(function (s) {
        return !collapsedTables[s.table];
      });
      return {
        targetField: row.targetField,
        targetTable: row.targetTable,
        sources: filtered,
      };
    });
  }

  function renderGraph(treeRows) {
    if (!treeRows || !treeRows.length) {
      treeView.innerHTML = '<div class="graph-empty">暂无图形数据</div>';
      return;
    }

    var visibleRows = getCollapsedRows(treeRows);

    var tableToFields = {};
    var tableOrder = [];
    var tableSeen = {};
    var fieldOrder = [];
    var fieldSeen = {};
    var targetOrder = [];
    var targetSeen = {};
    var resultOrder = [];
    var resultSeen = {};

    visibleRows.forEach(function (row) {
      if (!targetSeen[row.targetField]) {
        targetSeen[row.targetField] = true;
        targetOrder.push(row.targetField);
      }
      if (!resultSeen[row.targetTable]) {
        resultSeen[row.targetTable] = true;
        resultOrder.push(row.targetTable);
      }

      row.sources.forEach(function (s) {
        var tableName = s.table;
        var fieldName = s.field;
        var tfKey = tableName + "::" + fieldName;
        if (!tableSeen[tableName]) {
          tableSeen[tableName] = true;
          tableOrder.push(tableName);
          tableToFields[tableName] = [];
        }
        if (!fieldSeen[tfKey]) {
          fieldSeen[tfKey] = true;
          fieldOrder.push({ table: tableName, field: fieldName, key: tfKey });
          tableToFields[tableName].push(tfKey);
        }
      });
    });

    var allTables = {};
    treeRows.forEach(function (row) {
      row.sources.forEach(function (s) {
        allTables[s.table] = true;
      });
    });
    Object.keys(allTables).forEach(function (tableName) {
      if (!tableSeen[tableName]) {
        tableSeen[tableName] = true;
        tableOrder.push(tableName);
        tableToFields[tableName] = [];
      }
    });

    var tableNode = {};
    var fieldNode = {};
    var targetNode = {};
    var resultNode = {};

    var tableX = 24;
    var fieldX = 470;
    var targetX = 850;
    var resultX = 1220;

    var tableW = 300;
    var fieldW = 220;
    var targetW = 190;
    var resultW = 180;

    var tableH = 68;
    var fieldH = 54;
    var targetH = 54;
    var resultH = 56;

    var rowGap = 124;
    var topY = 24;
    var totalRows = Math.max(fieldOrder.length, targetOrder.length, tableOrder.length, 1);
    var canvasH = topY * 2 + totalRows * rowGap + 80;
    var canvasW = 1500;

    var html = [];
    html.push('<div class="graph-toolbar">');
    html.push('<button class="mini-btn" data-action="expand-all">全部展开</button>');
    html.push('<button class="mini-btn" data-action="collapse-all">全部折叠</button>');
    html.push('</div>');

    html.push('<div class="graph-canvas" style="height:' + canvasH + 'px; min-width:' + canvasW + 'px;">');
    html.push('<svg class="graph-svg" viewBox="0 0 ' + canvasW + ' ' + canvasH + '" preserveAspectRatio="none">');
    html.push('<defs><marker id="arrow" markerWidth="10" markerHeight="8" refX="9" refY="4" orient="auto"><path d="M0,0 L10,4 L0,8 z" fill="#2f3136"></path></marker></defs>');

    fieldOrder.forEach(function (item, idx) {
      var fy = topY + idx * rowGap + 6;
      fieldNode[item.key] = { x: fieldX, y: fy, w: fieldW, h: fieldH };
      html.push('<foreignObject x="' + fieldX + '" y="' + fy + '" width="' + fieldW + '" height="' + fieldH + '"><div xmlns="http://www.w3.org/1999/xhtml" class="graph-node field">' + escapeHtml(item.field) + '</div></foreignObject>');
    });

    tableOrder.forEach(function (tableName, idx) {
      var fields = tableToFields[tableName] || [];
      var ys = fields.map(function (k) { return fieldNode[k].y + fieldNode[k].h / 2; });
      var midY = ys.length ? (Math.min.apply(null, ys) + Math.max.apply(null, ys)) / 2 : (topY + idx * rowGap + tableH / 2);
      var ty = Math.max(topY, midY - tableH / 2);
      var collapsed = !!collapsedTables[tableName];
      tableNode[tableName] = { x: tableX, y: ty, w: tableW, h: tableH };
      html.push('<foreignObject x="' + tableX + '" y="' + ty + '" width="' + tableW + '" height="' + tableH + '"><div xmlns="http://www.w3.org/1999/xhtml" class="graph-node table' + (collapsed ? ' collapsed' : '') + '"><div class="table-title">' + escapeHtml(tableName) + '</div><button class="table-toggle" data-table="' + escapeHtml(tableName) + '">' + (collapsed ? '展开' : '折叠') + '</button></div></foreignObject>');
    });

    targetOrder.forEach(function (label, idx) {
      var y = topY + idx * rowGap + 6;
      targetNode[label] = { x: targetX, y: y, w: targetW, h: targetH };
      html.push('<foreignObject x="' + targetX + '" y="' + y + '" width="' + targetW + '" height="' + targetH + '"><div xmlns="http://www.w3.org/1999/xhtml" class="graph-node target">' + escapeHtml(label) + '</div></foreignObject>');
    });

    resultOrder.forEach(function (label, idx) {
      var y = topY + Math.floor(totalRows / 2) * rowGap + idx * (rowGap + 10);
      resultNode[label] = { x: resultX, y: y, w: resultW, h: resultH };
      html.push('<foreignObject x="' + resultX + '" y="' + y + '" width="' + resultW + '" height="' + resultH + '"><div xmlns="http://www.w3.org/1999/xhtml" class="graph-node result">' + escapeHtml(label) + '</div></foreignObject>');
    });

    function pathD(fromN, toN) {
      var sx = fromN.x + fromN.w;
      var sy = fromN.y + fromN.h / 2;
      var ex = toN.x;
      var ey = toN.y + toN.h / 2;
      var dx = ex - sx;
      var c1x = sx + Math.max(30, dx * 0.36);
      var c2x = ex - Math.max(30, dx * 0.36);
      return "M" + sx + "," + sy + " C" + c1x + "," + sy + " " + c2x + "," + ey + " " + ex + "," + ey;
    }

    var edgeSeen = {};

    Object.keys(tableToFields).forEach(function (tableName) {
      var tNode = tableNode[tableName];
      (tableToFields[tableName] || []).forEach(function (fKey) {
        var fNode = fieldNode[fKey];
        if (!tNode || !fNode) {
          return;
        }
        var eKey = "T->F:" + tableName + "->" + fKey;
        if (!edgeSeen[eKey]) {
          edgeSeen[eKey] = true;
          html.push('<path class="graph-edge" marker-end="url(#arrow)" d="' + pathD(tNode, fNode) + '"></path>');
        }
      });
    });

    visibleRows.forEach(function (row) {
      var t = targetNode[row.targetField];
      var r = resultNode[row.targetTable];

      row.sources.forEach(function (s) {
        var fKey = s.table + "::" + s.field;
        var fNode = fieldNode[fKey];
        if (!fNode || !t) {
          return;
        }
        var eKey = "F->M:" + fKey + "->" + row.targetField;
        if (!edgeSeen[eKey]) {
          edgeSeen[eKey] = true;
          html.push('<path class="graph-edge" marker-end="url(#arrow)" d="' + pathD(fNode, t) + '"></path>');
        }
      });

      if (t && r) {
        var eKey2 = "M->R:" + row.targetField + "->" + row.targetTable;
        if (!edgeSeen[eKey2]) {
          edgeSeen[eKey2] = true;
          html.push('<path class="graph-edge" marker-end="url(#arrow)" d="' + pathD(t, r) + '"></path>');
        }
      }
    });

    html.push('</svg></div>');
    treeView.innerHTML = html.join("");
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
      var shouldShow = (mode === "legacy" && forId === "legacy-input") || (mode === "standard" && forId === "standard-input");
      label.classList.toggle("hidden", !shouldShow);
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
      renderGraph(latestTreeRows);
      return;
    }

    var action = event.target.closest(".mini-btn");
    if (action) {
      var cmd = action.getAttribute("data-action");
      if (cmd === "expand-all") {
        Object.keys(collapsedTables).forEach(function (k) { collapsedTables[k] = false; });
        renderGraph(latestTreeRows);
      } else if (cmd === "collapse-all") {
        var tables = {};
        latestTreeRows.forEach(function (row) {
          row.sources.forEach(function (s) { tables[s.table] = true; });
        });
        Object.keys(tables).forEach(function (k) { collapsedTables[k] = true; });
        renderGraph(latestTreeRows);
      }
    }
  });

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
      latestSummary = {
        astSummary: result.astSummary,
        consistencyCheck: result.consistencyCheck || { pass: true },
      };

      renderFieldRows(result.rows);
      renderLineage(result.lineageEdges);
      renderGraph(latestTreeRows);
      mermaidText.textContent = result.mermaid || "graph LR";
      astSummaryEl.textContent = "AST 摘要：\n" + JSON.stringify(latestSummary, null, 2);

      if (!result.rows.length) {
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

  switchMode("legacy");
})();
