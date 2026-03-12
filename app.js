(function () {
  "use strict";

  var activeMode = "legacy";
  var tabs = Array.from(document.querySelectorAll(".tab"));
  var parseBtn = document.getElementById("parse-btn");
  var clearBtn = document.getElementById("clear-btn");
  var copyBtn = document.getElementById("copy-btn");
  var messageEl = document.getElementById("message");
  var resultBody = document.getElementById("result-body");
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

  function renderRows(rows) {
    if (!rows || !rows.length) {
      resultBody.innerHTML = '<tr><td colspan="5" class="empty">暂无结果</td></tr>';
      return;
    }

    var html = rows
      .map(function (row) {
        return [
          "<tr>",
          "<td>" + row.index + "</td>",
          "<td>" + (row.sourceTable || "未识别") + "</td>",
          "<td>" + (row.sourceField || "未识别") + "</td>",
          "<td>" + (row.mappedField || "未识别") + "</td>",
          "<td>" + (row.comment || "") + "</td>",
          "</tr>",
        ].join("");
      })
      .join("");

    resultBody.innerHTML = html;
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
    var header = ["序号", "来源表", "原始字段", "映射字段", "注释"];
    var content = rows.map(function (row) {
      return [row.index, row.sourceTable, row.sourceField, row.mappedField, row.comment || ""].join("\t");
    });
    return [header.join("\t")].concat(content).join("\n");
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
        renderRows([]);
        return;
      }

      var parsed = window.SQLParser.parseSqlFields(sql);
      if (!parsed.rows.length) {
        setMessage("解析失败：未提取到字段", "error");
        renderRows([]);
        return;
      }

      renderRows(parsed.rows);
      var tip = parsed.warnings.length
        ? "解析完成（部分字段未识别）"
        : "解析成功";
      setMessage(tip, "success");
    } catch (error) {
      setMessage("解析失败：" + error.message, "error");
      renderRows([]);
    }
  });

  clearBtn.addEventListener("click", function () {
    currentInput().value = "";
    renderRows([]);
    setMessage("已清空", "success");
  });

  copyBtn.addEventListener("click", async function () {
    try {
      var rows = Array.from(resultBody.querySelectorAll("tr"))
        .map(function (tr) {
          var tds = Array.from(tr.querySelectorAll("td"));
          if (tds.length !== 5) {
            return null;
          }
          return {
            index: tds[0].textContent,
            sourceTable: tds[1].textContent,
            sourceField: tds[2].textContent,
            mappedField: tds[3].textContent,
            comment: tds[4].textContent,
          };
        })
        .filter(Boolean);

      if (!rows.length) {
        setMessage("暂无可复制结果", "error");
        return;
      }

      await navigator.clipboard.writeText(toTsv(rows));
      setMessage("结果已复制到剪贴板", "success");
    } catch (error) {
      setMessage("复制失败：" + error.message, "error");
    }
  });

  switchMode("legacy");
})();