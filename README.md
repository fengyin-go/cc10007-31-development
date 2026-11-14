# 数据分层建模工作台

离线版数仓分层建模工具，覆盖贴源层、明细层、汇总层、应用层的表结构设计、分区策略配置、质量规则编排与血缘关系管理，数据持久化到浏览器本地存储。

这是一个**纯前端**管理平台：Vue 3 + Vite + TypeScript，仓库里没有后端服务。业务数据由
`frontend/src/data/` 下的本地数据层提供：首次打开用示例数据播种，之后的登记、筛选与状态流转
结果都持久化在浏览器 `localStorage` 里，刷新或重开浏览器都还在。dev server 已关掉自动打开页面，
启动后按终端打印的地址手工打开。

## 目录结构

```text
.
├── frontend/                 Vue 3 + Vite + TypeScript 前端（唯一运行单元）
│   ├── src/views/            每个业务模块一个页面
│   ├── src/api/local-service.ts   本地数据服务：列表、筛选、动作流转、导出
│   ├── src/data/             模块元数据 / 示例数据 / localStorage 持久化
│   ├── src/stores/           会话与筛选状态
│   └── vite.config.ts        dev server 配置（open: false，无 /api 代理）
├── .gitignore
└── docker-compose.yml
```

## 启动

```bash
cd frontend
npm install
npm run dev
```

前端默认监听 `http://127.0.0.1:5173/`，dev server 不会自动打开浏览器，需要自己访问。

生产构建：

```bash
cd frontend
npm run build
```

## 业务模块

| 模块 | 目录 | 业务对象 | 主要字段 |
| --- | --- | --- | --- |
| 贴源层建模 | `ods` | 贴源表 | 表编号、源表名称、目标表名 |
| 明细层建模 | `dwd` | 明细表 | 表编号、业务域、明细表名 |
| 汇总层建模 | `dws` | 汇总表 | 表编号、汇总主题、聚合维度 |
| 应用层发布 | `ads` | 应用数据集 | 数据集编号、业务应用、输出表名 |
| 数据源管理 | `source` | 数据源连接 | 连接编号、连接类型、接入地址 |
| 分区策略 | `partition` | 分区方案 | 方案编号、目标表名、分区字段 |
| 清洗加工 | `cleanse` | 清洗规则 | 规则编号、输入表名、目标表名 |
| 转换编排 | `transform` | 转换节点 | 节点编号、输入表名、输出表名 |
| 质量校验 | `quality` | 质量规则 | 规则编号、校验表名、目标字段 |
| 血缘追踪 | `lineage` | 血缘关系 | 关系编号、上游表名、下游表名 |
| 历史补数 | `backfill` | 补数任务 | 任务编号、目标表名、开始日期 |
| 元数据管理 | `schema` | 字段定义 | 字段编号、所属表名、字段名称 |
| 数据同步 | `datasync` | 同步链路 | 链路编号、源端连接、目标端连接 |
| 快照管理 | `snapshot` | 快照策略 | 策略编号、目标表名、快照周期 |
| 存储治理 | `govern` | 治理策略 | 策略编号、目标表名、治理类型 |
| 任务监控 | `monitor` | 监控配置 / 告警事件 / 影响证据 / 故障回执 | 配置编号、关联对象、监控指标、阈值与裁定优先级 |
| 变更审计 | `audit` | 审计记录 | 记录编号、操作表名、变更类型 |
| 编目检索 | `catalog` | 编目条目 | 条目编号、数据集名称、所属分层 |

## 任务监控领域模块

`frontend/src/views/monitor/` 不使用通用 CRUD 表格，而是自带一套可验证的领域实现，数据持久化在
`localStorage` 的 `data-layer-studio:monitor-domain` 键下：

- `domain/types.ts`：监控配置、采样点、补数区间、告警事件、影响证据、故障回执与时间轴模型。
- `domain/engine.ts`：纯函数判定引擎，口径包括
  - 输入身份 `targetRef|metric|eventTime`：补数重叠区间的重复采样只认定首次到达，其余标重复、不参评；
  - 连续缺测（预期槽位无被认定输入，达阈值告警）、迟到事件（到达晚于预期）、真实越界（值超出阈值闭区间）三者分开判定；
  - 告警一经发出即锁定，迟到数据只能追加迟到事件，不能抹去或回改已发告警；
  - 连续 `recoverLimit` 次正常采样才恢复，恢复后再次异常生成新的事件编号；
  - 同任务多配置阈值冲突时按 `priority` 数字小者优先裁定，非权威配置的告警标注「已覆盖」并保留留痕。
- `domain/store.ts`：本地仓储。确认告警只追加影响证据（含受影响输入身份与失败续做建议），
  同步链路 / 补数任务失败续做可按关联对象读取；回看核对以监控配置为主对象逐项核对。
- `components/`：配置与裁定面板、统一时间轴（采样/告警/恢复/补数区间同轴）、告警总览、
  影响证据、故障回执（点不动 / 丢失 / 重复显示 / 对不上逐项写明处理结果）、回看核对与确认弹层。

监控模块的验证（无需浏览器、不依赖测试框架）：

```bash
cd frontend
npm run test:monitor
# 依次执行：8 个 SFC 编译冒烟 + 10 项引擎判定验证 + 9 项仓储集成验证
```

## 约定

- 除任务监控外，每个模块的页面在 `frontend/src/views/<模块>/index.vue`，页面只负责渲染，读写统一走
  `frontend/src/api/local-service.ts`；任务监控的读写走其专属的 `views/monitor/domain/store.ts`。
- 字段、状态、动作与流转目标集中在 `frontend/src/data/modules.ts`；示例数据在
  `frontend/src/data/seed.ts`。
- 状态流转只允许在 `local-service.ts` 里改，页面组件不做业务判断。
- 想回到初始数据：清掉浏览器里 `data-layer-studio:entries` 这一项，或调用 `resetModule(模块)`；
  任务监控在页面上点「重置演示数据」，或清掉 `data-layer-studio:monitor-domain`。

领域：数据工程
子方向：数仓与数据湖
