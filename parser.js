(function (globalScope) {
  "use strict";

  function normalizeSql(sql) {
    return (sql || "").replace(/\r\n?/g, "\n").trim();
  }

  function stripStatementTail(sql) {
    return sql.replace(/;\s*$/, "");
  }

  function findFromIndex(sql) {
    var depth = 0;
    var inSingle = false;
    var inDouble = false;

    for (var i = 0; i < sql.length; i += 1) {
      var ch = sql[i];
      var prev = i > 0 ? sql[i - 1] : "";

      if (ch === "'" && !inDouble && prev !== "\\") {
        inSingle = !inSingle;
      } else if (ch === '"' && !inSingle && prev !== "\\") {
        inDouble = !inDouble;
      }

      if (inSingle || inDouble) {
        continue;
      }

      if (ch === "(") {
        depth += 1;
      } else if (ch === ")") {
        depth = Math.max(0, depth - 1);
      }

      if (depth === 0 && /^from\b/i.test(sql.slice(i))) {
        return i;
      }
    }

    return -1;
  }

  function splitSelectItems(selectPart) {
    var result = [];
    var token = "";
    var depth = 0;
    var inSingle = false;
    var inDouble = false;

    for (var i = 0; i < selectPart.length; i += 1) {
      var ch = selectPart[i];
      var prev = i > 0 ? selectPart[i - 1] : "";

      if (ch === "'" && !inDouble && prev !== "\\") {
        inSingle = !inSingle;
      } else if (ch === '"' && !inSingle && prev !== "\\") {
        inDouble = !inDouble;
      }

      if (!inSingle && !inDouble) {
        if (ch === "(") {
          depth += 1;
        } else if (ch === ")") {
          depth = Math.max(0, depth - 1);
        }
      }

      if (ch === "," && depth === 0 && !inSingle && !inDouble) {
        if (token.trim()) {
          result.push(token.trim());
        }
        token = "";
      } else {
        token += ch;
      }
    }

    if (token.trim()) {
      result.push(token.trim());
    }

    return result;
  }

  function stripTrailingComment(item) {
    var comment = "";
    var clean = item;

    var lineMatch = item.match(/\s--\s*(.+)$/);
    if (lineMatch) {
      comment = lineMatch[1].trim();
      clean = item.slice(0, lineMatch.index).trim();
      return { clean: clean, comment: comment };
    }

    var blockMatch = item.match(/\/\*\s*([\s\S]*?)\s*\*\/$/);
    if (blockMatch) {
      comment = blockMatch[1].replace(/\s+/g, " ").trim();
      clean = item.slice(0, blockMatch.index).trim();
      return { clean: clean, comment: comment };
    }

    return { clean: clean.trim(), comment: "" };
  }

  function parseFieldExpression(item) {
    var commentInfo = stripTrailingComment(item);
    var clean = commentInfo.clean;
    var comment = commentInfo.comment;
    var aliasPattern = '(?:"[^"]+"|`[^`]+`|\\[[^\\]]+\\]|[a-zA-Z_][\\w$]*)';

    var asMatch = clean.match(new RegExp("^(.+?)\\s+as\\s+(" + aliasPattern + ")$", "i"));
    if (asMatch) {
      return {
        sourceField: asMatch[1].trim(),
        mappedField: normalizeAlias(asMatch[2].trim()),
        comment: comment,
      };
    }

    var noAsMatch = clean.match(new RegExp("^(.*\\S)\\s+(" + aliasPattern + ")$"));
    if (noAsMatch) {
      var sourceCandidate = noAsMatch[1].trim();
      var aliasCandidate = normalizeAlias(noAsMatch[2].trim());

      if (isSimpleColumnExpr(sourceCandidate) && !/^distinct$/i.test(sourceCandidate)) {
        return {
          sourceField: sourceCandidate,
          mappedField: aliasCandidate,
          comment: comment,
        };
      }
    }

    return {
      sourceField: clean,
      mappedField: clean,
      comment: comment,
    };
  }

  function normalizeAlias(alias) {
    if (/^".+"$/.test(alias) || /^`.+`$/.test(alias) || /^\[.+\]$/.test(alias)) {
      return alias.slice(1, -1);
    }
    return alias;
  }

  function isSimpleColumnExpr(expr) {
    return /^(?:(?:[a-zA-Z_][\w$]*|`[^`]+`|\[[^\]]+\]|"[^"]+")(?:\.(?:[a-zA-Z_][\w$]*|`[^`]+`|\[[^\]]+\]|"[^"]+"))*)$/.test(expr);
  }

  function parseSourceTable(sql) {
    var fromIdx = findFromIndex(sql);
    if (fromIdx < 0) {
      return "未识别";
    }

    var afterFrom = sql.slice(fromIdx + 4).trim();
    if (!afterFrom) {
      return "未识别";
    }

    if (afterFrom[0] === "(") {
      return "未识别";
    }

    var tableMatch = afterFrom.match(/^([a-zA-Z_][\w$.]*)(?:\s+[a-zA-Z_][\w$]*)?/);
    return tableMatch ? tableMatch[1] : "未识别";
  }

  function parseSqlFields(sql) {
    var normalized = stripStatementTail(normalizeSql(sql));
    if (!normalized) {
      throw new Error("SQL 为空");
    }

    var selectMatch = normalized.match(/^\s*select\s+/i);
    if (!selectMatch) {
      throw new Error("仅支持以 SELECT 开头的 SQL");
    }

    var fromIdx = findFromIndex(normalized);
    var selectPart = fromIdx >= 0
      ? normalized.slice(selectMatch[0].length, fromIdx).trim()
      : normalized.slice(selectMatch[0].length).trim();

    if (!selectPart) {
      throw new Error("未识别到 SELECT 字段列表");
    }

    var items = splitSelectItems(selectPart);
    if (!items.length) {
      throw new Error("字段解析失败");
    }

    var sourceTable = parseSourceTable(normalized);

    var rows = items.map(function (item, index) {
      var parsed = parseFieldExpression(item);
      return {
        index: index + 1,
        sourceTable: sourceTable || "未识别",
        sourceField: parsed.sourceField || "未识别",
        mappedField: parsed.mappedField || "未识别",
        comment: parsed.comment || "",
      };
    });

    return {
      sourceTable: sourceTable,
      rows: rows,
      warnings: rows.some(function (row) {
        return row.sourceField === "未识别" || row.mappedField === "未识别";
      })
        ? ["存在部分字段未识别"]
        : [],
    };
  }

  var api = {
    parseSqlFields: parseSqlFields,
    splitSelectItems: splitSelectItems,
    parseSourceTable: parseSourceTable,
  };

  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  }

  globalScope.SQLParser = api;
})(typeof window !== "undefined" ? window : globalThis);
