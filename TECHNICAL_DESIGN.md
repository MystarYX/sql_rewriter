# SQL字段血缘解析与标准字段重构工具

## 技术设计文档（Technical Design Document）

### 1. 项目背景
现有历史 SQL 脚本在早期开发阶段缺乏统一字段标准，导致以下问题：
- 字段命名不规范
- 同义字段并存（如 `cust_nm`、`cust_name`、`customer`）
- SQL 维护成本高
- 字段级血缘关系难以追踪

在数据治理推进过程中，需要将 SQL 中字段统一重构为标准字段体系。但字段在多段 SQL 链路中会经历别名映射与表达式加工，无法通过简单字符串替换完成。

示例链路：
- SQL1: `SELECT C AS D FROM A`
- SQL2: `SELECT D AS E FROM B`
- 最终血缘：`A.C -> B.D -> C.E`

### 2. 系统目标
构建一套 SQL 字段血缘解析与标准字段重构工具，实现：
1. 解析复杂 SQL 结构（多方言）
2. 识别表级与字段级血缘
3. 构建字段血缘链路
4. 基于标准字段字典执行字段替换
5. 自动生成标准化 SQL
6. 输出字段血缘与替换报告

### 3. 范围定义
#### 3.1 In Scope（V1-V2）
- 单条/批量 SQL 文件处理
- `SELECT`、`FROM`、`JOIN`、`CTE`、子查询
- 表达式字段来源识别（聚合、CASE、窗口函数）
- 字段标准映射与 SQL AST 重写
- 血缘与替换结果导出（JSON/CSV）

#### 3.2 Out of Scope（后续）
- SQL 执行计划优化
- 跨任务调度 DAG 编排
- 元数据平台集成（Data Catalog 双向写回）

### 4. 总体架构
```
SQL Input
  -> SQL Parse Module
  -> AST Builder
  -> Symbol & Scope Resolver
  -> Column Lineage Engine
  -> Standard Mapping Engine
  -> SQL Rewriter
  -> Output Artifacts
```

输出物：
1. 标准化 SQL
2. 字段血缘关系
3. 字段替换报告
4. 解析告警与失败明细

### 5. 技术选型
- 语言：Python 3.11+
- SQL 解析：`sqlglot`
- 血缘图：`networkx`
- 数据模型：`pydantic` 或 `dataclasses`
- 并发：`concurrent.futures`（CPU/IO 分离）

选型理由：
- `sqlglot` 支持多方言、AST 可遍历、可回写 SQL
- `networkx` 便于链路追踪与可视化扩展

### 6. 模块设计
#### 6.1 SQL 解析模块（parser/sql_parser.py）
职责：
- 按 dialect 解析 SQL
- 统一异常封装
- 输出 AST 与语句元信息

接口建议：
```python
parse_sql(sql_text: str, dialect: str) -> exp.Expression
```

#### 6.2 AST 结构解析模块（parser/ast_extractor.py）
职责：
- 提取表名、表别名、字段、字段别名、表达式
- 提供作用域内符号表（table alias -> table name）

接口建议：
```python
extract_select_items(node: exp.Select, scope: Scope) -> list[SelectItem]
extract_table_refs(node: exp.Expression, scope: Scope) -> list[TableRef]
```

#### 6.3 表关系解析模块（lineage/table_lineage.py）
职责：
- 识别 `FROM/JOIN/SUBQUERY/CTE` 关系
- 构建表级依赖图

接口建议：
```python
build_table_graph(root: exp.Expression) -> nx.DiGraph
```

#### 6.4 字段血缘分析模块（lineage/column_lineage.py）
职责：
- 解析每个输出字段的来源字段集合
- 建立边：`source_table.source_col -> target_table.target_col`
- 支持跨 CTE/子查询逐层回溯

核心数据结构：
```python
@dataclass
class ColumnLineage:
    source_table: str
    source_column: str
    target_table: str
    target_column: str
    transform_expr: str | None = None
    confidence: float = 1.0
```

#### 6.5 标准字段映射模块（mapper/column_mapper.py）
职责：
- 加载标准字段字典
- 依据规则执行字段重命名（含同义词、大小写策略）
- 输出替换决策（命中/未命中/冲突）

接口建议：
```python
map_column_name(column: str) -> MappingDecision
```

#### 6.6 SQL 重写模块（rewriter/sql_rewriter.py）
职责：
- 在 AST 上替换字段标识符
- 保持语义等价并尽量保持可读性
- 输出重写 SQL

