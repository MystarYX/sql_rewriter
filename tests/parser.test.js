const test = require("node:test");
const assert = require("node:assert/strict");
const {
  parseSqlFields,
  splitSelectItems,
  parseSourceTable,
  parseStandardDict,
  analyzeSqlLineage,
  rewriteSelectSql,
} = require("../parser");

test("AS 别名解析", () => {
  const sql = "SELECT gicode AS COL_ID FROM goods";
  const result = parseSqlFields(sql);
  assert.equal(result.rows[0].sourceField, "gicode");
  assert.equal(result.rows[0].mappedField, "COL_ID");
  assert.equal(result.rows[0].sourceTable, "goods");
});

test("无 AS 别名解析", () => {
  const sql = "SELECT gicode COL_ID FROM goods";
  const result = parseSqlFields(sql);
  assert.equal(result.rows[0].sourceField, "gicode");
  assert.equal(result.rows[0].mappedField, "COL_ID");
});

test("多字段拆分", () => {
  const sql = "SELECT a AS A, b AS B, c AS C FROM t1";
  const result = parseSqlFields(sql);
  assert.equal(result.rows.length, 3);
  assert.equal(result.rows[2].mappedField, "C");
});

test("函数字段中逗号不应拆错", () => {
  const sql = "SELECT concat(a, '-', b) AS ab, c AS c2 FROM t2";
  const result = parseSqlFields(sql);
  assert.equal(result.rows.length, 2);
  assert.equal(result.rows[0].mappedField, "ab");
});

test("提取 FROM 表名", () => {
  const sql = "SELECT x AS y FROM schema_1.table_1 t";
  assert.equal(parseSourceTable(sql), "schema_1.table_1");
});

test("无 FROM 时返回未识别", () => {
  const sql = "SELECT x AS y";
  const result = parseSqlFields(sql);
  assert.equal(result.rows[0].sourceTable, "未识别");
});

test("行注释解析", () => {
  const sql = "SELECT gicode AS COL_ID -- 商品编码\nFROM goods";
  const result = parseSqlFields(sql);
  assert.equal(result.rows[0].comment, "商品编码");
});

test("块注释解析", () => {
  const sql = "SELECT gicode AS COL_ID /* 商品编码 */ FROM goods";
  const result = parseSqlFields(sql);
  assert.equal(result.rows[0].comment, "商品编码");
});

test("空 SQL 抛错", () => {
  assert.throws(() => parseSqlFields("   "), /SQL 为空/);
});

test("表达式字段无别名时不应误判", () => {
  const sql = "SELECT a + b FROM t";
  const result = parseSqlFields(sql);
  assert.equal(result.rows[0].sourceField, "a");
  assert.equal(result.rows[0].mappedField, "a + b");
});

test("AS 带双引号别名可识别", () => {
  const sql = 'SELECT gicode AS "COL_ID" FROM goods';
  const result = parseSqlFields(sql);
  assert.equal(result.rows[0].sourceField, "gicode");
  assert.equal(result.rows[0].mappedField, "COL_ID");
});

test("无 AS + 引号别名可识别", () => {
  const sql = 'SELECT col "ALIAS" FROM t';
  const result = parseSqlFields(sql);
  assert.equal(result.rows[0].sourceField, "col");
  assert.equal(result.rows[0].mappedField, "ALIAS");
});

test("splitSelectItems 边界", () => {
  const items = splitSelectItems("a, func(b, c), d");
  assert.deepEqual(items, ["a", "func(b, c)", "d"]);
});

test("标准字段字典解析", () => {
  const dict = parseStandardDict("cust_name,customer_name\namt amount");
  assert.equal(dict.cust_name, "customer_name");
  assert.equal(dict.amt, "amount");
});

test("重写 SQL 基础字段替换", () => {
  const rewritten = rewriteSelectSql(
    "SELECT cust_name AS c_name, amt AS amt FROM order_info",
    { cust_name: "customer_name", amt: "amount", c_name: "customer_name" }
  );
  assert.match(rewritten, /customer_name/);
  assert.match(rewritten, /amount/);
  assert.equal(/cust_name/.test(rewritten), false);
  assert.equal(/\bamt\b/.test(rewritten), false);
});

