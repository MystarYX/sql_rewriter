(function () {
  "use strict";

  var activeMode = "legacy";
  var tabs = Array.from(document.querySelectorAll(".tab"));
  var parseBtn = document.getElementById("parse-btn");
  var clearBtn = document.getElementById("clear-btn");
  var copyBtn = document.getElementById("copy-btn");
  var messageEl = document.getElementById("message");
  var astSummaryEl = document.getElementById("ast-summary");

  var resultBody = document.getElementById("result-body");
  var lineageBody = document.getElementById("lineage-body");

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

  function renderFieldRows(rows) {
    if (!rows || !rows.length) {
      resultBody.innerHTML = '<tr><td colspan="6" class="empty">暂无结果</td></tr>';
      return;
    }

    resultBody.innerHTML = rows
      .map(function (row, idx) {
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
      })
      .join("");
  }

  function renderLineage(rows) {
    if (!rows || !rows.length) {
      lineageBody.innerHTML = '<tr><td colspan="4" class="empty">暂无血缘</td></tr>';
      return;
    }

    lineageBody.innerHTML = rows
      .map(function (row) {
        return [
          "<tr>",
          "<td>" + (row.sourceTable || "UNRESOLVED") + "</td>",
          "<td>" + (row.sourceField || "UNRESOLVED") + "</td>",
          "<td>" + (row.targetTable || "RESULT_1") + "</td>",
          "<td>" + (row.targetField || "UNRESOLVED") + "</td>",
          "</tr>",
        ].join("");
      })
      .join("");
  }

  function clearOutputs() {
    renderFieldRows([]);
    renderLineage([]);
    astSummaryEl.textContent = "AST 摘要：暂无";
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
      var shouldShow = (mode === "legacy" && forId === "legacy-input") ||
        (mode === "standard" && forId === "standard-input");
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

  parseBtn.addEventListener("click", function () {
    try {
      var sql = currentInput().value;
      if (!sql || !sql.trim()) {
        setMessage("请输入 SQL 后再解析", "error");
        clearOutputs();
        return;
      }

      var result = runAnalysis(sql);
      renderFieldRows(result.rows);
      renderLineage(result.lineageEdges);
      astSummaryEl.textContent = "AST 摘要：" + JSON.stringify(result.astSummary, null, 2);

      if (!result.rows.length) {
        setMessage("解析失败：未提取到字段", "error");
      } else if (result.warnings && result.warnings.length) {
        setMessage("解析完成（存在未识别链路，请查看调试信息）", "error");
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