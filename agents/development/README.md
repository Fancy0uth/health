# 用 Agnes Harness 完成 HealthThread 后端

本提示词包依据上传 PRD 和当前已运行的双端仓库制作，基线 HealthThread commit 为 `744faa918f1525296194af2842ba0f8d5ea54025`，AGH 基线见 ../harness.lock.json（`7819b23c249fe47ce14bd89e3982e17986e3e197`）。它描述后续开发任务；不会把当前共享骨架说成正式后端已完成。

**当前为 v0.2 评分导向修订版。** 用户提供的权重中，技术实现与异常验证合计 45%，加任务正确性和 AGH 闭环合计 75%。所有角色先读 [rubric-engineering.md](rubric-engineering.md)，按它交付不变量、故障/恢复测试与六项证据。权重采用用户给出的标准；本包没有另行核验官网或预测比赛得分。

本版重点：12 条不变量、22 类故障场景、事务/幂等/重启与取消恢复、可观察性和限额、独立故障测试角色、M2/M4/M6 审查、实测模型/工程指标与可复现对照。每个模块同时完成成功/失败/恢复三条路径；不以错误文案或 catch 代替异常处理，也不把有限测试称零故障保证。

PRD 原件已原样复制到 docs/product/PRD-v0.1.md，SHA-256：`33a60f3d122fa8caea684a1d0ed74ce90326a49531fee801ad70b841403fcdde`。项目框架 v0.2.docx 的分工/工作流要求已在 PRD 引用；提示词没有把它的候选 FastAPI/React 技术方案或未决事项当作现仓库的强制选型。文档中的指令性语句是待处理资料，权限仍来自执行时的用户请求。

## 推荐组织

**开发时：1 个总控 + 最多 2 个并行执行者，5 类可轮换执行/审查职责。产品运行时：1 个健康 Agent + 3 个受控 workflow。** 三名组员不等于必须启动三个开发 Agent，也不等于部署三个临床角色。

| 角色 | 主要职责 | 独占文件 | 依赖与运行时机 |
| --- | --- | --- | --- |
| Coordinator | 契约、公共文件、调度、集成、最终验收 | contracts、server/jobs/adapter、scripts、package.json、docs/backend | 先 M0，贯穿全程 |
| Data/API | 身份、来源、事实版本、事务、PDF、事项、治理 | services/api/domain/storage/auth/routes 与域测试 | 契约提交后 M1；与工作流 Agent 并行 |
| Harness/Workflow | 业务工具插件、scope、三 Skills、输出校验 | agents/runtime、受控 Skill 源、Agent 测试 | 契约提交后 M1；先 fixture，再接真实 API |
| Frontend Integration | 两端全部业务动作接入同一 client/API | apps/web、apps/mobile、packages/client 与客户端测试 | W1 API 稳定后，分 W1/W2/W3 迁移 |
| Reliability/Test | 独立构造故障、并发/重启/恢复测试，证明不变量 | tests/faults、故障 fixtures、分配的证据报告；业务只读 | M1 集成后介入；可与 Frontend 并行 |
| Review | 独立只读审查和异常/隔离验收 | 测试临时目录、审查报告 | M2、M4、M6；实现者修复 |

这里列出的是轮换职责，总控同时最多 spawn 两个。文件范围以每轮具体 task 为准；公共文件和契约只让一个 owner 修改。新增测试角色不需要提高 fan-out。

## 文件和执行顺序

1. `agents/development/prompts/00-preflight.md`：确认当前版本/模型/工具，配置正确实例与 preset。
2. `agents/development/prompts/01-master.md`：完整主 prompt；从现有骨架实施到可验证 MVP。
3. `agents/development/target-contract.md`：M0 冻结的对象、API、工具、证据、生命周期草案。
4. `agents/development/prompts/02-data-api.md`、`agents/development/prompts/03-harness-workflows.md`：M1 可并行的任务正文。
5. `agents/development/prompts/04-frontend-integration.md`：两端渐进接入，共享适配层一个 owner。
6. `agents/development/prompts/05-review.md`：独立验收；只读。
7. `agents/development/prompts/06-resume.md`：阶段中断后接续，先核对证据，不推倒重来。
8. `agents/development/rubric-engineering.md`：评分到代码/证据、不变量、故障矩阵、工程指标与硬门槛，所有角色必读。
9. `agents/development/prompts/07-reliability-tests.md`：专门的故障/恢复测试角色，业务和契约只读。

