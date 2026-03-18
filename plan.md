# PostgreSQL-Manager Mock 表初始化工具计划

## 目标
创建一个Mock表初始化工具，用于在测试环境中模拟数据库表的创建、增删查改操作以及缓存绑定功能。

## 参考结构
1. **DBAccesser.ts** - 数据库访问层结构
2. **DBCache.ts** - 缓存管理机制
3. **user_data.sql** - 表结构定义
4. **Mock目录** - 模拟服务的目录结构

## 实现方案

### 1. 目录结构
```
PostgreSQL-Manager/
└── src/
    └── Mock/
        ├── TableInitializer.ts    # 表初始化工具
        ├── MockTableAccesser.ts   # 模拟表访问器
        ├── MockCache.ts           # 模拟缓存
        └── index.ts               # 导出入口
```

### 2. 核心功能

#### 2.1 表初始化工具 (TableInitializer)
- 支持创建表结构
- 支持创建索引
- 支持创建触发器函数
- 支持创建读写函数
- SQL语句在代码内使用client模板字符串方式写入

#### 2.2 模拟表访问器 (MockTableAccesser)
- 实现增删查改方法
- 支持事务处理
- 支持缓存绑定

#### 2.3 模拟缓存 (MockCache)
- 模拟缓存操作
- 支持缓存更新通知
- 支持缓存获取和设置

### 3. 表结构设计
参考user_data.sql，实现一个通用的表结构：
- order_id: BIGSERIAL PRIMARY KEY
- data: JSONB NOT NULL
- 唯一索引：基于data中的特定字段

### 4. 测试计划
在Test目录创建测试文件，测试：
- 表初始化功能
- 增删查改操作
- 缓存绑定功能
- 事务处理

## 技术要点
1. 使用TypeScript实现
2. 遵循项目代码风格规范
3. SQL语句使用模板字符串嵌入代码
4. 模拟真实数据库操作流程
5. 提供完整的测试覆盖