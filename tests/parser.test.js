const test = require("node:test");
const assert = require("node:assert/strict");
const { parseSqlFields, splitSelectItems, parseSourceTable } = require("../parser");

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

test("非 SELECT SQL 抛错", () => {
  assert.throws(() => parseSqlFields("UPDATE t SET a = 1"), /SELECT/);
});

test("SELECT 后没有字段抛错", () => {
  assert.throws(() => parseSqlFields("SELECT FROM t"), /字段列表/);
});

test("splitSelectItems 边界", () => {
  const items = splitSelectItems("a, func(b, c), d");
  assert.deepEqual(items, ["a", "func(b, c)", "d"]);
});

test("表达式字段无别名时不应误判", () => {
  const sql = "SELECT a + b FROM t";
  const result = parseSqlFields(sql);
  assert.equal(result.rows[0].sourceField, "a + b");
  assert.equal(result.rows[0].mappedField, "a + b");
});

test("AS 带双引号别名可识别", () => {
  const sql = 'SELECT gicode AS "COL_ID" FROM goods';
  const result = parseSqlFields(sql);
  assert.equal(result.rows[0].sourceField, "gicode");
  assert.equal(result.rows[0].mappedField, "COL_ID");
});

test("无 AS 场景下表达式加别名当前按原表达式处理", () => {
  const sql = "SELECT a + b total FROM t";
  const result = parseSqlFields(sql);
  assert.equal(result.rows[0].sourceField, "a + b total");
  assert.equal(result.rows[0].mappedField, "a + b total");
});

test("无 AS + 引号别名可识别", () => {
  const sql = 'SELECT col "ALIAS" FROM t';
  const result = parseSqlFields(sql);
  assert.equal(result.rows[0].sourceField, "col");
  assert.equal(result.rows[0].mappedField, "ALIAS");
});
