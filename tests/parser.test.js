const test = require("node:test");
const assert = require("node:assert/strict");
const { analyzeSqlLineage, parseSqlFields, splitSelectItems } = require("../parser");

test("basic AS alias lineage", () => {
  const sql = "SELECT gicode AS COL_ID FROM goods";
  const result = analyzeSqlLineage(sql, {});
  assert.equal(result.lineageEdges.length, 1);
  assert.equal(result.lineageEdges[0].sourceTable, "goods");
  assert.equal(result.lineageEdges[0].sourceField, "gicode");
  assert.equal(result.lineageEdges[0].targetField, "COL_ID");
});

test("basic no-AS alias lineage", () => {
  const sql = "SELECT gicode COL_ID FROM goods";
  const result = analyzeSqlLineage(sql, {});
  assert.equal(result.lineageEdges[0].sourceField, "gicode");
  assert.equal(result.lineageEdges[0].targetField, "COL_ID");
});

test("split select items handles commas in functions", () => {
  const items = splitSelectItems("a, concat(b, ',', c), d");
  assert.deepEqual(items, ["a", "concat(b, ',', c)", "d"]);
});

test("join lineage keeps real source tables", () => {
  const sql = "SELECT a.cust_name AS cust_name, b.amt AS amt FROM t1 a LEFT JOIN t2 b ON a.id=b.id";
  const result = analyzeSqlLineage(sql, {});
  const hasT1 = result.lineageEdges.some((e) => e.sourceTable === "t1" && e.sourceField === "cust_name" && e.targetField === "cust_name");
  const hasT2 = result.lineageEdges.some((e) => e.sourceTable === "t2" && e.sourceField === "amt" && e.targetField === "amt");
  assert.equal(hasT1, true);
  assert.equal(hasT2, true);
});

test("union all merges branch lineage", () => {
  const sql = "SELECT x AS y FROM t1 UNION ALL SELECT x AS y FROM t2";
  const result = analyzeSqlLineage(sql, {});
  const fromT1 = result.lineageEdges.some((e) => e.sourceTable === "t1" && e.targetField === "y");
  const fromT2 = result.lineageEdges.some((e) => e.sourceTable === "t2" && e.targetField === "y");
  assert.equal(fromT1, true);
  assert.equal(fromT2, true);
});

test("nested subquery alias drill-down", () => {
  const sql = "SELECT b1.qty AS out_qty FROM (SELECT sum(qty) AS qty FROM base_t) b1";
  const result = analyzeSqlLineage(sql, {});
  const edge = result.lineageEdges.find((e) => e.targetField === "out_qty");
  assert.equal(edge.sourceTable, "base_t");
  assert.equal(edge.sourceField, "qty");
});

test("case when lineage includes condition and value refs", () => {
  const sql = "SELECT CASE WHEN amt > 0 THEN amt ELSE 0 END AS pay_amt FROM pay_t";
  const result = analyzeSqlLineage(sql, {});
  const hasAmt = result.lineageEdges.some((e) => e.sourceTable === "pay_t" && e.sourceField === "amt" && e.targetField === "pay_amt");
  assert.equal(hasAmt, true);
});

test("window function lineage", () => {
  const sql = "SELECT SUM(amt) OVER(PARTITION BY cust_id) AS win_amt FROM p";
  const result = analyzeSqlLineage(sql, {});
  const hasAmt = result.lineageEdges.some((e) => e.sourceField === "amt" && e.targetField === "win_amt");
  const hasCust = result.lineageEdges.some((e) => e.sourceField === "cust_id" && e.targetField === "win_amt");
  assert.equal(hasAmt, true);
  assert.equal(hasCust, true);
});

test("cte drill-down lineage", () => {
  const sql = "WITH t AS (SELECT cust_name AS c_name FROM orders) SELECT c_name AS final_name FROM t";
  const result = analyzeSqlLineage(sql, {});
  const edge = result.lineageEdges.find((e) => e.targetField === "final_name");
  assert.equal(edge.sourceTable, "orders");
  assert.equal(edge.sourceField, "cust_name");
});

test("multi statement chain A.C -> B.D -> C.E", () => {
  const sql = "CREATE TABLE B AS SELECT C AS D FROM A; CREATE TABLE C AS SELECT D AS E FROM B;";
  const result = analyzeSqlLineage(sql, {});
  const hasAB = result.lineageEdges.some((e) => e.sourceTable === "A" && e.sourceField === "C" && e.targetTable === "B" && e.targetField === "D");
  const hasAC = result.lineageEdges.some((e) => e.sourceTable === "A" && e.sourceField === "C" && e.targetTable === "C" && e.targetField === "E");
  assert.equal(hasAB, true);
  assert.equal(hasAC, true);
});

