# 工程决策

- 延续原生双前端 + 一个 Node24/SQLite 服务，以领域 API 为共享真相；不为比赛评分增设框架/微服务。
- 用户选择当前 feature 分支开发并删除桌面副本；当前实现者顺序写，审查只读；不创建另一份供 Agnes 编码的副本。
- 登录先完成显式 opt-in 的本地合成账号方案。正式互联网身份系统不是本次已验收范围，服务默认仅本机绑定；凭据/授权不进入产品模型提示词。
- 原文与源版本不可改；确定性验证采用 extractive evidence +否定/时间/不确定标记约束，任意医学语义需要人工核对，不能声称程序已证明。
- D01/D02 缺批准依据，capability门控；OCR/音频延期且显式不可用。
- 输出局部修复最多2次；网络重试/事务幂等/人工核对接续分开计算。
- 真AGH工具/模型调用在独立受控runtime，fixture只用于工程测试，报告分开。
- 原PDF可用SQLite BLOB原子接收，工程限额及解析隔离由Task1实测并记录；不是无限文件服务。
- 手动重试新增 POST /api/runs/:id/retry：只允许 failed/blocked/interrupted，新 run 引用原有来源并重新核验当前授权/epoch，保留原运行历史；已暂存核对检查点继续核对，不静默重放。
- 实际 AGH 工具权限不用未消费的 tools.core 预设字段作保证；采用独立产品运行组合，启动/请求目录核验与 fail-closed hooks。具体公开 API 和源码证据见 agh-runtime-audit.md。
- 稀疏核对遇到旧版本：明确拒绝旧候选，或 CAS 创建引用原文的新分析 run；旧候选过期、旧 scope 撤销。确认本身仍拒绝旧版，不做静默合并。
- 产品 AGH 使用公开进程内 Host→createLocalEndpoint→SDK 路径，独立产品存储和 explicit Skill registry；不需要修改全局开发 daemon 或扫描个人 Skills。
- 为通过 AGH 官方 PackageManager 的许可证信任门槛，独立 runtime 插件采用实际 MIT 示例脚手架并保留出处；MIT 仅覆盖新插件包，不改变仓库其他代码或用户资料的许可证。当前只本地使用，无公开发布。
- 按用户选定的最多两位实现 Agent 并行设置，以文件归属隔离 AGH 运行层和前端工作；领域接口先独立审查，跨层写入须协调，所有审查门槛保留。
- 新增仅当前用户可读的有界运行/文档目录，使其他设备或新登录会话能找回已保存的核对及失败运行；不依赖浏览器本地日志才有恢复入口。
- 原文工具提供有界、确定性的 sentence_spans，帮助模型复制原始 UTF-16 定位；原文、页码和权限不变。有效暂存后若 Core 仍 blocked，最多一次无业务工具的结束提示，计入同一个两次修复预算并保留原终止原因。
- 删除竞态实测：旧 HTTP 输入延迟到全部删除后才到达，可重新存入资料。因此业务写请求必需携带 X-HealthThread-Epoch，事务内核验版本，异步 PDF 提取后也重查。这个头只用于版本冲突检查，身份仍来自会话。
- all_clear_epoch 仅在全部删除时递增，供其他设备清理所有本地健康草稿；单来源删除/撤回授权只使相应操作失效，保留无关草稿。匹配的已提交幂等回执先于版本冲突判断，支持删除响应丢失后的原回执恢复；未知旧写入不得自动换新版本重发。

## Task 5 final integration decisions

- **Literal time is a finite source annotation, never a calendar inference.** `read_source` retains exact `sentence_spans` evidence and adds a separate parallel `sentence_annotations` array. Supported strong cues are 每日/每天/每周/每月, numeric Chinese before/after offsets (天/日/周/月/个月/小时), English daily/weekly/monthly/every day/week/month, after/before/in + numeric or one–ten + day/week/month/hour, and last/next + weekday/week/month/year. Adjacent 大约/约/至少/最多/about/approximately/at least/at most and 左右/以内/之前/之后 are retained. Multiple recognized cues use their enclosing continuous source substring, including intervening words. Relative/frequency cues require non-null raw, relative precision and null endpoints.
- Recognized date surface forms are YYYY-MM-DD, YYYY/M/D and YYYY年M月D日 (one- or two-digit month/day). Malformed, qualified, non-normalized, mixed or multiple date cues remain literal raw with unknown precision and null endpoints. A lone valid ISO YYYY-MM-DD may instead use exact precision with that literal start and null end. No clinical threshold, inferred date, frequency or locale conversion is introduced. Past/current markers are separate: weak markers alone may retain literal raw or null; unknown parser output does not establish absence of time in the source. Both client shells say to inspect the original sentence when no explicit time is recognized.
- Stage and current confirmation validate model proposals unchanged. Manual corrections use the same marker/time classifier but always remain user-authored `reported_text`. Old pending proposals that omit supported time fail confirmation atomically; explicit reanalysis uses the saved source. Duplicate proposals for an identical source/version/location/value are rejected across fields; distinct repeated locations remain distinct.
- **Care validity follows exact dependencies.** Unrelated profile confirmation keeps existing care results/tasks current when all referenced instruction revisions and source versions remain valid. W2 cards still become stale on any profile fact confirmation. Corrections/retractions/deletions invalidate or withdraw dependent care; stale text/status is never revived. This avoids duplicate document upload or confirmation and adds no regeneration API. The tradeoff is conservative staleness if a care result carries extra dependencies; there is no automatic restoration of genuinely changed instructions.
- Cancelling a run expires its pending review with a terminal reason. Consent/owner epoch changes expire every pending review, including run-null user corrections, in the same transaction. Original sources/history remain unless explicitly deleted. No cancelled run is silently reopened.
- Deletion computes artifact dependencies before removing rows, clears indirect result/review references and marks a surviving independent concern run `cancelled / result_withdrawn`. Its saved concern remains readable, but the erased generated content is unavailable. There is deliberately no implicit regeneration; users may start a new visit preparation using the surviving source. Single/list/poll/export projections no longer refer to the erased result/review.
- All dispatch creation uses one global/per-owner admission gate, including confirmation continuations. Full queues return 429; fact changes, facts, audit, operations, receipts and derived validity roll back together. The same key/body may succeed once capacity is free. No unbounded deferred queue is created.
