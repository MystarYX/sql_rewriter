const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const { analyzeSqlLineage, parseSqlFields, splitSelectItems } = require("../parser");
const uiComplexLayoutSnapshot = require("./ui-complex-layout.snapshot.json");

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

test("keyword NOT should not be extracted as lineage field", () => {
  const sql = "SELECT IF(flag NOT IN ('A','B'), qty, 0) AS out_qty FROM t";
  const result = analyzeSqlLineage(sql, {});
  const hasNot = result.lineageEdges.some((e) => e.sourceField.toUpperCase() === "NOT");
  const hasIn = result.lineageEdges.some((e) => e.sourceField.toUpperCase() === "IN");
  const hasFlag = result.lineageEdges.some((e) => e.sourceField === "flag" && e.targetField === "out_qty");
  const hasQty = result.lineageEdges.some((e) => e.sourceField === "qty" && e.targetField === "out_qty");
  assert.equal(hasNot, false);
  assert.equal(hasIn, false);
  assert.equal(hasFlag, true);
  assert.equal(hasQty, true);
});

test("no-AS alias expression should not produce self-mapping pseudo lineage", () => {
  const sql = "SELECT CASE WHEN logt_splr_quot > 0 THEN 1 ELSE 0 END logt_splr_quot_flag FROM base_gt_stock_all_di";
  const result = analyzeSqlLineage(sql, {});
  const hasSelf = result.lineageEdges.some((e) =>
    e.sourceField === "logt_splr_quot_flag" && e.targetField === "logt_splr_quot_flag"
  );
  const hasReal = result.lineageEdges.some((e) =>
    e.sourceField === "logt_splr_quot" && e.targetField === "logt_splr_quot_flag"
  );
  assert.equal(hasSelf, false);
  assert.equal(hasReal, true);
});

test("base_gt_stock_all_di style metrics and SYS_FUNC classification", () => {
  const sql = `SELECT
    SUM(IF(COL_RVTYPE='1',COL_QTY,0)) AS invr_qty,
    SUM(IF(COL_RVTYPE='1',COL_RCY1,0)) AS invr_rcy1,
    uuid() AS icode,
    current_timestamp() AS etl_time
FROM base_gt_stock_all_di`;
  const result = analyzeSqlLineage(sql, {});

  const invrQtyFields = result.lineageEdges
    .filter((e) => e.targetField === "invr_qty")
    .map((e) => e.sourceField)
    .sort();
  const invrRcy1Fields = result.lineageEdges
    .filter((e) => e.targetField === "invr_rcy1")
    .map((e) => e.sourceField)
    .sort();
  const icodeSource = result.lineageEdges.find((e) => e.targetField === "icode");
  const etlSource = result.lineageEdges.find((e) => e.targetField === "etl_time");

  assert.deepEqual(invrQtyFields, ["COL_QTY", "COL_RVTYPE"]);
  assert.deepEqual(invrRcy1Fields, ["COL_RCY1", "COL_RVTYPE"]);
  assert.equal(icodeSource.sourceTable, "SYS_FUNC");
  assert.equal(etlSource.sourceTable, "SYS_FUNC");
});

test("lineage tree and mermaid output exist", () => {
  const sql = "SELECT a AS x, b AS y FROM t";
  const result = analyzeSqlLineage(sql, {});
  assert.equal(Array.isArray(result.lineageTree), true);
  assert.equal(result.lineageTree.length >= 2, true);
  assert.equal(/^graph LR/.test(result.mermaid), true);
  assert.equal(result.mermaid.includes("-->"), true);
  assert.equal(result.consistencyCheck.pass, true);
});

test("tight alias max(col)alias should not create self-mapping", () => {
  const sql = "SELECT max(COL_SCODE_CCODE_QUOTA)logt_splr_quot FROM base_gt_stock_all_di";
  const result = analyzeSqlLineage(sql, {});
  const hasReal = result.lineageEdges.some((e) =>
    e.sourceField === "COL_SCODE_CCODE_QUOTA" && e.targetField === "logt_splr_quot"
  );
  const hasSelf = result.lineageEdges.some((e) =>
    e.sourceField === "logt_splr_quot" && e.targetField === "logt_splr_quot"
  );
  assert.equal(hasReal, true);
  assert.equal(hasSelf, false);
});

