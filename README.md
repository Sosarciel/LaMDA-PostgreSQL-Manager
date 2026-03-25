# PostgreSQL-Manager

PostgreSQL 数据库管理器，为 LaMDA 提供数据持久化与缓存协调能力。

---

## 📋 实施计划

- [[plan/README|查看所有计划]]

---

## 功能概述

- **连接池管理**：基于 pg 的连接池，支持连接复用与超时控制
- **自动备份**：定时备份机制，支持备份数量限制与间隔配置
- **缓存协调**：CacheCoordinator 提供数据变更通知机制
- **Mock 支持**：内置 Mock 工具用于测试环境

## 目录结构

```
src/
├── Manager.ts        # 数据库管理器核心
├── Client.ts         # PostgreSQL 客户端封装
├── CacheCoordinator.ts  # 缓存协调器
├── JsonDataStruct.ts   # JSON 数据结构定义
├── UtilDB.ts         # 数据库工具函数
└── Mock/             # 测试 Mock 工具
```

---

*最后更新: 2026-03-25*
