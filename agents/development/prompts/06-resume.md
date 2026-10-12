# 阶段续跑与恢复 prompt

路径约定：先读取 `agents/development/PATHS.md`。本文件中的项目路径均从当前工作树的 Git 根目录解析；AGH 源码路径从已核验的 AGH_ROOT 解析。子 Agent 使用自己的工作树，不能把主目录或保留项目目录当作写入目标。

在同一个 AGH 开发会话继续 HealthThread 后端实施。先读 agents/development/prompts/01-master.md、docs/backend/{plan,decisions,requirements-matrix,verification}.md，核对当前 git status/HEAD 和实际测试记录；不要根据上轮口头“完成”跳过验收，也不要重建已完成模块。

采用 v0.2 评分导向要求：读取 agents/development/rubric-engineering.md、fault-matrix、invariants、score-evidence，优先修复阻断不变量的失败，再继续新能力；原来的“只有 happy path 通过”不构成完成证据。按 agents/development/prompts/07-reliability-tests.md 补独立故障/恢复测试，M2/M4/M6 复核，仍最多两个子任务。

从以下第一个尚未有证据通过的阶段继续：M0 契约 → M1 数据/受限工具 → M2 W1 → M3 W2 → M4 W3 → M5 双端/治理 → M6 独立验收/真实 Agnes。

总控同时最多两名子 Agent，使用实际 childKey collect 终态；遗留工作树先读 diff/log 再集成，不能误删。若预算/重启中断，业务 run 用回执恢复策略；开发会话恢复不等于产品任务可盲重放。

本轮先给简洁状态：已有可运行闭环、证据、下一项依赖、预计修改文件。随后继续写代码/测试/修复。缺凭证、插件信任、D01/D02 审阅时继续独立工程部分；阻塞项准确标记 pending/not_run，不填假输出或让模型替人确认。

如果你之前只给了方案或 TODO，这一轮按授权完成对应实现。每个阶段提交并更新 runbook/需求矩阵；不要反复改成新框架，不因 API 调用 202 就宣布业务完成。