test("CTE 字段血缘解析", () => {
  const sql = `WITH t AS (SELECT cust_name AS c_name FROM orders) SELECT c_name AS final_name FROM t`;
  const result = analyzeSqlLineage(sql, {});
  const hasEdge = result.lineageEdges.some((e) =>
    e.sourceTable === "orders" && e.sourceField === "cust_name" && e.targetField === "final_name"
  );
  assert.equal(hasEdge, true);
});

test("跨语句链路 A.C -> B.D -> C.E", () => {
  const sql = `
CREATE TABLE B AS SELECT C AS D FROM A;
CREATE TABLE C AS SELECT D AS E FROM B;
`;
  const result = analyzeSqlLineage(sql, {});
  const hasAB = result.lineageEdges.some((e) =>
    e.sourceTable === "A" && e.sourceField === "C" && e.targetTable === "B" && e.targetField === "D"
  );
  const hasAC = result.lineageEdges.some((e) =>
    e.sourceTable === "A" && e.sourceField === "C" && e.targetTable === "C" && e.targetField === "E"
  );
  assert.equal(hasAB, true);
  assert.equal(hasAC, true);
});

test("JOIN 场景可识别来源", () => {
  const sql = "SELECT a.cust_name AS cust_name, b.amt AS amt FROM t1 a LEFT JOIN t2 b ON a.id=b.id";
  const result = analyzeSqlLineage(sql, {});
  const hasCust = result.lineageEdges.some((e) => e.sourceTable === "t1" && e.sourceField === "cust_name");
  const hasAmt = result.lineageEdges.some((e) => e.sourceTable === "t2" && e.sourceField === "amt");
  assert.equal(hasCust, true);
  assert.equal(hasAmt, true);
});

test("窗口函数来源识别", () => {
  const sql = "SELECT SUM(amt) OVER(PARTITION BY cust_id) AS win_amt FROM payments";
  const result = analyzeSqlLineage(sql, {});
  const fields = result.lineageEdges.map((e) => e.sourceField);
  assert.equal(fields.includes("amt"), true);
  assert.equal(fields.includes("cust_id"), true);
});

test("分析结果包含重构报告", () => {
  const sql = "SELECT cust_name AS c_name FROM order_info";
  const result = analyzeSqlLineage(sql, {
    standardDictText: "cust_name,customer_name\nc_name,customer_name",
    location: "order_query.sql",
  });
  assert.equal(result.renameReport.length > 0, true);
  assert.equal(result.renameReport[0].location, "order_query.sql");
});

test("安全替换-字符串常量不应被修改", () => {
  const sql = "SELECT 'amt' AS lit, amt AS amt2, total_amt FROM t";
  const rewritten = rewriteSelectSql(sql, { amt: "amount" });
  assert.equal(rewritten.includes("'amt'"), true);
  assert.equal(rewritten.includes("'amount'"), false);
  assert.equal(/\bamount\b/.test(rewritten), true);
});

test("安全替换-注释中的字段名不应被修改", () => {
  const sql = "SELECT amt /* amt should stay */, amt AS amt2 FROM t";
  const rewritten = rewriteSelectSql(sql, { amt: "amount" });
  assert.equal(rewritten.includes("/* amt should stay */"), true);
});

test("安全替换-函数字符串参数不应被修改", () => {
  const sql = "SELECT concat('amt', amt) AS x FROM t";
  const rewritten = rewriteSelectSql(sql, { amt: "amount" });
  assert.equal(rewritten.includes("concat('amt', amount)"), true);
});

test("安全替换-双引号和反引号标识符内部不替换", () => {
  const sql = 'SELECT "amt" AS q1, `amt` AS q2, amt AS q3 FROM t';
  const rewritten = rewriteSelectSql(sql, { amt: "amount" });
  assert.equal(rewritten.includes('"amt"'), true);
  assert.equal(rewritten.includes("`amt`"), true);
  assert.equal(rewritten.includes("amount AS q3"), true);
});
