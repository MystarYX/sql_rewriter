(function (globalScope) {
  "use strict";

  var SQL_KEYWORDS = {
    select: true, from: true, where: true, join: true, left: true, right: true, full: true,
    inner: true, outer: true, on: true, and: true, or: true, as: true, case: true, when: true,
    then: true, else: true, end: true, over: true, partition: true, by: true, group: true,
    order: true, having: true, union: true, all: true, with: true, distinct: true, sum: true,
    count: true, avg: true, min: true, max: true, in: true, is: true, null: true, like: true,
    asc: true, desc: true, cast: true, coalesce: true, into: true, create: true, table: true,
  };

  function normalizeSql(sql) {
    return (sql || "").replace(/\r\n?/g, "\n").trim();
  }

  function stripStatementTail(sql) {
    return sql.replace(/;\s*$/, "");
  }

  function normalizeIdentifier(id) {
    if (!id) {
      return "";
    }
    var trimmed = id.trim();
    if ((/^".*"$/).test(trimmed) || (/^`.*`$/).test(trimmed) || (/^\[.*\]$/).test(trimmed)) {
      return trimmed.slice(1, -1);
    }
    return trimmed;
  }

  function findTopLevelKeyword(sql, keyword, fromIndex) {
    var target = keyword.toLowerCase();
    var depth = 0;
    var inSingle = false;
    var inDouble = false;

    for (var i = fromIndex || 0; i < sql.length; i += 1) {
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
        continue;
      }
      if (ch === ")") {
        depth = Math.max(0, depth - 1);
        continue;
      }

      if (depth !== 0) {
        continue;
      }

      if (sql.slice(i, i + target.length).toLowerCase() === target) {
        var leftOk = i === 0 || !/[\w$]/.test(sql[i - 1]);
        var rightOk = i + target.length >= sql.length || !/[\w$]/.test(sql[i + target.length]);
        if (leftOk && rightOk) {
          return i;
        }
      }
    }

    return -1;
  }

  function splitTopLevel(text, separatorChar) {
    var result = [];
    var token = "";
    var depth = 0;
    var inSingle = false;
    var inDouble = false;

    for (var i = 0; i < text.length; i += 1) {
      var ch = text[i];
      var prev = i > 0 ? text[i - 1] : "";

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

      if (ch === separatorChar && depth === 0 && !inSingle && !inDouble) {
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

  function splitSelectItems(selectPart) {
    return splitTopLevel(selectPart, ",");
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

  function isSimpleColumnExpr(expr) {
    return /^(?:(?:[a-zA-Z_][\w$]*|`[^`]+`|\[[^\]]+\]|"[^"]+")(?:\.(?:[a-zA-Z_][\w$]*|`[^`]+`|\[[^\]]+\]|"[^"]+"))*)$/.test(expr);
  }

  function parseFieldExpression(item) {
    var commentInfo = stripTrailingComment(item);
    var clean = commentInfo.clean;
    var comment = commentInfo.comment;
    var aliasPattern = '(?:"[^"]+"|`[^`]+`|\\[[^\\]]+\\]|[a-zA-Z_][\\w$]*)';

    var asMatch = clean.match(new RegExp("^(.+?)\\s+as\\s+(" + aliasPattern + ")$", "i"));
    if (asMatch) {
      return {
        expression: asMatch[1].trim(),
        sourceField: asMatch[1].trim(),
        mappedField: normalizeIdentifier(asMatch[2].trim()),
        comment: comment,
      };
    }

    var noAsMatch = clean.match(new RegExp("^(.*\\S)\\s+(" + aliasPattern + ")$"));
    if (noAsMatch) {
      var sourceCandidate = noAsMatch[1].trim();
      var aliasCandidate = normalizeIdentifier(noAsMatch[2].trim());
      if (isSimpleColumnExpr(sourceCandidate) && !/^distinct$/i.test(sourceCandidate)) {
        return {
          expression: sourceCandidate,
          sourceField: sourceCandidate,
          mappedField: aliasCandidate,
          comment: comment,
        };
      }
    }

    return {
      expression: clean,
      sourceField: clean,
      mappedField: clean,
      comment: comment,
    };
  }

  function parseSourceTable(sql) {
    var fromIdx = findTopLevelKeyword(sql, "from", 0);
    if (fromIdx < 0) {
      return "未识别";
    }
    var afterFrom = sql.slice(fromIdx + 4).trim();
    if (!afterFrom || afterFrom[0] === "(") {
      return "未识别";
    }
    var tableMatch = afterFrom.match(/^([a-zA-Z_][\w$.]*)(?:\s+[a-zA-Z_][\w$]*)?/);
    return tableMatch ? tableMatch[1] : "未识别";
  }

  function extractSelectAndTail(selectSql) {
    var normalized = stripStatementTail(normalizeSql(selectSql));
    var selectMatch = normalized.match(/^\s*select\s+/i);
    if (!selectMatch) {
      throw new Error("仅支持 SELECT 语句解析");
    }

    var fromIdx = findTopLevelKeyword(normalized, "from", selectMatch[0].length);
    if (fromIdx < 0) {
      return {
        full: normalized,
        selectPart: normalized.slice(selectMatch[0].length).trim(),
        tail: "",
      };
    }

    return {
      full: normalized,
      selectPart: normalized.slice(selectMatch[0].length, fromIdx).trim(),
      tail: normalized.slice(fromIdx),
    };
  }

  function splitUnionBranches(sql) {
    var parts = [];
    var token = "";
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

      if (!inSingle && !inDouble) {
        if (ch === "(") {
          depth += 1;
        } else if (ch === ")") {
          depth = Math.max(0, depth - 1);
        }

        if (depth === 0 && /^union\b/i.test(sql.slice(i))) {
          if (token.trim()) {
            parts.push(token.trim());
          }
          token = "";
          i += 4;
          if (/^\s+all\b/i.test(sql.slice(i + 1))) {
            i += sql.slice(i + 1).match(/^\s+all\b/i)[0].length;
          }
          continue;
        }
      }

      token += ch;
    }

    if (token.trim()) {
      parts.push(token.trim());
    }

    return parts.length ? parts : [sql];
  }

  function parseWithClause(sql) {
    var normalized = stripStatementTail(normalizeSql(sql));
    if (!/^with\b/i.test(normalized)) {
      return { ctes: [], mainQuery: normalized };
    }

    var ctes = [];
    var i = normalized.match(/^with\b/i)[0].length;
    var len = normalized.length;

    while (i < len) {
      while (i < len && /\s/.test(normalized[i])) {
        i += 1;
      }
      var nameMatch = normalized.slice(i).match(/^([a-zA-Z_][\w$]*)/);
      if (!nameMatch) {
        break;
      }
      var cteName = nameMatch[1];
      i += nameMatch[0].length;

      while (i < len && /\s/.test(normalized[i])) {
        i += 1;
      }

      if (normalized[i] === "(") {
        var colDepth = 1;
        i += 1;
        while (i < len && colDepth > 0) {
          if (normalized[i] === "(") {
            colDepth += 1;
          } else if (normalized[i] === ")") {
            colDepth -= 1;
          }
          i += 1;
        }
        while (i < len && /\s/.test(normalized[i])) {
          i += 1;
        }
      }

      var asMatch = normalized.slice(i).match(/^as\s*\(/i);
      if (!asMatch) {
        break;
      }
      i += asMatch[0].length;

      var depth = 1;
      var start = i;
      var inSingle = false;
      var inDouble = false;
      while (i < len && depth > 0) {
        var ch = normalized[i];
        var prev = i > 0 ? normalized[i - 1] : "";
        if (ch === "'" && !inDouble && prev !== "\\") {
          inSingle = !inSingle;
        } else if (ch === '"' && !inSingle && prev !== "\\") {
          inDouble = !inDouble;
        } else if (!inSingle && !inDouble) {
          if (ch === "(") {
            depth += 1;
          } else if (ch === ")") {
            depth -= 1;
          }
        }
        i += 1;
      }
      var inner = normalized.slice(start, i - 1).trim();
      ctes.push({ name: cteName, sql: inner });

      while (i < len && /\s/.test(normalized[i])) {
        i += 1;
      }
      if (normalized[i] === ",") {
        i += 1;
        continue;
      }
      break;
    }

    return {
      ctes: ctes,
      mainQuery: normalized.slice(i).trim(),
    };
  }

  function dedupeSources(sources) {
    var seen = {};
    var out = [];
    for (var i = 0; i < sources.length; i += 1) {
      var src = sources[i];
      var key = src.table + "::" + src.field;
      if (!seen[key]) {
        seen[key] = true;
        out.push(src);
      }
    }
    return out;
  }

  function parseFromSources(fromClause, cteEnv, derivedCounter) {
    var joinSplit = splitTopLevel(
      fromClause
        .replace(/\bleft\s+join\b/gi, "|JOIN|")
        .replace(/\bright\s+join\b/gi, "|JOIN|")
        .replace(/\binner\s+join\b/gi, "|JOIN|")
        .replace(/\bfull\s+join\b/gi, "|JOIN|")
        .replace(/\bjoin\b/gi, "|JOIN|")
        .replace(/,/g, "|JOIN|"),
      "|"
    );

    var rawSources = [];
    for (var i = 0; i < joinSplit.length; i += 1) {
      var piece = joinSplit[i].trim();
      if (!piece || /^join$/i.test(piece) || /^on\b/i.test(piece)) {
        continue;
      }
      if (/^on\b/i.test(piece)) {
        continue;
      }
      rawSources.push(piece.replace(/^JOIN\|?/i, "").trim());
    }

    var sourceMap = {};
    var primaryTable = "未识别";

    for (var s = 0; s < rawSources.length; s += 1) {
      var src = rawSources[s];
      if (!src) {
        continue;
      }

      var subqueryMatch = src.match(/^\((.+)\)\s+([a-zA-Z_][\w$]*)$/i);
      if (subqueryMatch) {
        var alias = subqueryMatch[2];
        var analysis = analyzeSelectQuery(subqueryMatch[1], {
          targetTable: "DERIVED_" + (derivedCounter.count += 1),
          cteEnv: cteEnv,
          derivedCounter: derivedCounter,
        });
        sourceMap[alias] = {
          type: "derived",
          table: analysis.outputTable,
          fields: analysis.fields,
        };
        if (primaryTable === "未识别") {
          primaryTable = analysis.outputTable;
        }
        continue;
      }

      var tableMatch = src.match(/^([a-zA-Z_][\w$.]*)(?:\s+(?:as\s+)?([a-zA-Z_][\w$]*))?/i);
      if (tableMatch) {
        var tableName = tableMatch[1];
        var aliasName = tableMatch[2] || tableName;
        if (cteEnv[tableName]) {
          sourceMap[aliasName] = {
            type: "derived",
            table: tableName,
            fields: cteEnv[tableName].fields,
          };
        } else {
          sourceMap[aliasName] = {
            type: "base",
            table: tableName,
            fields: [],
          };
        }
        if (primaryTable === "未识别") {
          primaryTable = tableName;
        }
      }
    }

    return { sourceMap: sourceMap, primaryTable: primaryTable };
  }

  function extractColumnRefs(expression) {
    var refs = [];
    var qualifiedRegex = /\b([a-zA-Z_][\w$]*)\.([a-zA-Z_][\w$]*)\b/g;
    var seen = {};
    var match;
    while ((match = qualifiedRegex.exec(expression))) {
      var key = match[1] + "." + match[2];
      if (!seen[key]) {
        seen[key] = true;
        refs.push({ qualifier: match[1], field: match[2] });
      }
    }

    var stripped = expression.replace(qualifiedRegex, " ");
    var tokenRegex = /\b([a-zA-Z_][\w$]*)\b/g;
    while ((match = tokenRegex.exec(stripped))) {
      var token = match[1];
      var lower = token.toLowerCase();
      var nextChar = stripped[match.index + token.length] || "";
      if (SQL_KEYWORDS[lower] || /\d/.test(token[0]) || nextChar === "(") {
        continue;
      }
      if (!seen[token]) {
        seen[token] = true;
        refs.push({ qualifier: null, field: token });
      }
    }

    return refs;
  }

  function resolveRefs(refs, sourceMap) {
    var aliasKeys = Object.keys(sourceMap);
    if (!refs.length) {
      return [];
    }

    var sources = [];

    for (var i = 0; i < refs.length; i += 1) {
      var ref = refs[i];
      if (ref.qualifier) {
        var qualifiedSrc = sourceMap[ref.qualifier];
        if (!qualifiedSrc) {
          sources.push({ table: "未识别", field: ref.field });
          continue;
        }

        if (qualifiedSrc.type === "derived") {
          var derivedField = qualifiedSrc.fields.find(function (f) {
            return f.outputField.toLowerCase() === ref.field.toLowerCase();
          });
          if (derivedField) {
            sources = sources.concat(derivedField.sources);
          } else {
            sources.push({ table: qualifiedSrc.table, field: ref.field });
          }
        } else {
          sources.push({ table: qualifiedSrc.table, field: ref.field });
        }
        continue;
      }

      if (aliasKeys.length === 1) {
        var only = sourceMap[aliasKeys[0]];
        if (only.type === "derived") {
          var target = only.fields.find(function (f) {
            return f.outputField.toLowerCase() === ref.field.toLowerCase();
          });
          if (target) {
            sources = sources.concat(target.sources);
          } else {
            sources.push({ table: only.table, field: ref.field });
          }
        } else {
          sources.push({ table: only.table, field: ref.field });
        }
      } else {
        sources.push({ table: "未识别", field: ref.field });
      }
    }

    return dedupeSources(sources);
  }

  function splitFromClauseTail(tail) {
    if (!tail) {
      return { fromClause: "", remainder: "" };
    }

    var fromMatch = tail.match(/^from\s+/i);
    if (!fromMatch) {
      return { fromClause: "", remainder: tail };
    }

    var boundaryKeywords = [" where ", " group by ", " having ", " order by ", " union "];
    var idx = -1;
    for (var i = 0; i < boundaryKeywords.length; i += 1) {
      var found = findTopLevelKeyword(tail, boundaryKeywords[i].trim(), fromMatch[0].length);
      if (found >= 0 && (idx < 0 || found < idx)) {
        idx = found;
      }
    }

    if (idx < 0) {
      return {
        fromClause: tail.slice(fromMatch[0].length).trim(),
        remainder: "",
      };
    }

    return {
      fromClause: tail.slice(fromMatch[0].length, idx).trim(),
      remainder: tail.slice(idx),
    };
  }

  function applyStandardMapToExpression(expression, mapDict) {
    var out = "";
    var i = 0;
    var len = expression.length;

    while (i < len) {
      var ch = expression[i];
      var next = i + 1 < len ? expression[i + 1] : "";

      if (ch === "'" || ch === "\"" || ch === "`" || ch === "[") {
        var endChar = ch === "[" ? "]" : ch;
        var j = i + 1;
        while (j < len) {
          if (expression[j] === endChar) {
            if (endChar === "'" && j + 1 < len && expression[j + 1] === "'") {
              j += 2;
              continue;
            }
            j += 1;
            break;
          }
          if (expression[j] === "\\" && j + 1 < len && endChar !== "]") {
            j += 2;
            continue;
          }
          j += 1;
        }
        out += expression.slice(i, j);
        i = j;
        continue;
      }

      if (ch === "-" && next === "-") {
        var lineEnd = expression.indexOf("\n", i + 2);
        if (lineEnd < 0) {
          out += expression.slice(i);
          break;
        }
        out += expression.slice(i, lineEnd);
        i = lineEnd;
        continue;
      }

      if (ch === "/" && next === "*") {
        var blockEnd = expression.indexOf("*/", i + 2);
        if (blockEnd < 0) {
          out += expression.slice(i);
          break;
        }
        out += expression.slice(i, blockEnd + 2);
        i = blockEnd + 2;
        continue;
      }

      if (/[a-zA-Z_]/.test(ch)) {
        var k = i + 1;
        while (k < len && /[\w$]/.test(expression[k])) {
          k += 1;
        }
        var token = expression.slice(i, k);
        out += Object.prototype.hasOwnProperty.call(mapDict, token) ? mapDict[token] : token;
        i = k;
        continue;
      }

      out += ch;
      i += 1;
    }

    return out;
  }

  function parseStandardDict(raw) {
    var dict = {};
    if (!raw || !raw.trim()) {
      return dict;
    }

    raw.split(/\n+/).forEach(function (line) {
      var clean = line.trim();
      if (!clean) {
        return;
      }
      var parts = clean.split(/\s*[,:=]\s*|\s+/).filter(Boolean);
      if (parts.length >= 2) {
        dict[parts[0]] = parts[1];
      }
    });

    return dict;
  }

  function parseCreateTableWrapper(sql) {
    var clean = normalizeSql(sql);
    var createMatch = clean.match(/^create\s+table\s+([a-zA-Z_][\w$.]*)\s+as\s+([\s\S]+)$/i);
    if (createMatch) {
      return { targetTable: createMatch[1], querySql: createMatch[2] };
    }

    var insertMatch = clean.match(/^insert\s+into\s+([a-zA-Z_][\w$.]*)\s+([\s\S]+)$/i);
    if (insertMatch) {
      return { targetTable: insertMatch[1], querySql: insertMatch[2] };
    }

    return { targetTable: "RESULT", querySql: clean };
  }

  function analyzeSelectQuery(sql, options) {
    var targetTable = options.targetTable || "RESULT";
    var cteEnv = options.cteEnv || {};
    var derivedCounter = options.derivedCounter || { count: 0 };

    var withInfo = parseWithClause(sql);
    var scopedCteEnv = Object.assign({}, cteEnv);

    withInfo.ctes.forEach(function (cte) {
      var cteResult = analyzeSelectQuery(cte.sql, {
        targetTable: cte.name,
        cteEnv: scopedCteEnv,
        derivedCounter: derivedCounter,
      });
      scopedCteEnv[cte.name] = {
        outputTable: cte.name,
        fields: cteResult.fields,
      };
    });

    var branches = splitUnionBranches(withInfo.mainQuery);
    var branchResults = branches.map(function (branchSql) {
      var parts = extractSelectAndTail(branchSql);
      if (!parts.selectPart) {
        throw new Error("未识别到 SELECT 字段列表");
      }

      var selectItems = splitSelectItems(parts.selectPart);
      var fromInfo = splitFromClauseTail(parts.tail);
      var srcInfo = parseFromSources(fromInfo.fromClause, scopedCteEnv, derivedCounter);

      var rows = selectItems.map(function (item, idx) {
        var parsed = parseFieldExpression(item);
        var refs = extractColumnRefs(parsed.expression);
        var sources = resolveRefs(refs, srcInfo.sourceMap);
        if (!sources.length && isSimpleColumnExpr(parsed.expression) && srcInfo.primaryTable !== "未识别") {
          sources.push({ table: srcInfo.primaryTable, field: normalizeIdentifier(parsed.expression.split(".").pop()) });
        }

        var outputField = normalizeIdentifier(parsed.mappedField || parsed.sourceField || ("col_" + (idx + 1)));
        return {
          index: idx + 1,
          sourceTable: sources.length ? sources[0].table : "未识别",
          sourceField: sources.length ? sources[0].field : parsed.sourceField,
          mappedField: outputField,
          comment: parsed.comment || "",
          expression: parsed.expression,
          sources: sources.length ? sources : [{ table: "未识别", field: parsed.sourceField }],
          outputField: outputField,
        };
      });

      return {
        rows: rows,
        tail: parts.tail,
        fromInfo: fromInfo,
      };
    });

    var mergedRows = branchResults[0].rows.map(function (row, idx) {
      var mergedSources = [];
      branchResults.forEach(function (branch) {
        if (branch.rows[idx]) {
          mergedSources = mergedSources.concat(branch.rows[idx].sources);
        }
      });
      mergedSources = dedupeSources(mergedSources);
      return {
        index: row.index,
        sourceTable: mergedSources.length ? mergedSources[0].table : row.sourceTable,
        sourceField: mergedSources.length ? mergedSources[0].field : row.sourceField,
        mappedField: row.mappedField,
        comment: row.comment,
        expression: row.expression,
        sources: mergedSources,
        outputField: row.outputField,
      };
    });

    var edges = [];
    mergedRows.forEach(function (row) {
      row.sources.forEach(function (src) {
        edges.push({
          sourceTable: src.table,
          sourceField: src.field,
          targetTable: targetTable,
          targetField: row.mappedField,
        });
      });
    });

    return {
      outputTable: targetTable,
      rows: mergedRows,
      fields: mergedRows.map(function (r) {
        return { outputField: r.outputField, sources: r.sources };
      }),
      edges: edges,
      cteNames: withInfo.ctes.map(function (c) { return c.name; }),
    };
  }

  function rewriteSelectSql(sql, standardMap) {
    var wrapper = parseCreateTableWrapper(sql);
    var querySql = wrapper.querySql;
    var withInfo = parseWithClause(querySql);

    var branches = splitUnionBranches(withInfo.mainQuery);
    var rewrittenBranches = branches.map(function (branchSql) {
      var parts = extractSelectAndTail(branchSql);
      var selectItems = splitSelectItems(parts.selectPart);

      var rewrittenItems = selectItems.map(function (item) {
        var parsed = parseFieldExpression(item);
        var oldSource = parsed.expression;
        var oldAlias = normalizeIdentifier(parsed.mappedField);
        var newExpr = applyStandardMapToExpression(oldSource, standardMap);
        var newAlias = standardMap[oldAlias] || oldAlias;
        var commentSuffix = parsed.comment ? " /* " + parsed.comment + " */" : "";

        if (oldAlias === oldSource || !oldAlias) {
          var maybeSourceLeaf = normalizeIdentifier(oldSource.split(".").pop());
          if (standardMap[maybeSourceLeaf]) {
            newAlias = standardMap[maybeSourceLeaf];
          }
        }

        if (newAlias && newAlias !== newExpr) {
          return newExpr + " AS " + newAlias + commentSuffix;
        }
        return newExpr + commentSuffix;
      });

      return "SELECT\n  " + rewrittenItems.join(",\n  ") + (parts.tail ? "\n" + parts.tail : "");
    });

    var rebuilt = rewrittenBranches.join("\nUNION\n");
    if (withInfo.ctes.length) {
      var withSql = withInfo.ctes
        .map(function (cte) {
          return cte.name + " AS (\n" + rewriteSelectSql(cte.sql, standardMap) + "\n)";
        })
        .join(",\n");
      rebuilt = "WITH " + withSql + "\n" + rebuilt;
    }

    if (wrapper.targetTable !== "RESULT") {
      return "CREATE TABLE " + wrapper.targetTable + " AS\n" + rebuilt;
    }
    return rebuilt;
  }

  function buildRenameReport(rows, standardMap, sqlLocation) {
    var report = [];
    rows.forEach(function (row) {
      var sourceLeaf = normalizeIdentifier((row.sourceField || "").split(".").pop());
      var mappedLeaf = normalizeIdentifier((row.mappedField || "").split(".").pop());

      if (standardMap[sourceLeaf] && standardMap[sourceLeaf] !== sourceLeaf) {
        report.push({ oldField: sourceLeaf, newField: standardMap[sourceLeaf], location: sqlLocation });
      }
      if (standardMap[mappedLeaf] && standardMap[mappedLeaf] !== mappedLeaf) {
        report.push({ oldField: mappedLeaf, newField: standardMap[mappedLeaf], location: sqlLocation });
      }
    });

    var seen = {};
    return report.filter(function (item) {
      var key = item.oldField + "->" + item.newField + "@" + item.location;
      if (seen[key]) {
        return false;
      }
      seen[key] = true;
      return true;
    });
  }

  function parseSqlFields(sql) {
    var normalized = stripStatementTail(normalizeSql(sql));
    if (!normalized) {
      throw new Error("SQL 为空");
    }

    var wrapper = parseCreateTableWrapper(normalized);
    var lineage = analyzeSelectQuery(wrapper.querySql, {
      targetTable: wrapper.targetTable,
      cteEnv: {},
      derivedCounter: { count: 0 },
    });

    return {
      sourceTable: lineage.rows[0] ? lineage.rows[0].sourceTable : "未识别",
      rows: lineage.rows,
      warnings: lineage.rows.some(function (row) {
        return row.sourceTable === "未识别";
      }) ? ["存在部分字段未识别"] : [],
    };
  }

  function analyzeSqlLineage(sql, options) {
    var normalized = stripStatementTail(normalizeSql(sql));
    if (!normalized) {
      throw new Error("SQL 为空");
    }

    var opts = options || {};
    var standardMap = opts.standardMap || parseStandardDict(opts.standardDictText || "");
    var location = opts.location || "inline.sql";

    var statements = splitTopLevel(normalized, ";");
    var allRows = [];
    var allEdges = [];
    var rewrittenList = [];
    var tableEnv = {};

    statements.forEach(function (stmt, idx) {
      if (!stmt.trim()) {
        return;
      }
      var wrapper = parseCreateTableWrapper(stmt);
      var target = wrapper.targetTable === "RESULT" ? "RESULT_" + (idx + 1) : wrapper.targetTable;
      var lineage = analyzeSelectQuery(wrapper.querySql, {
        targetTable: target,
        cteEnv: tableEnv,
        derivedCounter: { count: 0 },
      });

      allRows = allRows.concat(lineage.rows.map(function (row) {
        return {
          index: allRows.length + 1,
          sourceTable: row.sourceTable,
          sourceField: row.sourceField,
          mappedField: row.mappedField,
          comment: row.comment || "",
          targetTable: target,
        };
      }));
      allEdges = allEdges.concat(lineage.edges);
      rewrittenList.push(rewriteSelectSql(stmt, standardMap));

      tableEnv[target] = {
        outputTable: target,
        fields: lineage.fields,
      };
    });

    var renameReport = buildRenameReport(allRows, standardMap, location);

    return {
      rows: allRows,
      lineageEdges: allEdges,
      rewrittenSql: rewrittenList.join(";\n\n") + (rewrittenList.length ? ";" : ""),
      renameReport: renameReport,
      astSummary: {
        statementCount: statements.length,
        edgeCount: allEdges.length,
        fieldCount: allRows.length,
      },
      warnings: allRows.length ? [] : ["未识别到可解析字段"],
    };
  }

  var api = {
    parseSqlFields: parseSqlFields,
    splitSelectItems: splitSelectItems,
    parseSourceTable: parseSourceTable,
    parseStandardDict: parseStandardDict,
    analyzeSqlLineage: analyzeSqlLineage,
    rewriteSelectSql: rewriteSelectSql,
  };

  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  }

  globalScope.SQLParser = api;
})(typeof window !== "undefined" ? window : globalThis);
