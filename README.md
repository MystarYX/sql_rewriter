# sql_rewriter

SQL 字段映射与血缘分析工具（V2.1）。

## 当前范围（本轮）
- 只做解析：表字段映射 + 字段血缘边输出
- 不做 SQL 重写、不做字段替换

## 已支持能力
- SELECT / FROM / JOIN 解析
- 子查询字段下钻
- UNION / UNION ALL 分支来源合并
- CTE（WITH）解析
- 多语句链路传递（A.C -> B.D -> C.E）
- 聚合/条件/窗口表达式中的字段引用提取

## 输出结构
- 来源表（sourceTable）
- 原始字段（sourceField）
- 映射字段（mappedField，最终输出字段）
- 目标表（targetTable，默认 RESULT_n）
- 注释（comment）

## 运行
1. 浏览器打开 `index.html`
2. 粘贴 SQL
3. 点击“解析”

## 测试
```bash
node --test ./tests/parser.test.js
```

当前回归：13/13 通过（含复杂 SQL 必测样例）。