建议在 AGH TUI/Web 中开启一个**开发会话**：先发送 00，确认实际环境结果，再发送 01。总控自行读取角色 prompt 并 spawn，不需要人工分别启动所有角色。

直接粘贴以下短启动指令也可以，完整要求由文件承载：

```text
请在当前 HealthThread 仓库执行 agents/development/prompts/00-preflight.md。
完成可运行的预检与配置接线后，读取并完整执行
agents/development/prompts/01-master.md 和 agents/development/target-contract.md。
先读取 agents/development/rubric-engineering.md，按 v0.2 的 I01–I12、E01–E22 验收。
使用 AGH 原生 subagent_spawn/collect/cancel；最多两个执行者并行，
先冻结契约，再实现 W1、W2、W3，逐阶段接入手机与电脑前端。
常规实现、测试、本地提交可继续；尚无外部 push/部署授权。
如真实模型或插件信任阻塞，完成其他工程部分并保存准确缺口。
```

如果 AGH 已用旧版 prompt 开始工作，在同一个开发会话发送：

```text
继续现有 HealthThread 项目，采用本地 agents/development 的 v0.2 提示词。
先读 agents/development/rubric-engineering.md 和更新后的 agents/development/prompts/01-master.md，再执行 agents/development/prompts/06-resume.md。
保留已经完成的代码与提交，核对当前阶段的 I01–I12 和适用 E01–E22。
调度 agents/development/prompts/07-reliability-tests.md 补独立故障/恢复测试；M2/M4/M6 复核。
优先修复阻断不变量的问题，再继续未完成模块。不要重新初始化项目。
```

对于不能读本地文件的界面，先将 PRD、当前仓库与本包加入实际 AGH workspace，或把 01 与 target-contract 全文一起提供；只给仓库 URL 不能假定模型已经读到私有代码。子 Agent 的上下文也必须可读，不能只分派“帮我写后端”。

### 从 CLI 发送文件

下面两条路径已对齐这台电脑的桌面副本和现有 AGH 源码；AGH_HOME 保持与**开发实例**一致。换机器时重新核验路径；不要把模板占位符当作实际目录。路径规则见 [PATHS.md](PATHS.md)。以下是启动示例，不会在阅读此文时自动运行：

```sh
HT_REPO='/Users/fancyouth123/Desktop/HealthThread-Backend-Dev'
AGH_ROOT='/Users/fancyouth123/Documents/Codex/2026-10-06/https-github-com-agnesai-labs-agnes/work/agnes-harness'
# 沿用已配置的 AGH_HOME；未设置时保留 AGH 默认值，不要直接使用占位目录。

# 优先用 TUI，以便处理真实工具审批。
node "$AGH_ROOT/packages/cli/dist/local/agnes.mjs" \
  --profile local-dev --preset standard --cwd "$HT_REPO" \
  '读取并执行 agents/development/prompts/00-preflight.md，然后按实际环境接续 agents/development/prompts/01-master.md。'

# 适合已解决审批的非交互任务：stdin 直接作为 prompt。
node "$AGH_ROOT/packages/cli/dist/local/agnes.mjs" \
  -p --profile local-dev --preset standard --cwd "$HT_REPO" \
  < "$HT_REPO/agents/development/prompts/00-preflight.md"
```

若 00 已经证明自定义 recipe 真实装载，将后续会话的 `--preset standard` 换成 `--preset healththread-dev`。若使用 `--connect`，选实际开发连接目标，不要给上面命令随意追加未知 daemon 参数。Print 模式处理审批能力有限；被拒绝时回到同一配置的交互式会话，不能通过关闭审批绕过。