test("tight alias sum(col)alias should not create self-mapping", () => {
  const sql = "SELECT sum(COL_QTY)invr_qty FROM base_gt_stock_all_di";
  const result = analyzeSqlLineage(sql, {});
  const hasReal = result.lineageEdges.some((e) =>
    e.sourceField === "COL_QTY" && e.targetField === "invr_qty"
  );
  const hasSelf = result.lineageEdges.some((e) =>
    e.sourceField === "invr_qty" && e.targetField === "invr_qty"
  );
  assert.equal(hasReal, true);
  assert.equal(hasSelf, false);
});

test("tight alias cast(sum(col)...)alias should not create self-mapping", () => {
  const sql = "SELECT cast(sum(COL_RCY1) as decimal(24,6))invr_rcy1 FROM base_gt_stock_all_di";
  const result = analyzeSqlLineage(sql, {});
  const hasReal = result.lineageEdges.some((e) =>
    e.sourceField === "COL_RCY1" && e.targetField === "invr_rcy1"
  );
  const hasSelf = result.lineageEdges.some((e) =>
    e.sourceField === "invr_rcy1" && e.targetField === "invr_rcy1"
  );
  assert.equal(hasReal, true);
  assert.equal(hasSelf, false);
});

test("ui style snapshot has horizontal-tree structure classes", () => {
  const html = fs.readFileSync("./index.html", "utf8");
  const js = fs.readFileSync("./app.js", "utf8");
  const css = fs.readFileSync("./styles.css", "utf8");
  assert.equal(html.includes('id="tree-view"'), true);
  assert.equal(html.includes('id="mermaid-text"'), true);
  assert.equal(js.includes("table-toggle"), true);
  assert.equal(js.includes("collapse-all"), true);
  assert.equal(js.includes("expand-all"), true);
  assert.equal(css.includes(".graph-canvas"), true);
  assert.equal(css.includes(".graph-toolbar"), true);
  assert.equal(css.includes(".table-toggle"), true);
  assert.equal(css.includes(".graph-svg"), true);
  assert.equal(css.includes(".graph-node.table"), true);
  assert.equal(css.includes(".graph-node.field"), true);
  assert.equal(css.includes(".graph-node.target"), true);
  assert.equal(css.includes(".graph-node.result"), true);
  assert.equal(css.includes(".graph-edge"), true);
});

test("ui regression snapshot gate for complex sql layout", () => {
  const js = fs.readFileSync("./app.js", "utf8");
  uiComplexLayoutSnapshot.requiredTokens.forEach((token) => {
    assert.equal(js.includes(token), true, "missing ui token: " + token);
  });
  uiComplexLayoutSnapshot.requiredRegex.forEach((pattern) => {
    assert.equal(new RegExp(pattern).test(js), true, "missing ui regex: " + pattern);
  });

  const sql = `
WITH c1 AS (
  SELECT a.id, sum(a.qty) AS qty_sum FROM base_a a GROUP BY a.id
),
c2 AS (
  SELECT c1.id, c1.qty_sum AS qty FROM c1
)
SELECT c2.qty AS out_qty
FROM c2
`;
  const result = analyzeSqlLineage(sql, {});
  const targets = new Set(result.graphEdges.map((e) => e.targetTable));
  assert.equal(targets.has("c1"), true);
  assert.equal(targets.has("c2"), true);
  assert.equal(targets.has("RESULT_1"), true);
});

