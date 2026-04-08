---
aliases: [PostgreSQL-Manager 计划索引]
---
# PostgreSQL-Manager 计划索引

> 本文档索引 PostgreSQL-Manager 模块的所有计划文档

---

## 📋 进行中计划
```base
filters:
  and:
    - file.name != "README"
    - file.folder == "LaMDA-Module/Service-Manager/PostgreSQL-Manager/plan"
views:
  - type: table
    name: 计划一览
    order:
      - file.name
      - aliases
      - file.mtime
    sort:
      - property: file.mtime
        direction: DESC

```

---

## 📁 已归档计划
```base
filters:
  and:
    - file.path.startsWith("LaMDA-Module/Service-Manager/PostgreSQL-Manager/plan/archive")
views:
  - type: table
    name: 归档一览
    order:
      - file.name
      - aliases
      - file.mtime
    sort:
      - property: file.mtime
        direction: DESC

```

---

*最后更新: 2026-04-09*
