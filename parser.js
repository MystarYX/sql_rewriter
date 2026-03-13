(function (globalScope) {
  "use strict";

  var SQL_KEYWORDS = {
    select: true, from: true, where: true, join: true, left: true, right: true, full: true,
    inner: true, outer: true, on: true, and: true, or: true, as: true, case: true, when: true,
    then: true, else: true, end: true, over: true, partition: true, by: true, group: true,
    order: true, having: true, union: true, all: true, with: true, distinct: true, sum: true,
    count: true, avg: true, min: true, max: true, in: true, is: true, null: true, like: true,
    not: true, exists: true, between: true,
    cast: true, round: true, if: true, datediff: true, date_format: true, to_date: true,
    int: true, integer: true, bigint: true, decimal: true, double: true, float: true,
    string: true, varchar: true, char: true, boolean: true, date: true, timestamp: true,
    create: true, table: true, insert: true, into: true,
  };

  function normalizeSql(sql) {
    return (sql || "").replace(/\r\n?/g, "\n").trim();
  }

  function stripTailSemicolon(sql) {
    return sql.replace(/;\s*$/, "");
  }

  function normalizeIdentifier(raw) {
    if (!raw) {
      return "";
    }
    var s = raw.trim();
    if ((/^".*"$/).test(s) || (/^`.*`$/).test(s) || (/^\[.*\]$/).test(s)) {
      return s.slice(1, -1);
    }
    return s;
  }

  function dedupeSources(sources) {
    var seen = {};
    var out = [];
    for (var i = 0; i < sources.length; i += 1) {
      var item = sources[i];
      var key = item.table + "::" + item.field;
      if (!seen[key]) {
        seen[key] = true;
        out.push(item);
      }
    }
    return out;
  }

  function scanTopLevel(text, onChar) {
    var depth = 0;
    var inSingle = false;
    var inDouble = false;
    var inBacktick = false;
    var inBracket = false;

    for (var i = 0; i < text.length; i += 1) {
      var ch = text[i];
      var prev = i > 0 ? text[i - 1] : "";

      if (!inDouble && !inBacktick && !inBracket && ch === "'" && prev !== "\\") {
        inSingle = !inSingle;
      } else if (!inSingle && !inBacktick && !inBracket && ch === '"' && prev !== "\\") {
        inDouble = !inDouble;
      } else if (!inSingle && !inDouble && !inBracket && ch === "`") {
        inBacktick = !inBacktick;
      } else if (!inSingle && !inDouble && !inBacktick && ch === "[") {
        inBracket = true;
      } else if (inBracket && ch === "]") {
        inBracket = false;
      }

      if (inSingle || inDouble || inBacktick || inBracket) {
        continue;
      }

      if (ch === "(") {
        depth += 1;
      } else if (ch === ")") {
        depth = Math.max(0, depth - 1);
      }

      if (onChar(i, ch, depth)) {
        return i;
      }
    }

    return -1;
  }

  function findTopLevelKeyword(sql, keyword, start) {
    var target = keyword.toLowerCase();
    var base = start || 0;
    var hit = scanTopLevel(sql.slice(base), function (offset, ch, depth) {
      if (depth !== 0) {
        return false;
      }
      var i = base + offset;
      if (sql.slice(i, i + target.length).toLowerCase() !== target) {
        return false;
      }
      var leftOk = i === 0 || !/[\w$]/.test(sql[i - 1]);
      var rightOk = i + target.length >= sql.length || !/[\w$]/.test(sql[i + target.length]);
      return leftOk && rightOk;
    });
    return hit < 0 ? -1 : base + hit;
  }

  function splitTopLevelByChar(text, sep) {
    var out = [];
    var buf = "";
    var depth = 0;
    var inSingle = false;
    var inDouble = false;
    var inBacktick = false;
    var inBracket = false;

    for (var i = 0; i < text.length; i += 1) {
      var ch = text[i];
      var prev = i > 0 ? text[i - 1] : "";

      if (!inDouble && !inBacktick && !inBracket && ch === "'" && prev !== "\\") {
        inSingle = !inSingle;
      } else if (!inSingle && !inBacktick && !inBracket && ch === '"' && prev !== "\\") {
        inDouble = !inDouble;
      } else if (!inSingle && !inDouble && !inBracket && ch === "`") {
        inBacktick = !inBacktick;
      } else if (!inSingle && !inDouble && !inBacktick && ch === "[") {
        inBracket = true;
      } else if (inBracket && ch === "]") {
        inBracket = false;
      }

      if (!inSingle && !inDouble && !inBacktick && !inBracket) {
        if (ch === "(") {
          depth += 1;
        } else if (ch === ")") {
          depth = Math.max(0, depth - 1);
        }
      }

      if (!inSingle && !inDouble && !inBacktick && !inBracket && depth === 0 && ch === sep) {
        if (buf.trim()) {
          out.push(buf.trim());
        }
        buf = "";
        continue;
      }
      buf += ch;
    }

    if (buf.trim()) {
      out.push(buf.trim());
    }
    return out;
  }

  function splitSelectItems(selectPart) {
    return splitTopLevelByChar(selectPart, ",");
  }

  function stripSqlComments(sql) {
    var out = "";
    var i = 0;
    var inSingle = false;
    var inDouble = false;
    var inBacktick = false;
    var inBracket = false;

    while (i < sql.length) {
      var ch = sql[i];
      var next = i + 1 < sql.length ? sql[i + 1] : "";
      var prev = i > 0 ? sql[i - 1] : "";

      if (!inDouble && !inBacktick && !inBracket && ch === "'" && prev !== "\\") {
        inSingle = !inSingle;
        out += ch;
        i += 1;
        continue;
      }
      if (!inSingle && !inBacktick && !inBracket && ch === '"' && prev !== "\\") {
        inDouble = !inDouble;
        out += ch;
        i += 1;
        continue;
      }
      if (!inSingle && !inDouble && !inBracket && ch === "`") {
        inBacktick = !inBacktick;
        out += ch;
        i += 1;
        continue;
      }
      if (!inSingle && !inDouble && !inBacktick && ch === "[") {
        inBracket = true;
        out += ch;
        i += 1;
        continue;
      }
      if (inBracket && ch === "]") {
        inBracket = false;
        out += ch;
        i += 1;
        continue;
      }

      if (!inSingle && !inDouble && !inBacktick && !inBracket) {
        if (ch === "-" && next === "-") {
          i += 2;
          while (i < sql.length && sql[i] !== "\n") {
            i += 1;
          }
          out += " ";
          continue;
        }
        if (ch === "/" && next === "*") {
          i += 2;
          while (i + 1 < sql.length && !(sql[i] === "*" && sql[i + 1] === "/")) {
            if (sql[i] === "\n") {
              out += "\n";
            }
            i += 1;
          }
          i += 2;
          out += " ";
          continue;
        }
      }

      out += ch;
      i += 1;
    }
    return out;
  }

  function stripTrailingComment(item) {
    var lineIdx = item.search(/\s--\s*/);
    if (lineIdx >= 0) {
      return {
        clean: item.slice(0, lineIdx).trim(),
        comment: item.slice(lineIdx).replace(/^\s--\s*/, "").trim(),
      };
    }

    var block = item.match(/\/\*\s*([\s\S]*?)\s*\*\/$/);
    if (block) {
      return {
        clean: item.slice(0, block.index).trim(),
        comment: block[1].replace(/\s+/g, " ").trim(),
      };
    }

    return { clean: item.trim(), comment: "" };
  }

  function parseSelectItem(rawItem) {
    var cleaned = stripTrailingComment(rawItem);
    var expr = cleaned.clean;
    var comment = cleaned.comment;
    var aliasPattern = '(?:"[^"]+"|`[^`]+`|\\[[^\\]]+\\]|[a-zA-Z_][\\w$]*)';

    var asMatch = expr.match(new RegExp("^([\\s\\S]+?)\\s+as\\s+(" + aliasPattern + ")$", "i"));
    if (asMatch) {
      return {
        expression: asMatch[1].trim(),
        output: normalizeIdentifier(asMatch[2].trim()),
        comment: comment,
      };
    }

    var noAs = expr.match(new RegExp("^([\\s\\S]+?)\\s+(" + aliasPattern + ")$"));
    if (noAs) {
      var left = noAs[1].trim();
      var right = normalizeIdentifier(noAs[2].trim());
      if (!/[+\-*/%<>=,]$/.test(left) && !/^distinct$/i.test(left)) {
        return {
          expression: left,
          output: right,
          comment: comment,
        };
      }
    }

    // Handle tightly-coupled alias pattern like: max(col)alias
    var tightAlias = expr.match(new RegExp("^([\\s\\S]*\\))(?:\\s*)(" + aliasPattern + ")$"));
    if (tightAlias) {
      return {
        expression: tightAlias[1].trim(),
        output: normalizeIdentifier(tightAlias[2].trim()),
        comment: comment,
      };
    }

    var fallback = expr.trim();
    var simple = fallback.match(/([a-zA-Z_][\w$]*)$/);
    return {
      expression: fallback,
      output: simple ? simple[1] : fallback,
      comment: comment,
    };
  }

  function sanitizeForRefScan(expression) {
    var out = "";
    var i = 0;
    while (i < expression.length) {
      var ch = expression[i];
      var next = i + 1 < expression.length ? expression[i + 1] : "";

      if (ch === "'" || ch === '"' || ch === "`") {
        var end = ch;
        out += " ";
        i += 1;
        while (i < expression.length) {
          if (expression[i] === end) {
            if (end === "'" && i + 1 < expression.length && expression[i + 1] === "'") {
              i += 2;
              continue;
            }
            i += 1;
            break;
          }
          i += 1;
        }
        continue;
      }

      if (ch === "[") {
        out += " ";
        i += 1;
        while (i < expression.length && expression[i] !== "]") {
          i += 1;
        }
        i += 1;
        continue;
      }

      if (ch === "-" && next === "-") {
        out += " ";
        i += 2;
        while (i < expression.length && expression[i] !== "\n") {
          i += 1;
        }
        continue;
      }

      if (ch === "/" && next === "*") {
        out += " ";
        i += 2;
        while (i + 1 < expression.length && !(expression[i] === "*" && expression[i + 1] === "/")) {
          i += 1;
        }
        i += 2;
        continue;
      }

      out += ch;
      i += 1;
    }

    return out;
  }

  function extractColumnRefs(expression) {
    var refs = [];
    var seen = {};
    var clean = sanitizeForRefScan(expression);

    var qual = /\b([a-zA-Z_][\w$]*)\s*\.\s*([a-zA-Z_][\w$]*)\b/g;
    var m;
    while ((m = qual.exec(clean))) {
      var key = m[1] + "." + m[2];
      if (!seen[key]) {
        seen[key] = true;
        refs.push({ qualifier: m[1], field: m[2] });
      }
    }

    var stripped = clean.replace(qual, " ");
    var token = /\b([a-zA-Z_][\w$]*)\b/g;
    while ((m = token.exec(stripped))) {
      var t = m[1];
      var lower = t.toLowerCase();
      var nextChar = stripped[m.index + t.length] || "";
      if (SQL_KEYWORDS[lower] || nextChar === "(") {
        continue;
      }
      if (!seen[t]) {
        seen[t] = true;
        refs.push({ qualifier: null, field: t });
      }
    }

    return refs;
  }

  function stripOuterParens(sql) {
    var s = sql.trim();
    if (!s || s[0] !== "(") {
      return s;
    }
    var depth = 0;
    for (var i = 0; i < s.length; i += 1) {
      if (s[i] === "(") {
        depth += 1;
      } else if (s[i] === ")") {
        depth -= 1;
        if (depth === 0 && i !== s.length - 1) {
          return s;
        }
      }
    }
    if (depth === 0 && s[s.length - 1] === ")") {
      return s.slice(1, -1).trim();
    }
    return s;
  }

  function splitUnionBranches(sql) {
    var branches = [];
    var buf = "";
    var i = 0;
    var depth = 0;
    var inSingle = false;
    var inDouble = false;
    var inBacktick = false;
    var inBracket = false;

    while (i < sql.length) {
      var ch = sql[i];
      var prev = i > 0 ? sql[i - 1] : "";
      var rest = sql.slice(i);

      if (!inDouble && !inBacktick && !inBracket && ch === "'" && prev !== "\\") {
        inSingle = !inSingle;
      } else if (!inSingle && !inBacktick && !inBracket && ch === '"' && prev !== "\\") {
        inDouble = !inDouble;
      } else if (!inSingle && !inDouble && !inBracket && ch === "`") {
        inBacktick = !inBacktick;
      } else if (!inSingle && !inDouble && !inBacktick && ch === "[") {
        inBracket = true;
      } else if (inBracket && ch === "]") {
        inBracket = false;
      }

      if (!inSingle && !inDouble && !inBacktick && !inBracket) {
        if (ch === "(") {
          depth += 1;
        } else if (ch === ")") {
          depth = Math.max(0, depth - 1);
        }

        if (depth === 0) {
          var unionMatch = rest.match(/^union(?:\s+all)?\b/i);
          if (unionMatch) {
            if (buf.trim()) {
              branches.push(buf.trim());
            }
            buf = "";
            i += unionMatch[0].length;
            continue;
          }
        }
      }

      buf += ch;
      i += 1;
    }

    if (buf.trim()) {
      branches.push(buf.trim());
    }
    return branches.length ? branches : [sql];
  }

  function parseWithClause(sql) {
    var normalized = stripTailSemicolon(normalizeSql(sql));
    if (!/^with\b/i.test(normalized)) {
      return { ctes: [], mainQuery: normalized };
    }

    var ctes = [];
    var i = normalized.match(/^with\b/i)[0].length;

    while (i < normalized.length) {
      while (i < normalized.length && /\s/.test(normalized[i])) {
        i += 1;
      }
      var nameMatch = normalized.slice(i).match(/^([a-zA-Z_][\w$]*)/);
      if (!nameMatch) {
        break;
      }
      var cteName = nameMatch[1];
      i += nameMatch[0].length;

      while (i < normalized.length && /\s/.test(normalized[i])) {
        i += 1;
      }

      if (normalized[i] === "(") {
        var colDepth = 1;
        i += 1;
        while (i < normalized.length && colDepth > 0) {
          if (normalized[i] === "(") {
            colDepth += 1;
          } else if (normalized[i] === ")") {
            colDepth -= 1;
          }
          i += 1;
        }
        while (i < normalized.length && /\s/.test(normalized[i])) {
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
      while (i < normalized.length && depth > 0) {
        if (normalized[i] === "(") {
          depth += 1;
        } else if (normalized[i] === ")") {
          depth -= 1;
        }
        i += 1;
      }
      ctes.push({ name: cteName, sql: normalized.slice(start, i - 1).trim() });

      while (i < normalized.length && /\s/.test(normalized[i])) {
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

  function getSelectFromParts(sql) {
    var s = stripSqlComments(stripOuterParens(stripTailSemicolon(normalizeSql(sql))));
    var selectIdx = findTopLevelKeyword(s, "select", 0);
    if (selectIdx < 0) {
      throw new Error("Only SELECT statements are supported");
    }
    var fromIdx = findTopLevelKeyword(s, "from", selectIdx + 6);
    if (fromIdx < 0) {
      return { selectPart: s.slice(selectIdx + 6).trim(), fromPart: "" };
    }

    var fromBody = s.slice(fromIdx + 4).trim();
    var boundaries = ["where", "group", "having", "order", "limit", "union"];
    var cut = -1;
    for (var i = 0; i < boundaries.length; i += 1) {
      var idx = findTopLevelKeyword(fromBody, boundaries[i], 0);
      if (idx >= 0 && (cut < 0 || idx < cut)) {
        cut = idx;
      }
    }

    return {
      selectPart: s.slice(selectIdx + 6, fromIdx).trim(),
      fromPart: cut < 0 ? fromBody : fromBody.slice(0, cut).trim(),
    };
  }

  function splitFromSources(fromPart) {
    var sources = [];
    var chunk = "";
    var i = 0;
    var depth = 0;
    var inSingle = false;
    var inDouble = false;
    var inBacktick = false;
    var inBracket = false;

    function pushChunk(text) {
      var cleaned = text.trim();
      if (!cleaned) {
        return;
      }
      var onIdx = findTopLevelKeyword(cleaned, "on", 0);
      if (onIdx >= 0) {
        cleaned = cleaned.slice(0, onIdx).trim();
      }
      if (cleaned) {
        sources.push(cleaned);
      }
    }

    while (i < fromPart.length) {
      var ch = fromPart[i];
      var prev = i > 0 ? fromPart[i - 1] : "";
      var rest = fromPart.slice(i);

      if (!inDouble && !inBacktick && !inBracket && ch === "'" && prev !== "\\") {
        inSingle = !inSingle;
      } else if (!inSingle && !inBacktick && !inBracket && ch === '"' && prev !== "\\") {
        inDouble = !inDouble;
      } else if (!inSingle && !inDouble && !inBracket && ch === "`") {
        inBacktick = !inBacktick;
      } else if (!inSingle && !inDouble && !inBacktick && ch === "[") {
        inBracket = true;
      } else if (inBracket && ch === "]") {
        inBracket = false;
      }

      if (!inSingle && !inDouble && !inBacktick && !inBracket) {
        if (ch === "(") {
          depth += 1;
        } else if (ch === ")") {
          depth = Math.max(0, depth - 1);
        }
      }

      if (!inSingle && !inDouble && !inBacktick && !inBracket && depth === 0 && ch === ",") {
        pushChunk(chunk);
        chunk = "";
        i += 1;
        continue;
      }

      if (!inSingle && !inDouble && !inBacktick && !inBracket && depth === 0) {
        var joinMatch = rest.match(/^(left\s+join|right\s+join|full\s+join|inner\s+join|join)\b/i);
        if (joinMatch) {
          pushChunk(chunk);
          chunk = "";
          i += joinMatch[0].length;
          continue;
        }
      }

      chunk += ch;
      i += 1;
    }
    pushChunk(chunk);

    return sources;
  }

  function parseSourceSpec(spec, env, debug) {
    var trimmed = spec.trim();
    if (!trimmed) {
      return null;
    }

    var subMatch = trimmed.match(/^\(([\s\S]*)\)\s+(?:as\s+)?([a-zA-Z_][\w$]*)$/i);
    if (subMatch) {
      var subSql = subMatch[1].trim();
      var alias = subMatch[2];
      var analyzed = analyzeQuery(subSql, env, "DERIVED", debug);
      return {
        alias: alias,
        type: "derived",
        table: analyzed.outputTable,
        columnMap: analyzed.columnMap,
      };
    }

    var tableMatch = trimmed.match(/^([a-zA-Z_][\w$.]*)(?:\s+(?:as\s+)?([a-zA-Z_][\w$]*))?$/i);
    if (!tableMatch) {
      debug.push({ type: "unparsed_source", value: trimmed });
      return null;
    }

    var table = tableMatch[1];
    var aliasName = tableMatch[2] || table;

    if (env.tables && env.tables[table]) {
      return {
        alias: aliasName,
        type: "derived",
        table: table,
        columnMap: env.tables[table].columnMap,
      };
    }

    if (env.ctes && env.ctes[table]) {
      return {
        alias: aliasName,
        type: "derived",
        table: table,
        columnMap: env.ctes[table].columnMap,
      };
    }

    return {
      alias: aliasName,
      type: "base",
      table: table,
      columnMap: null,
    };
  }

  function resolveRef(ref, sourceMap, debug) {
    var aliases = Object.keys(sourceMap);
    var out = [];

    function resolveFromSource(src, field) {
      if (!src) {
        return [{ table: "UNRESOLVED", field: field }];
      }
      if (src.type === "base") {
        return [{ table: src.table, field: field }];
      }
      var key = field.toLowerCase();
      var derived = src.columnMap[key];
      if (derived && derived.length) {
        return derived;
      }
      return [{ table: src.table, field: field }];
    }

    if (ref.qualifier) {
      var q = sourceMap[ref.qualifier];
      if (!q) {
        debug.push({ type: "unknown_alias", alias: ref.qualifier, field: ref.field });
        return [{ table: "UNRESOLVED", field: ref.field }];
      }
      return resolveFromSource(q, ref.field);
    }

    if (aliases.length === 1) {
      return resolveFromSource(sourceMap[aliases[0]], ref.field);
    }

    // Try derived sources first by output column name.
    for (var i = 0; i < aliases.length; i += 1) {
      var src = sourceMap[aliases[i]];
      if (src.type === "derived" && src.columnMap[ref.field.toLowerCase()]) {
        out = out.concat(src.columnMap[ref.field.toLowerCase()]);
      }
    }
    if (out.length) {
      return dedupeSources(out);
    }

    debug.push({ type: "ambiguous_unqualified", field: ref.field, aliases: aliases });
    return [{ table: "UNRESOLVED", field: ref.field }];
  }

  function buildColumnMap(columns) {
    var map = {};
    for (var i = 0; i < columns.length; i += 1) {
      var c = columns[i];
      map[c.output.toLowerCase()] = c.sources;
    }
    return map;
  }

  function mergeUnionColumns(branches) {
    var first = branches[0] || [];
    var merged = [];

    for (var i = 0; i < first.length; i += 1) {
      var base = {
        output: first[i].output,
        expression: first[i].expression,
        comment: first[i].comment,
        sources: [],
      };
      for (var b = 0; b < branches.length; b += 1) {
        if (branches[b][i]) {
          base.sources = base.sources.concat(branches[b][i].sources);
        }
      }
      base.sources = dedupeSources(base.sources);
      merged.push(base);
    }

    return merged;
  }

  function analyzeSingleSelect(selectSql, env, targetTable, debug) {
    var parts = getSelectFromParts(selectSql);
    var selectItems = splitSelectItems(parts.selectPart);
    var fromSources = splitFromSources(parts.fromPart);

    var sourceMap = {};
    for (var i = 0; i < fromSources.length; i += 1) {
      var src = parseSourceSpec(fromSources[i], env, debug);
      if (src) {
        sourceMap[src.alias] = src;
      }
    }

    var cols = [];
    for (var j = 0; j < selectItems.length; j += 1) {
      var item = parseSelectItem(selectItems[j]);
      var refs = extractColumnRefs(item.expression);
      var sources = [];

      for (var r = 0; r < refs.length; r += 1) {
        sources = sources.concat(resolveRef(refs[r], sourceMap, debug));
      }

      sources = dedupeSources(sources);

      cols.push({
        output: normalizeIdentifier(item.output),
        expression: item.expression,
        comment: item.comment,
        sources: sources,
      });
    }

    return {
      outputTable: targetTable,
      columns: cols,
      columnMap: buildColumnMap(cols),
    };
  }

  function analyzeQuery(sql, env, targetTable, debug) {
    var normalized = stripOuterParens(stripTailSemicolon(normalizeSql(sql)));
    var withInfo = parseWithClause(normalized);

    var scoped = {
      tables: env.tables || {},
      ctes: Object.assign({}, env.ctes || {}),
    };

    for (var i = 0; i < withInfo.ctes.length; i += 1) {
      var cte = withInfo.ctes[i];
      var cteAnalyzed = analyzeQuery(cte.sql, scoped, cte.name, debug);
      scoped.ctes[cte.name] = {
        columnMap: cteAnalyzed.columnMap,
      };
    }

    var branches = splitUnionBranches(withInfo.mainQuery);
    var branchCols = [];
    for (var b = 0; b < branches.length; b += 1) {
      branchCols.push(analyzeSingleSelect(branches[b], scoped, targetTable, debug).columns);
    }

    var columns = mergeUnionColumns(branchCols);
    return {
      outputTable: targetTable,
      columns: columns,
      columnMap: buildColumnMap(columns),
    };
  }

  function parseStatementTarget(sql, index) {
    var s = normalizeSql(sql);
    var clean = stripSqlComments(s);
    var create = s.match(/^create\s+table\s+([a-zA-Z_][\w$.]*)\s+as\s+([\s\S]+)$/i);
    if (create) {
      return { targetTable: create[1], query: create[2] };
    }

    var insert = s.match(/^insert\s+into\s+([a-zA-Z_][\w$.]*)\s+([\s\S]+)$/i);
    if (insert) {
      return { targetTable: insert[1], query: insert[2] };
    }

    var overwrite = clean.match(/^insert\s+overwrite\s+table\s+([a-zA-Z_][\w$.]*)\b/i);
    if (overwrite) {
      var selectIdx = findTopLevelKeyword(clean, "select", 0);
      if (selectIdx >= 0) {
        return {
          targetTable: overwrite[1],
          query: s.slice(selectIdx),
        };
      }
      return {
        targetTable: overwrite[1],
        query: s,
      };
    }

    return { targetTable: "RESULT_" + (index + 1), query: s };
  }

  function splitStatements(sql) {
    return splitTopLevelByChar(sql, ";").filter(function (x) { return x.trim(); });
  }

  function edgesFromAnalysis(analysis, targetTable) {
    var edges = [];
    for (var i = 0; i < analysis.columns.length; i += 1) {
      var col = analysis.columns[i];
      var srcs = col.sources.length ? col.sources : classifyFallbackSource(col);
      for (var s = 0; s < srcs.length; s += 1) {
        edges.push({
          sourceTable: srcs[s].table,
          sourceField: srcs[s].field,
          targetTable: targetTable,
          targetField: col.output,
          comment: col.comment || "",
          expression: col.expression,
        });
      }
    }
    return edges;
  }

  function isSystemFuncOrConst(expression) {
    var expr = (expression || "").trim();
    if (!expr) {
      return false;
    }
    if (/^'.*'$/.test(expr) || /^\".*\"$/.test(expr)) {
      return true;
    }
    if (/^-?\d+(\.\d+)?$/.test(expr)) {
      return true;
    }
    if (/^(null|true|false)$/i.test(expr)) {
      return true;
    }
    if (/^[a-zA-Z_][\w$]*\s*\(/.test(expr)) {
      return true;
    }
    return false;
  }

  function classifyFallbackSource(col) {
    if (isSystemFuncOrConst(col.expression)) {
      return [{ table: "SYS_FUNC", field: col.output }];
    }
    return [{ table: "UNRESOLVED", field: col.expression }];
  }

  function dedupeEdges(edges) {
    var seen = {};
    var out = [];
    for (var i = 0; i < edges.length; i += 1) {
      var e = edges[i];
      var key = [e.sourceTable, e.sourceField, e.targetTable, e.targetField].join("|");
      if (!seen[key]) {
        seen[key] = true;
        out.push(e);
      }
    }
    return out;
  }

  function buildTreeRows(edges) {
    var grouped = {};
    for (var i = 0; i < edges.length; i += 1) {
      var e = edges[i];
      var key = e.targetTable + "::" + e.targetField;
      if (!grouped[key]) {
        grouped[key] = {
          targetTable: e.targetTable,
          targetField: e.targetField,
          sources: [],
        };
      }
      grouped[key].sources.push({ table: e.sourceTable, field: e.sourceField });
    }

    return Object.keys(grouped).map(function (k) {
      return {
        targetTable: grouped[k].targetTable,
        targetField: grouped[k].targetField,
        sources: dedupeSources(grouped[k].sources),
      };
    });
  }

  function safeNodeId(seed, index) {
    var base = seed.replace(/[^a-zA-Z0-9_]/g, "_");
    return base + "_" + index;
  }

  function buildMermaid(edges) {
    var lines = ["graph LR"];
    var nodeMap = {};
    var nodeIdx = 0;
    var edgeSeen = {};

    function getNodeId(label, type) {
      var key = type + "::" + label;
      if (!nodeMap[key]) {
        nodeMap[key] = safeNodeId(type, nodeIdx++);
        lines.push("  " + nodeMap[key] + "[\"" + label.replace(/\"/g, "\\\\\"") + "\"]");
      }
      return nodeMap[key];
    }

    for (var i = 0; i < edges.length; i += 1) {
      var e = edges[i];
      var srcLabel = e.sourceTable + "." + e.sourceField;
      var midLabel = e.targetField;
      var dstLabel = e.targetTable;
      var srcId = getNodeId(srcLabel, "src");
      var midId = getNodeId(midLabel, "mid");
      var dstId = getNodeId(dstLabel, "dst");

      var edge1 = srcId + "->" + midId;
      if (!edgeSeen[edge1]) {
        edgeSeen[edge1] = true;
        lines.push("  " + srcId + " --> " + midId);
      }
      var edge2 = midId + "->" + dstId;
      if (!edgeSeen[edge2]) {
        edgeSeen[edge2] = true;
        lines.push("  " + midId + " --> " + dstId);
      }
    }

    return lines.join("\n");
  }

  function validateConsistency(rows, edges, treeRows) {
    var rowKeys = {};
    rows.forEach(function (r) {
      rowKeys[[r.sourceTable, r.sourceField, r.targetTable, r.mappedField].join("|")] = true;
    });

    var edgeKeys = {};
    edges.forEach(function (e) {
      edgeKeys[[e.sourceTable, e.sourceField, e.targetTable, e.targetField].join("|")] = true;
    });

    var treeKeys = {};
    treeRows.forEach(function (group) {
      group.sources.forEach(function (s) {
        treeKeys[[s.table, s.field, group.targetTable, group.targetField].join("|")] = true;
      });
    });

    var missingInEdges = Object.keys(rowKeys).filter(function (k) { return !edgeKeys[k]; });
    var missingInTree = Object.keys(edgeKeys).filter(function (k) { return !treeKeys[k]; });
    var missingInRows = Object.keys(edgeKeys).filter(function (k) { return !rowKeys[k]; });

    return {
      pass: missingInEdges.length === 0 && missingInTree.length === 0 && missingInRows.length === 0,
      missingInEdges: missingInEdges,
      missingInTree: missingInTree,
      missingInRows: missingInRows,
    };
  }

  function parseSourceTable(sql) {
    var parts = getSelectFromParts(sql);
    var sources = splitFromSources(parts.fromPart);
    if (!sources.length) {
      return "UNRESOLVED";
    }
    var first = sources[0].match(/^([a-zA-Z_][\w$.]*)/);
    return first ? first[1] : "UNRESOLVED";
  }

  function parseSqlFields(sql) {
    var result = analyzeSqlLineage(sql, {});
    var rows = result.rows.map(function (r, idx) {
      return {
        index: idx + 1,
        sourceTable: r.sourceTable,
        sourceField: r.sourceField,
        mappedField: r.mappedField,
        comment: r.comment || "",
      };
    });
    return {
      sourceTable: rows[0] ? rows[0].sourceTable : "UNRESOLVED",
      rows: rows,
      warnings: result.warnings,
    };
  }

  function analyzeSqlLineage(sql, options) {
    var normalized = stripTailSemicolon(normalizeSql(sql));
    if (!normalized) {
      throw new Error("SQL is empty");
    }

    var statements = splitStatements(normalized);
    var tableEnv = {};
    var allEdges = [];
    var debug = [];

    for (var i = 0; i < statements.length; i += 1) {
      var stmt = parseStatementTarget(statements[i], i);
      var analysis = analyzeQuery(stmt.query, { tables: tableEnv, ctes: {} }, stmt.targetTable, debug);
      var edges = edgesFromAnalysis(analysis, stmt.targetTable);
      allEdges = allEdges.concat(edges);
      tableEnv[stmt.targetTable] = {
        columnMap: analysis.columnMap,
      };
    }

    allEdges = dedupeEdges(allEdges);

    var rows = allEdges.map(function (e, idx) {
      return {
        index: idx + 1,
        sourceTable: e.sourceTable,
        sourceField: e.sourceField,
        mappedField: e.targetField,
        targetTable: e.targetTable,
        comment: e.comment || "",
        expression: e.expression,
      };
    });

    var treeRows = buildTreeRows(allEdges);
    var consistency = validateConsistency(rows, allEdges, treeRows);

    return {
      rows: rows,
      lineageEdges: allEdges,
      lineageTree: treeRows,
      mermaid: buildMermaid(allEdges),
      rewrittenSql: "",
      renameReport: [],
      astSummary: {
        statementCount: statements.length,
        edgeCount: allEdges.length,
        fieldCount: rows.length,
      },
      consistencyCheck: consistency,
      warnings: allEdges.some(function (e) { return e.sourceTable === "UNRESOLVED"; }) ? ["Contains unresolved lineage refs"] : [],
      debugInfo: debug,
    };
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

  function rewriteSelectSql(sql) {
    return normalizeSql(sql);
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