test("insert overwrite target table and 13 projection columns", () => {
  const sql = `INSERT OVERWRITE TABLE ads_lift_crdttradinvg_gt_rcvbovdudspahis_df PARTITION (pt='\${bizdate}')
SELECT
  m.mana_org,
  m.crnt_date,
  m.cust_id,
  m.ovdu_days,
  m.ovdu_rcy1,
  SUM(m.ovdu_rcy1) AS ovdu_rcy1_sum,
  SUM(IF(m.ovdu_days > 30, m.ovdu_rcy1, 0)) AS ovdu_rcy1_30_days,
  CASE WHEN m.ovdu_days > 60 THEN m.ovdu_rcy1 ELSE 0 END AS ovdu_rcy1_60_days,
  m.col_a, -- comment should not pollute next item
  m.col_b,
  uuid() AS icode,
  current_timestamp() AS etl_time,
  m.col_c
FROM gf_core.dwd_crdt_trad_invg_gt_rcvb_ovdu_dspa_his_df m
WHERE m.pt='\${bizdate}'
GROUP BY
  m.mana_org,m.crnt_date,m.cust_id,m.ovdu_days,m.ovdu_rcy1,m.col_a,m.col_b,m.col_c`;

  const result = analyzeSqlLineage(sql, {});

  assert.equal(result.lineageTree.length, 13);
  assert.equal(result.rows.every((r) => r.targetTable === "ads_lift_crdttradinvg_gt_rcvbovdudspahis_df"), true);
  assert.equal(result.rows.some((r) => /from|where|group by/i.test(String(r.sourceField))), false);

  const has30DaysA = result.lineageEdges.some((e) => e.targetField === "ovdu_rcy1_30_days" && e.sourceField === "ovdu_days");
  const has30DaysB = result.lineageEdges.some((e) => e.targetField === "ovdu_rcy1_30_days" && e.sourceField === "ovdu_rcy1");
  assert.equal(has30DaysA, true);
  assert.equal(has30DaysB, true);

  const icode = result.lineageEdges.find((e) => e.targetField === "icode");
  const etlTime = result.lineageEdges.find((e) => e.targetField === "etl_time");
  assert.equal(icode.sourceTable, "SYS_FUNC");
  assert.equal(etlTime.sourceTable, "SYS_FUNC");

  const bareFields = ["mana_org", "crnt_date", "cust_id", "ovdu_days", "ovdu_rcy1", "col_a", "col_b", "col_c"];
  bareFields.forEach((f) => {
    const hit = result.lineageEdges.find((e) => e.targetField === f);
    assert.equal(hit.sourceTable, "gf_core.dwd_crdt_trad_invg_gt_rcvb_ovdu_dspa_his_df");
  });
});

test("insert overwrite parser should not concat long unresolved column text", () => {
  const sql = `INSERT OVERWRITE TABLE ads_test PARTITION (pt='\${bizdate}')
SELECT
  m.col_a, -- c1
  m.col_b,
  SUM(IF(m.col_a > 0, m.col_b, 0)) AS col_c
FROM gf_core.test_table m`;

  const result = analyzeSqlLineage(sql, {});
  const targets = result.lineageTree.map((x) => x.targetField).sort();
  assert.deepEqual(targets, ["col_a", "col_b", "col_c"]);
  assert.equal(result.rows.some((r) => String(r.sourceField).length > 120), false);
});

test("insert overwrite with leading whitespace should still parse target table", () => {
  const sql = `

  INSERT OVERWRITE TABLE ads_leading_ws_target PARTITION (pt='\${bizdate}')
  SELECT m.col_a
  FROM gf_core.test_table m`;

  const result = analyzeSqlLineage(sql, {});
  assert.equal(result.rows.length > 0, true);
  assert.equal(result.rows.every((r) => r.targetTable === "ads_leading_ws_target"), true);
});

test("left semi join derived source should keep alias lineage", () => {
  const sql = `SELECT m.corpbcode
FROM (
  SELECT pur.corpbcode AS corpbcode
  FROM (SELECT corpbcode, ccode FROM t_pur) pur
  LEFT SEMI JOIN (SELECT ccode FROM t_ccode) t1
    ON t1.ccode = pur.ccode
) m`;
  const result = analyzeSqlLineage(sql, {});
  const hit = result.lineageEdges.find((e) => e.targetField === "corpbcode");
  assert.equal(hit.sourceTable, "t_pur");
  assert.equal(hit.sourceField, "corpbcode");
  assert.equal(
    result.lineageEdges.some((e) => e.targetField === "corpbcode" && e.sourceTable === "UNRESOLVED"),
    false
  );
});

test("derived source with tight alias )a should be parsed", () => {
  const sql = "SELECT x.id AS out_id FROM (SELECT id FROM base_t)x";
  const result = analyzeSqlLineage(sql, {});
  const edge = result.lineageEdges.find((e) => e.targetField === "out_id");
  assert.equal(edge.sourceTable, "base_t");
  assert.equal(edge.sourceField, "id");
});

