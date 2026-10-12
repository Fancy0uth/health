# 项目路径约定

当前主开发根目录：`/Users/fancyouth123/Documents/ChatGPT/expressforpatient`。
操作前用 `git rev-parse --show-toplevel` 核验；所有 prompt 中的操作路径按 Git 根目录解析，Markdown 链接按文档目录解析。子 Agent 的工作路径由任务 brief 指定，不能从历史副本路径推断。

已有入口：`agents/development/prompts/00-preflight.md` 至 `07-reliability-tests.md`、`agents/development/target-contract.md`、`agents/development/rubric-engineering.md`、`docs/product/PRD-v0.1.md`、`docs/product/AI_Health_Steward_Project_Framework_v0.2.docx`、`apps/web/index.html`、`apps/mobile/index.html`。

AGH_ROOT 是 Harness 源码目录，本机固定版本位于 `/Users/fancyouth123/Documents/Codex/2026-10-06/https-github-com-agnesai-labs-agnes/work/agnes-harness`，先核验 `agents/harness.lock.json`。AGH_HOME 是运行实例配置/凭证/轨迹目录；两者都不是产品仓库。读取外部源码不等于允许修改它；不能把示例占位路径当真实路径。

产品服务默认端口 4173，以启动日志为准；测试使用临时数据库和动态端口。历史 docs/superpowers 和 implementation-progress 是骨架交付记录，当前实施入口是 `docs/backend/plan.md` 与 `docs/backend/progress.md`。桌面隔离副本已经停止使用。