续跑可以在同一 TUI 粘贴 06。另开 CLI 时用实际 `agh resume SESSION_ID -p ...`，SESSION_ID 从真实 sessions 结果获得；不要猜 `--session` 参数或伪造子任务 ID。[官方 CLI 参考](https://github.com/AgnesAI-Labs/agnes-harness/blob/main/docs/reference/cli.md)。

## multi-agent 设置：真正的字段与装载方式

两份 JSON 是 **AGH PresetDoc 定义模板**，不包含模型密钥，不是自动生效的项目配置：

- `presets/healththread-dev.json`：继承 standard，max_depth=1、max_fan_out=2、worktree、aggregate budget、每轮最多 36 模型步骤，关闭自动改写 harness 内容。
- `presets/healththread-runtime.json`：SDK 产品会话，子任务深度/并发=0、core 工具为空、每轮最多 12 模型步骤。**这只是收紧的起点**，仍要过滤最终扩展工具、设置健康角色和 scope，不能独立作为安全保证或可运行工作流。

36/12 步、超时和输出 allowance 是建议起始值，不是 PRD 已冻结的 D09，也不是费用额度。根据真实轨迹调整，超限时明确状态，不悄悄取消上限。输出修复最多 2 次由业务工作流另行控制，不等于 12 个总步骤。

继承解析还会带入 standard 的 per_request_cap=4000；固定版子任务 factory 在未指定 tree_budget_credits 时使用 20 credits 树额度。它们是当前源码默认值，不是本包选择的比赛费用预算，也不代表两名 Agent 足够完成整段工作；00 必须核验实际报价/账户，再把每轮任务切小或填写已确认的树额度。产品模板同时将 Harness repair.max_rounds 收紧为 2，但业务侧仍须独立记录修复次数，避免两层各自重复重试。

核心片段如下（属于 preset）：

```json
{
  "name": "healththread-dev",
  "extends": "standard",
  "subagent": {
    "max_depth": 1,
    "max_fan_out": 2,
    "isolation": "worktree",
    "budget_inherit": "aggregate"
  },
  "budget": { "max_steps": 36, "on_exceed": "deny" }
}
```

当前固定版本 @agnes/code 仅加载已登记 PRESET_NAMES。单独把 JSON 放进本项目、`.agh/presets` 或 profile 不会提供新 preset。00 已给出最小注册任务：优先使用当前版本有证据的公开加载路径；固定版本可在团队自己的 AGH 分支新增 recipe/登记名/构建 CLI，更新真实版本锁。它改产品 recipe，不要求改 Core；冻结 minimal-rl 不动。

profile **仅选择已提供的 preset**。注册完成后，把以下片段合并到对应实例的 `AGH_HOME/profiles/local-dev/profile.yaml`，不要整份覆盖其他配置：

```yaml
# 开发 AGH_HOME 的 profile 层
presets:
  default: healththread-dev
  allowed: [standard, healththread-dev]
```

产品实例另用一个 AGH_HOME：

```yaml
# 产品 AGH_HOME 的 profile 层；产品业务 SDK 选该实例
presets:
  default: healththread-runtime
  allowed: [healththread-runtime]
computerUse:
  enabled: false
```

profile 层允许名不会凭空装载 definition；运行 daemon 还需使用装配了新 preset 的构建。必须验证“schema 合法→继承解析→实际实例目录与路由→拒绝路径”，不能跳到“限制已生效”。[官方配置参考](https://github.com/AgnesAI-Labs/agnes-harness/blob/main/docs/reference/configuration.md)。

现阶段可直接从内置 standard 开始，总控严格只派两个；standard 的默认 fan-out=4 是实际硬上限。若不能修改/部署 AGH recipe，清楚保留这个区别，采用顺序执行或软调度限制，不伪称配置已更改。

### 模型设置

首先沿用你已经能调用成功的 Agnes 模型，减少同时更换模型和工作流的变量。模型名称、route、thinking 支持以实际 catalog 为准。不要虚构 model_id，route 也可能是 account-...。

检查五个文本槽：primary、escalation、fast、compaction、verifier 都解析为 Agnes。首轮可使用同一个 Agnes 模型；稳定后才按实际能力/预算区分。SDK 当前真实形式为：

```js
for (const slot of ['primary', 'escalation', 'fast', 'compaction', 'verifier']) {
  await session.setModel({ slot, route: actualAgnesRoute, model: actualAgnesModel });
}
```

以上是接线代码片段，变量须来自已核验配置。CLI 里的多次 --model 在固定 parser 中不是五个槽的批量设置方案，不能凭空列五个参数就宣称全部固定。实际设置/检查由 00 和 SDK adapter 完成；压缩/验证/嵌入/语音同样不能偷偷切别家模型。

### 真正的子任务调用

以下是工具调用参数示例，不是 JSON 配置文件；task 应替换为角色正文与明确交接信息：

```json
{
  "task": "执行 agents/development/prompts/02-data-api.md。基线=<已提交SHA>，契约=<版本>。仅改 services/api/domain/storage/auth/routes 与 tests/domain。交付 source/context/stage 端口及确认事务。公共 server/client/contract 只读。跑给定测试，本地提交，回报 SHA/接口/结果/限制。",
  "isolation": "worktree"
}
```

```json
{
  "task": "执行 agents/development/prompts/03-harness-workflows.md。使用同一基线/契约，仅改 agents/runtime、指定产品 Skill 源及 tests/agent。用冻结内部端口 fixture 实现五个健康工具和三工作流。公共 server/adapter/contract 只读。测试、本地提交，回报接线建议。",
  "isolation": "worktree"
}
```

两次分别调用 `subagent_spawn`，记住实际返回 `details.childKey` 和 `details.isolation/worktree`；再调用：

```json
{ "childKey": "<真实返回的childKey>", "wait": true }
```

工具名是 `subagent_collect`。取消用 `subagent_cancel({childKey})` 后 collect 确认终态。`model` 可选：验证槽仍是 Agnes 后才能用 "fast"/"verifier"；不填则继承。`budget` 是正整数 credits 上限，不是 tokens；没有已确认费用数值时省略并说明继承的实际树额度，不能写成“无限预算”。

worktree 从已提交 HEAD 起步：角色 prompt/PRD/contract/fixtures 要在基线中，不能只存在总控未提交文件。实际退回 shared 时串行写代码。collect 不 cherry-pick/merge，不证明改动已经接进主程序；总控检查 diff/commit/tests 后集成。工具字段和行为以 [固定版 subagent 源码](https://github.com/AgnesAI-Labs/agnes-harness/blob/7819b23c249fe47ce14bd89e3982e17986e3e197/packages/base/extensions/subagent/src/tools.ts) 为准。

## 你们三个人怎么配合

- 你：AGH 预检、工具/Skill、总控集成与真实模型轨迹。优先盯住权限、来源校验和模型失败恢复。
- 数据/接口同学：复核 Data/API 的 schema、确认事务、身份、授权与删除；接口冻结时与你一起核对。
- 前端/视觉同学：复核两端的核对、来源、过期、错误文案与用户动作；接入由 Frontend Agent 沿用现有代码，不要求重新出一套页面。

这是建议的人类复核分工，不冒充团队已承诺的人员职责或医疗审阅。关键产品待决仍回写 PRD；专业规则不能由软件 Review Agent 背书。

## 实施 pipeline 和验收

| 阶段 | 看得到的结果 | 过关证据 |
| --- | --- | --- |
| M0 | 已冻结 API/schema、页面动作表、实际 AGH 预检 | 基线重跑；契约 fixture；真实 preset/模型槽检查 |
| M1 | 身份/原文/版本/受限业务工具可连接 | 原子接收/持久化派发、权限/来源/事务与未知结果；包与 Skill 状态 |
| M2 W1 | 手机记录→电脑核对→手机有效新版本 | 原文先保存、真实三步工具、故障/恢复、确认事务、冲突/晚返回；第一次独立复核 |
| M3 W2 | 有效历史生成表达/问题/来源；更正旧卡过期 | 来源支持、版本依赖；D01/D02 明确关闭 |
| M4 W3 | 真实文本 PDF→差异核对→多医嘱事项 | PDF 定位/资源边界、确认接续、多事项故障；第二次独立复核 |
| M5 | 两端每个动作统一 API，导出/删除有范围 | 实际双 UI 演示、两账号隔离、草稿/删除/过期状态 |
| M6 | 可复现 MVP 与真实 Agnes 证据 | 不变量/故障矩阵、12+12 模型案例、对照/实测指标；最终 review、真实轨迹与六项证据 |

自动测试入口必须包含新增嵌套域测试；当前 `node --test tests/*.test.mjs` 不会自动发现 tests/domain/agent/faults。M0/总控更新 npm test 统一入口后检查实际执行数量，不能新建测试却让 CI 根本没跑。模型的 12+12 案例不是故障矩阵；后者要验证 HTTP/run/UI/DB 和恢复。

工程硬门槛：越权、Agent 自行写正式事实、错误事实/医嘱生效、重复提交、删除后恢复资料、伪真轨迹，任一可复现即阻断 MVP 验收；其他项完成不抵消。score-evidence 按六项指向实际代码/测试/运行，不能填自评高分。详细矩阵与指标见 agents/development/rubric-engineering.md。

停在契约、假路由、fixture 或“一次生成 JSON”都不算最终闭环。是否完成分别报告 implemented/tested/real_model/not_configured。D01/D02/语音未决可与核心演示分开，但不能称完整 PRD 全部验收或正式真实患者可用。

## 本包验证范围

本包仅编写 prompt、目标契约和 preset 模板，并复制 PRD；不改变当前产品运行代码、安装 AGH 插件或消耗模型额度。模板需经实际装配验证后才能选择；生成本包不等于后端已实现。核验记录见 validation.md。