test("complex provided SQL lineage should not mark invr_qty as unresolved", () => {
  const sql = `SELECT 
        b2.purordgicodex
        ,sum(b1.qty) AS invr_qty
        ,sum(if(datediff(date_format(b2.fratifydate,'yyyy-MM-dd'),date_format(b2.findate,'yyyy-MM-dd'))+1 > 90,b1.qty,0)) AS invr_qty_90
FROM (
        SELECT 
                r.ingislcodex
                ,sum(r.qty) AS qty
                ,sum(r.qtt) AS qtt
        FROM (
                SELECT 
                        ingislcodex
                        ,round(qty,6) AS qty
                        ,round(qtt,6) AS qtt
                FROM 
                        gf_core.ods_erp_storesbalance_df 
                WHERE 
                        qty <> 0.0 
                        AND pt = '\${basidata_date}'

                UNION ALL
                
                SELECT 
                        g.ingislcodex
                        ,round(sum(g.dc * g.qty) * -1,6) AS qty
                        ,round(sum(g.dc * g.qtt) * -1,6) AS qtt
                FROM (
                        SELECT 
                                islcode 
                        FROM 
                                gf_core.ods_erp_storeslist_df  
                        WHERE 
                                status ='70' 
                ) m 
                INNER JOIN (
                        SELECT 
                                sg.ingislcodex AS ingislcodex
                                ,sg.islcode AS islcode
                                ,cast(sg.dc as int) AS dc
                                ,cast(sg.qty as decimal(24,6)) AS qty
                                ,cast(sg.qtt as decimal(24,6)) AS qtt  
                        FROM 
                                gf_core.ods_erp_storeslistg_df sg 
                ) g 
                ON g.islcode = m.islcode 
                GROUP BY 
                        g.ingislcodex
        ) r 
        GROUP BY 
                ingislcodex 
        HAVING 
                sum(r.qty) <> 0.0
) b1
INNER JOIN gf_core.basetemp_gf_storeslistg_in_df b2 
        ON b1.ingislcodex = b2.ingislcodex 
GROUP BY 
        b2.purordgicodex`;

  const result = analyzeSqlLineage(sql, {});

  const hasPur = result.lineageEdges.some((e) =>
    e.sourceTable === "gf_core.basetemp_gf_storeslistg_in_df" &&
    e.sourceField === "purordgicodex" &&
    e.targetField === "purordgicodex"
  );

  const hasInvrQtyFromBalance = result.lineageEdges.some((e) =>
    e.sourceTable === "gf_core.ods_erp_storesbalance_df" &&
    e.sourceField === "qty" &&
    e.targetField === "invr_qty"
  );

  const hasInvrQtyFromGdc = result.lineageEdges.some((e) =>
    e.sourceTable === "gf_core.ods_erp_storeslistg_df" &&
    e.sourceField === "dc" &&
    e.targetField === "invr_qty"
  );

  const has90Fratify = result.lineageEdges.some((e) =>
    e.sourceTable === "gf_core.basetemp_gf_storeslistg_in_df" &&
    e.sourceField === "fratifydate" &&
    e.targetField === "invr_qty_90"
  );

  const has90Findate = result.lineageEdges.some((e) =>
    e.sourceTable === "gf_core.basetemp_gf_storeslistg_in_df" &&
    e.sourceField === "findate" &&
    e.targetField === "invr_qty_90"
  );

  const unresolvedInvrQty = result.lineageEdges.some((e) => e.targetField === "invr_qty" && e.sourceTable === "UNRESOLVED");

  assert.equal(hasPur, true);
  assert.equal(hasInvrQtyFromBalance, true);
  assert.equal(hasInvrQtyFromGdc, true);
  assert.equal(has90Fratify, true);
  assert.equal(has90Findate, true);
  assert.equal(unresolvedInvrQty, false);
});

test("parseSqlFields compatible rows", () => {
  const result = parseSqlFields("SELECT a AS b FROM t");
  assert.equal(result.rows.length, 1);
  assert.equal(result.rows[0].sourceTable, "t");
  assert.equal(result.rows[0].sourceField, "a");
  assert.equal(result.rows[0].mappedField, "b");
});

test("debug info exists for unresolved refs", () => {
  const result = analyzeSqlLineage("SELECT x FROM t1 a JOIN t2 b ON a.id=b.id", {});
  assert.equal(Array.isArray(result.debugInfo), true);
});