接口建议：
```python
rewrite_sql(root: exp.Expression, mapping: dict[str, str]) -> str
```

### 7. 复杂 SQL 场景处理策略
1. JOIN
- 构建别名到物理表映射（`a -> t1`, `b -> t2`）
- 字段 `a.col`、`b.col` 分别归属

2. 聚合函数
- `SUM(amt) AS total_amt` 记录 `amt -> total_amt`

3. CASE WHEN
- 提取所有分支引用列，汇总为来源集合

4. 窗口函数
- 识别函数参数列 + `PARTITION BY/ORDER BY` 引用列

5. CTE
- 将 CTE 视作临时逻辑表
- 维护 `base_table -> cte -> downstream` 传递链

6. 子查询
- 递归下钻解析，返回投影列来源

### 8. 数据结构设计
```python
@dataclass
class TableRef:
    table_name: str
    alias: str | None

@dataclass
class ColumnRef:
    table_alias: str | None
    column_name: str
    alias: str | None
    expr_sql: str | None = None

@dataclass
class RewriteRecord:
    old_column: str
    new_column: str
    sql_file: str
    reason: str
```

### 9. 处理流程
1. 读取 SQL（单条或批量）
2. 解析 AST
3. 提取表关系与作用域
4. 提取字段表达式与别名映射
5. 构建字段血缘图
6. 应用标准字段字典
7. 重写 SQL
8. 输出结果与报告

### 10. 输出设计
#### 10.1 标准化 SQL
- 文件：`output/sql/<name>.sql`

#### 10.2 字段血缘关系
- 文件：`output/lineage/<name>.json`
- 示例：
```json
[
  {
    "source_table": "A",
    "source_column": "C",
    "target_table": "B",
    "target_column": "D"
  },
  {
    "source_table": "B",
    "source_column": "D",
    "target_table": "C",
    "target_column": "E"
  }
]
```

#### 10.3 字段替换报告
- 文件：`output/report/rewrite_report.csv`
- 字段：`old_column,new_column,sql_file,reason`

### 11. 性能设计
- 处理规模：1000+ SQL 文件
- 并发策略：
  - 文件级并发解析
  - 单 SQL 内部串行（保证上下文一致性）
- 缓存策略：
  - 标准字段字典缓存
  - 方言解析器配置缓存
- 失败隔离：
  - 单文件失败不影响批任务
  - 输出失败清单与错误堆栈摘要

### 12. 质量保障与测试
#### 12.1 测试层次
- 单元测试：字段提取、别名解析、表达式来源
- 集成测试：多 CTE + JOIN + CASE 综合 SQL
- 回归测试：历史样例 SQL 基线对比

#### 12.2 验收指标
- 解析成功率 >= 95%（样例库）
- 字段替换准确率 >= 98%（人工标注集）
- 批处理吞吐：1000 SQL <= 10 分钟（8 核基线）

### 13. 风险与应对
1. 多方言差异导致 AST 不一致
- 应对：分 dialect 适配层，新增方言回归集

2. `SELECT *` 无法精确字段血缘
- 应对：接入元数据（可选）或降级告警

3. 字段同名冲突
- 应对：优先使用表别名限定，冲突时输出人工确认项

4. 动态 SQL（拼接）难解析
- 应对：预处理模板变量，无法解析时标记跳过

### 14. 目录结构建议
```
sql_lineage_tool/
├─ parser/
│  ├─ sql_parser.py
│  └─ ast_extractor.py
├─ lineage/
│  ├─ table_lineage.py
│  └─ column_lineage.py
├─ mapper/
│  └─ column_mapper.py
├─ rewriter/
│  └─ sql_rewriter.py
├─ models/
│  └─ schema.py
├─ tests/
│  ├─ unit/
│  └─ integration/
└─ main.py
```

### 15. 迭代里程碑
1. M1（1 周）
- 完成 parser + 基础字段提取 + 单表重写

2. M2（1-2 周）
- 完成 JOIN/CTE/子查询字段血缘

3. M3（1 周）
- 完成批处理、报告导出、错误隔离

4. M4（1 周）
- 回归测试、性能压测、上线文档

### 16. 与当前仓库（sql_rewriter）对齐建议
当前仓库已具备基础 `SELECT ... FROM ...` 字段解析能力，可作为原型层；建议新增 Python 引擎目录用于生产级血缘能力，前端页面保留为演示与验收入口。

