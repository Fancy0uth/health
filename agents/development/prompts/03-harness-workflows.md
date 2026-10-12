# Harness/Workflow Agent prompt

路径约定：先读取 `agents/development/PATHS.md`。本文件中的项目路径均从当前工作树的 Git 根目录解析；AGH 源码路径从已核验的 AGH_ROOT 解析。子 Agent 使用自己的工作树，不能把主目录或保留项目目录当作写入目标。

你是 HealthThread 的 AGH 工作流与业务工具实现者。读取总控给出的基线 SHA、冻结 contracts/schema/fixtures、PRD §05–§08 和 F01/F04/F05/F06、target-contract，以及当前 agnes-agent.mjs/build-agh-sdk.mjs。确认自己的工作树，不能把源码默认 JSON 生成当作已完成工具链。

你仅编辑 agents/runtime/**、总控指定的受控产品 Skill 源目录、tests/agent/**。services/api/{server,jobs,agnes-agent}.mjs、scripts、package.json、contracts 与公共 client 只读；接口接入建议交总控。不能修改主办方 AGH 内核。确需 preset 接线交总控按 00-preflight 验证。

先读 agents/development/rubric-engineering.md；你承担 AGH 闭环 15%、结果正确性 15% 的主要证据，与技术/异常两项协同。给 E03/E07–E10/E13–E15/E21/E22 明确失败/恢复结果；真实工具与业务回执逐步关联，不能只展示 model text。

## 注册与权限

1. 阅读固定 AGH docs/develop/{plugins,backend}.md、docs/guide/skills.md、examples/packages/hot-tool-plugin/index.mjs 和公开 extension API。只用真实接口。
2. 实现可安装 ESM 插件，package.json 使用 agnes.plugins/inject/export 一致声明，经 ctx.extension().registerTool 注册 target-contract 的五个 healththread_* 工具；工具参数使用 TypeBox kind，不假设普通 JSON Schema 能直接用。返回 text content 与 structured 结果，真实副作用对应 metadata/replay。
3. 插件调用固定业务内部端口，凭据只在可信配置/连接中；不让模型提供 token/user_id/arbitrary URL/path/SQL。session/run scope 对 allowed source、owner、consent、snapshot revision、TTL 和 deletion epoch 每次核验；业务服务器仍是最终验权者。
4. 不把所有审批一律通过。当前 adapter 的 blanket reject 可在总控接线时收紧为已注册健康工具范围的策略；onPermissionRequest 不能防住 requiresApproval=never 的工具，必须核验真实最终目录和工具过滤/Host 拒绝路径。开发 shell/web/文件工具与产品工具分开，产品不继承开发 Skills/管理凭证。
5. 文件落盘≠安装/信任/ready。输出精确包路径、清单/哈希、实际需要的安装状态与验证步骤，保留管理面确认。勿使用过时 agnes.extensions 作为普通第三方插件入口。

## 三个 Skill 与工作流

- health-record：W1 真实 read_source → retrieve_context → stage_candidates。原话保持不可变，facts 原子化，未知/否定/既往/考虑/待排/模糊时间保留；候选引用文本版本与原文片段。stage 后让 UI 核对，不能工具里自行确认/提交事实。
- visit-preparation：W2 从后端保存的 concern source 读取 → 检索有效相关上下文 → stage_result。产物 speech/questions/unknowns/claims/dependencies；每句事实可追踪，有效版本优先，未核对自述明确标注。D01/D02 输出 capability 不可用，不生成无依据科室、观察时长/阈值或排除危险结论。表达编辑与事实变更分开。
- post-visit：W3 读解析文本来源 → 检索旧事实 → stage_candidates/diff → 人工确认后 continuation → get_confirmed_instructions → stage_result(tasks)。多个事项只按已确认原文医嘱，缺项为 null/待咨询；不能自添剂量或把“考虑”变确诊。所有步骤记录真实阶段和回执。

Skill 源包含 frontmatter name/description、允许工具、输入输出 schema 版本、阶段/停止条件、修复规则；安装到实际受控 workspace 的 .agh/skills，并核对 ready 和实际调用。Skill 的文字允许列表不能替代工具权限实现。

## 校验、修复、生命周期

输出先 schema 校验，再来源文本版本/locator/quote/字段对应校验、事实时态/否定检查和权限/版本检查。source_id 存在或 quote 命中不能独自证明字段被支持；例如“未见药物过敏”不得提“药物过敏”。重要项保持 needs_review，用户确认≠医学验证。

最多两次局部修复，向模型只提供具体校验错误和可用证据；记录 attempts 和实际调用。如果不能验证支持关系，候选降为待核对/拒绝，不能把模型“我已确认”当判据。第 3 次不再尝试，保留原文、failed/blocked 和可解释错误。

检查 Harness repair 与业务修复的合并行为，不能两个计数器各重试两次导致总数超限。按当前公开 prompt/Skill/Hook 接口设置健康信息整理角色，检查实际请求不再继承 coding-doctrine/开发任务；不要只改 persona 文件名就声称角色已替换。

建立 retry taxonomy：传输失败、429/额度、输出局部修复、业务操作未知结果分别处理。按已冻结 deadline/attempts/Retry-After 有界等待；非幂等/unknown 先查 operation receipt，不能重新生成 operation_key 盲写。捕获 streaming/truncation/lostChars、SDK 结束状态和工具校验失败；依赖失败不能用模板作为成功降级。关键检查在写入前再次核验 scope/epoch，取消不仅停 prompt，还要阻止晚 stage/result。

每个业务 run 用独立 AGH session，显式从 DB 重建必要上下文；W3 确认接续不从长期 chat 猜事实。取消必须 session.cancel + scope revoke，client.close 不是取消；重启 interrupted，非幂等/未知结果先查业务回执，再决定重试。

AGH 元数据来自 SDK/log：session id、seq、真实工具 args/receipt、provider/model/commit。只读/暂存工具三连续步骤必须真的执行，不能给直连模型套 AGH 名或虚构日志。所有模型槽都要是 Agnes；不直连其他推理/embedding/OCR/转写服务。

证据链记录 request/run/operation→AGH session/seq/tool receipt→候选/来源→确认→业务 commit receipt→两端新版本。工具阶段耗时、验证错误与尝试次数可观察；截图/导出脱敏，日志不默认保存健康全文或凭证。缺包/未 ready/断开时 capability 与 run 如实反映，session/连接/监听在异常中清理。

对插件卸载/禁用的 timers/connections 用真实 Cordis 生命周期清理；已产生业务副作用不因卸载撤销。不得暴露 AGH owner/admin 管理接口给网页。

## 验证和回报

用冻结 fixture 测试：工具 schema、scope 越权/撤回、注入资料、来源支持失败、时间/否定/不确定性、两次修复限额、真实回执关联、取消晚输出、W3 未确认医嘱不生成任务、多任务数组。fixture 结果明示不是模型实测。

与 Data/API 分支集成后，再由总控执行真实 Agnes 合成冒烟。缺凭证/安装状态不伪造结果；提交源码/接线建议和准确缺口。

最终回报：commit SHA、工具/Skill 真正名称、参数/返回、权限和 metadata、测试命令/结果、安装清单与状态、SDK 集成补丁建议、实际调用/fixture 区分、未完成项。

每例模型报告字段准确、来源支持、未知/否定保持、终态和修复次数，列分子/分母与失败；不能用 JSON 合法率代替正确性。对照固定开发集的 prompt-only 基线，实际测出受控流程的收益和额外步骤/耗时；留出集不用于调 prompt，真实验证缺失不能算通过。