test("loose mode should fallback unqualified field to primary alias, not fixed m", () => {
  const sql = "SELECT ori AS out_ori FROM t_main x LEFT JOIN t_other y ON x.id = y.id";
  const strict = analyzeSqlLineage(sql, {});
  const loose = analyzeSqlLineage(sql, { looseMainAlias: true });

  const strictHit = strict.lineageEdges.find((e) => e.targetField === "out_ori");
  const looseHit = loose.lineageEdges.find((e) => e.targetField === "out_ori");

  assert.equal(strictHit.sourceTable, "UNRESOLVED");
  assert.equal(strictHit.sourceField, "ori");
  assert.equal(looseHit.sourceTable, "t_main");
  assert.equal(looseHit.sourceField, "ori");
});

test("same physical table with different aliases should stay separated", () => {
  const sql = "SELECT t1.cust_name AS n1, t2.cust_name AS n2 FROM table_a t1 JOIN table_a t2 ON t1.id = t2.id";
  const result = analyzeSqlLineage(sql, {});
  const n1 = result.lineageEdges.find((e) => e.targetField === "n1");
  const n2 = result.lineageEdges.find((e) => e.targetField === "n2");
  assert.equal(n1.sourceTable, "table_a");
  assert.equal(n2.sourceTable, "table_a");
  assert.equal(n1.sourceAlias, "t1");
  assert.equal(n2.sourceAlias, "t2");
  const rowN1 = result.rows.find((r) => r.mappedField === "n1");
  const rowN2 = result.rows.find((r) => r.mappedField === "n2");
  assert.equal(rowN1.sourceTable, "table_a t1");
  assert.equal(rowN2.sourceTable, "table_a t2");
});

test("graph edges should include cte stage and final stage", () => {
  const sql = "WITH c AS (SELECT a AS b FROM t) SELECT b AS out FROM c";
  const result = analyzeSqlLineage(sql, {});
  const hasCteStage = result.graphEdges.some((e) => e.targetTable === "c" && e.targetField === "b");
  const hasFinalStage = result.graphEdges.some((e) => e.targetTable === "RESULT_1" && e.targetField === "out");
  const hasCToFinal = result.graphEdges.some((e) => e.sourceTable === "c" && e.sourceField === "b" && e.targetTable === "RESULT_1" && e.targetField === "out");
  const hasBaseToFinal = result.graphEdges.some((e) => e.sourceTable === "t" && e.sourceField === "a" && e.targetTable === "RESULT_1" && e.targetField === "out");
  assert.equal(hasCteStage, true);
  assert.equal(hasFinalStage, true);
  assert.equal(hasCToFinal, true);
  assert.equal(hasBaseToFinal, false);
});

test("with + insert overwrite should resolve target table", () => {
  const sql = `WITH c AS (SELECT a AS b FROM t)
INSERT OVERWRITE TABLE ads_x
SELECT b AS out_col FROM c`;
  const result = analyzeSqlLineage(sql, {});
  assert.equal(result.rows.length > 0, true);
  assert.equal(result.rows.every((r) => r.targetTable === "ads_x"), true);
});

test("subquery stage should include base->subquery and subquery->result", () => {
  const sql = "SELECT b1.qty AS out_qty FROM (SELECT sum(qty) AS qty FROM base_t) b1";
  const result = analyzeSqlLineage(sql, {});
  const hasBaseToB1 = result.graphEdges.some((e) =>
    e.sourceTable === "base_t" && e.sourceField === "qty" && e.targetTable === "b1" && e.targetField === "qty"
  );
  const hasB1ToResult = result.graphEdges.some((e) =>
    e.sourceTable === "b1" && e.sourceField === "qty" && e.targetTable === "RESULT_1" && e.targetField === "out_qty"
  );
  const hasBaseToResult = result.graphEdges.some((e) =>
    e.sourceTable === "base_t" && e.sourceField === "qty" && e.targetTable === "RESULT_1" && e.targetField === "out_qty"
  );
  assert.equal(hasBaseToB1, true);
  assert.equal(hasB1ToResult, true);
  assert.equal(hasBaseToResult, false);
});

test("complex nested query should expose intermediate target tables", () => {
  const sql = "SELECT x.z AS out_col FROM (SELECT i.y AS z FROM (SELECT a AS y FROM t) i) x";
  const result = analyzeSqlLineage(sql, {});
  const targets = new Set(result.graphEdges.map((e) => e.targetTable));
  assert.equal(targets.has("i"), true);
  assert.equal(targets.has("x"), true);
  assert.equal(targets.has("RESULT_1"), true);
});
