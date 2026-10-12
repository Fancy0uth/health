# 当前实施进度

2026-10-12。用户授权在当前 feature 分支开发并待独立验收。本页记录实际接口，不代表 AGH 真模型或双端最终验收已通过。

## 领域接口已实现，待独立复核

- `services/api/domain-store.mjs`：Node SQLite；scrypt 账号、服务端 session；按 owner 的 source/entry/document/pending episode；证据候选与确认事务；append-only fact revisions；版本授权与 epoch；幂等回执；原始 PDF BLOB；导出和 partial 删除回执。
- `domain-jobs.mjs`：持久化 dispatch、有限并发、包含 readiness 的 deadline、重启 interrupted、取消与迟到 scope 拒绝、手动 retry 新 run。缺失模型先保原文再 blocked。checkpoint 后 SDK 失败保留结果及 execution_error。
- `domain-server.mjs` 的 `createApp({root,dbPath,agent,demoAccounts,limits})` 返回 `{server,store,jobs,listen,close}`。默认未配置账号；正式服务没有匿名 state writer。`server.mjs` 只保留 constructor compatibility。
- `contracts/README.md`、`contracts/openapi.yaml`、`contracts/schemas/` 已冻结 HTTP、5 个 bound tools、候选/结果参数、限额和恢复语义。`agent.run({run,scope,tools,signal})` 必须调用工具落真实业务回执。真实 metadata 使用 `provider:'agnes-ai'` 和 ordered `tool_receipt_ids`，真实性仍由可信 SDK adapter 负责。
- W3 确认返回 `continuation_run_id`；W2/事项 dependency 在确认变更后保守标 stale。source-only W2 claim 必须由两端标为未核对自述/文档；speech 只能来自逐条摘录。
- 默认新库 `.runtime/healththread-domain.sqlite`；历史匿名原型库 `.runtime/healththread.sqlite` 不导入，不在当前账号资料删除范围内。未修改用户现有 4173 原型进程。

## 验证记录

当前任务的 TDD 包括先失败后实现的 owner 隔离、确认审计故障回滚、幂等/冲突、旧版本确认、重启、撤回/取消/删除晚回调、原文保留、scope/session TTL、队列限额/截止时间、模型 readiness 挂起、PDF 文本/损坏/无文本/超限、证据语义、手动重试。

最终完整检查：`npm test` 53 个测试、52 passed、0 failed、1 SDK build 测试按现有 opt-in 规则 skipped；`npm run check` 31 JavaScript modules passed。后续最终结果见 `.superpowers/sdd/plan/task-1-report.md`。真实 AGH session/tool 追踪、两端正式交互迁移及独立故障测试由后续任务完成。

边界：证据支持是保守整句摘录与有限语言 marker，不能自动证明全部医学语义；Poppler 是本机外部依赖；远程 AGH 痕迹/外部备份及 SQLite 底层残留不可认证抹除，删除始终 partial；SQLite 实验性 API 警告保留。严格 JSON schemas 加运行时业务校验，但当前并非通用 JSON Schema 引擎。
