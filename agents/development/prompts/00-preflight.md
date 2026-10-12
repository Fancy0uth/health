# AGH 环境与多 Agent 预检 prompt

路径约定：先读取 `agents/development/PATHS.md`。本文件中的项目路径均从当前工作树的 Git 根目录解析；AGH 源码路径从已核验的 AGH_ROOT 解析。子 Agent 使用自己的工作树，不能把主目录或保留项目目录当作写入目标。

你负责为 HealthThread 后端开发准备可核验的 Agnes Harness 环境。先完成预检与必要的配置接线，再交给 agents/development/prompts/01-master.md。此任务不会授权你发布代码、修改真实健康资料或绕过插件信任流程。

## 已知环境与输入

- 本次项目是当前工作目录的 HealthThread 仓库。先核对 package.json、git status、git remote，不能根据文件夹名猜仓库。
- 阅读 agents/harness.lock.json、README.md、agents/development/README.md、两份 agents/development/presets/*.json。
- 阅读 agents/development/rubric-engineering.md（用户提供评分权重，项目工程门槛），核对测试/故障注入、浏览器操作与真 AGH 轨迹导出的可用能力；不把环境就绪当工作流已通过。
- 找到 AGH_ROOT 的实际源码目录；核对其 HEAD 与 lock.commit。若有本地变更，列出，不能隐瞒或覆盖。
- 以下均是 AGH_ROOT 内的相对路径，不在 HealthThread 根目录解析：AGENTS.md、docs/reference/configuration.md、docs/reference/cli.md、docs/guide/install.md，以及下列源码：
  packages/code/src/presets/load.ts、packages/code/presets/standard.yaml、packages/base/src/ecosystem.ts、packages/base/extensions/subagent/src/tools.ts、packages/core/src/child/factory.ts。
- 上述路径来自固定版本。若不存在，先根据当前版本查证，不编造替代 API。

## 依次执行

1. 记录 Node 版本、AGH 版本、profile、实际连接目标、工具可用性。执行当前版本真实支持的只读 doctor/profile inspect；doctor subagents 仅列举子任务维护状态，不证明工具注册成功。不要自动调用 --repair。
2. 在实际会话工具目录查找 subagent_spawn、subagent_collect、subagent_cancel，说明它们是否能用。默认 index.ts 的空入口不能单独证明功能缺失；检查 Host 的 ecosystem 装配路径。工具的真实字段只有 task、model、isolation、budget，collect 用 childKey、wait。
3. 核对 Agnes 模型目录和配置的 route。所有 primary/escalation/fast/compaction/verifier 槽必须解析到允许的 Agnes 模型。route 可能为 account-...，不能硬编码为 provider 名。不要输出 API key、secret 引用的内容或完整环境变量。
4. 立即可用方案：使用内置 standard，主 prompt 控制同时最多两个子任务；说明 standard 默认 max_fan_out=4，此时“最多两个”只是调度约束。不要声称硬限制已经变成 2。
5. 如需要硬限制，加载 healththread-dev 的目标 preset。当前固定源码的 @agnes/code 只导出 PRESET_NAMES 中的 recipe，项目中放 JSON 或 .agh/presets 文件不会自动注册。先检查当前版本是否已有公开的自定义 preset 装载方式，有则按该方式接入并验证；没有时，在团队自己的 AGH checkout/分支中做最小 recipe 注册修改：
   - 将 healththread-dev.json 与 healththread-runtime.json 转为相应的 packages/code/presets/<name>.yaml；保留语义，不修改 minimal-rl 及其哈希。
   - 在 packages/code/src/presets/load.ts 的 PRESET_NAMES 登记两者，使 @agnes/code 的 presets 导出包含新 recipe。
   - 核对 packages/code/test/presets.test.ts 等枚举/文档检查，更新必要测试；不要删掉断言让测试通过。
   - 读取当前构建文档，重新构建 CLI。将变更提交在团队自己的 fork/分支，保存 commit 和补丁说明；不能给主办方上游推送。
   - 重新核验 SDK 接口后更新 HealthThread 的 agents/harness.lock.json。不能通过放宽 build-agh-sdk.mjs 的版本检查解决不匹配，也不能仅记录原始 HEAD 来掩盖已修改源码。
   - 在实际 AGH_HOME/profiles/local-dev/profile.yaml 的 profile 层合并 presets.default 和 presets.allowed；它只负责选择，不承载 preset 定义。不要覆盖账户配置或手改 configuration.json。
   - 开发实例 default 为 healththread-dev，产品实例 default 为 healththread-runtime。使用两个不同的绝对 AGH_HOME；核对实例连接目标，不能假定改 cwd 就切换 daemon。
6. 对目标 preset 运行 AGH 的真实 schema 验证、继承解析和实际会话检查。JSON 合法不等于已装配，已装配不等于权限已隔离。列出可用工具及各槽路由，验证子任务不能再派生，第三个并行子任务被限制。优先用 fixture 验证，不为测试并发上限反复付费调用模型。
7. worktree 从已提交 HEAD 建立，不会带上未提交 contracts/prompt；总控分派之前要提交任务所需基线。检查返回 details.isolation/worktreeSkipped，实际退回 shared 时不得两个写代码 Agent 并发。保留工作树，collect 不自动合并代码。
8. 费用参数按实际 credits 设置；budget 不是 tokens 或人民币。schema 中 tree_budget_credits 和 per_request_cap 的单位也要核实。两份模板没有替用户决定 credits 数值，不能据此声称费用已被控制。步数 36/12、超时与输出长度是起始建议，应回写 D09；达到限制就保存进度、明确失败/中断，再续跑。
9. 业务运行工具插件还未实现；预检时不宣称 healththread-runtime 已能跑 W1–W3。tools.core=[] 只去除核心工具，不是所有扩展的全局白名单。后续要检查最终目录、拒绝未经允许的通用工具、隔离开发 Skills，并用拒绝路径测试证明。保留审批，不设置 approvals.mode=off。

## 输出交接

保存 docs/backend/preflight.md，包含：实际版本、已运行命令及结果、模型槽的 provider/route/model、选择的 preset 及是否真正生效、子任务工具状态、worktree 状态、待完成安装/信任/凭证事项、费用限制、恢复命令。

另记录故障验证可用的独立 DB/端口/进程测试环境与浏览器能力。日志导出做脱敏，测试不用真实病历；列环境失败/版本不符/插件未 ready 的 readiness 与错误行为。没有浏览器时标 UI manual_only/not_run，不能把源码读取或 HTTP 验证写成已看过两端页面。

若配置加载需要管理权限或插件信任，先完成可审阅的文件/补丁和校验，再说明具体需授权的对象与哈希。缺少模型凭证时继续完成代码和 fixture 接线，标记 real_model=not_run，不伪造实际调用。

没有可用 subagent 工具时，用同一主会话顺序执行 02→03→04→05 的职责；保持同一交付与验收标准，不增加第二套调度框架。
