# HealthThread 产品 Agent

项目通过 Agnes 官方 Host / Node SDK 运行一个受限业务适配器 `services/api/agnes-agent.mjs`，不直接调用模型 HTTP API。第三方版本固定在 `harness.lock.json`。产品角色、业务工具、提示词、确认流程和 UI 由本项目实现。

## 当前运行流程

- `chat` → `runtime/skills/health-assistant/SKILL.md`：自然交流、理解前文、主动澄清；使用 v2 `reply` 直接展示模型回复。
- `entry` → `runtime/skills/health-record/SKILL.md`：用户确认整理后生成自然记录摘要和可追溯候选，候选尚需核对，不自动升级为已确认事实。
- `visit` → `runtime/skills/visit-preparation/SKILL.md`：用户确认后生成自然连贯、可修改的就诊表达稿；原句证据独立保存。
- `document` → `runtime/skills/post-visit/SKILL.md`：文档事实提取、结构化观察与新旧事实核对，暂存后等待人工确认。
- `care_plan` → `runtime/skills/care-followup/SKILL.md`：读取已确认医嘱后生成逐字保留原文和时间的任务，单独提供患者释义及澄清问题，不重新提取候选。

普通聊天保留会话历史，但不会自动生成正式健康记录。保存记录、生成沟通卡或两者同时执行，先由助手提出含简要总结的 `offer_*`；随后用户同意，由模型理解为对应 `confirm_*`。服务端验证待确认提议、会话、当前用户原话、任务状态及真实运行回执，再创建后续任务，防止过期同意和重复执行。

v2 聊天正文与就诊摘要不再要求逐字拼接来源，也不再用数字、问号或固定同意句式拦截自然表达。沟通稿默认用服务端关联的授权原文作为来源，不强制模型手工构造逐句坐标；若提交细粒度引用，则继续严格校验。原句、版本、引用定位和账号范围仍需核验。自然摘要依赖模型理解，保留用户核对和编辑入口；不能把模型摘要称为医学验证。

自然记录采用 `record_source_refs`：模型从已读 `indexed_sentences` 中选择仍有效的原句编号，服务端生成证据、标识和字面时间标签。缺失或模糊信息留在原文与自然摘要里，不自动变成已知事实。旧医嘱提取仍走严格候选合同。

任务开始执行后默认有 300 秒处理预算；排队最多 600 秒，整个授权范围最多 900 秒。排队不会提前消耗执行预算，超时仍保留原文并提供重试。

## 审阅入口

- 总角色、工具注册、运行参数：`runtime/plugin/index.mjs`
- 五份产品提示词：`runtime/skills/*/SKILL.md`
- SDK 调度与回执核验：`../services/api/agnes-agent.mjs`
- 业务校验及确认状态：`../services/api/domain-store.mjs`
- 运行时安装与权限边界：`runtime/host.mjs`、`runtime/boundary.mjs`
- 工具输入合同：`../contracts/schemas/`，与 `runtime/plugin/schemas.json` 同步

`development/prompts/` 是开发过程材料，不是运行时加载给患者助手的提示词。更改运行提示词/插件后，需同步审阅过的 `runtime/approved-assets.json` 并验证真实模型流程；脚本化模型测试不能证明真实对话质量。

### 第四章健康理解范式

交流、记录、就诊和文档提取四条运行时 Skill 均包含 Project Framework v0.2 第四章的“问题事件 + 时间 + 证据”范式，覆盖部位与表现、时间与变化、主观程度、影响与情境、伴随与否定、测量与资料、背景与处理、证据与状态。模型使用“当前问题、事件时间线、经确认背景、冲突与未知”四个视角选择追问和组织摘要，不要求患者逐项填写问卷。独立 care-followup 技能只读取已确认医嘱，保留其中的时间、条件、否定与未知，不添加临床判断或新用药方案。

当前画像将这个范式落实为十类有原文支持的观察：部位、表现、开始时间、持续与变化、自述程度、生活影响、情境、伴随与否认、测量、背景。网页和手机端通过当前问题、事件时间线、相关背景、冲突与未知四个视图呈现，并保留来源、事实版本与确认状态。模型提交的观察和新旧比较先进入待核对候选；用户独立核对后才进入已确认画像，冲突由用户明确选择处理方式。

这些观察用于组织信息，不是医学量表、自动诊断模型或健康评分。缺失不等于否认，程度不自动换算分数，趋势不混用指标、单位、时间或不同人的自评。记录和就诊卡仍在用户确认行动后生成，事实核对仍独立进行；医嘱任务仅接续已确认医嘱，释义和反馈不会自行改写医嘱。范式随受校验的 Skill 资产部署到每个新运行会话。

SDK native schema rejections are diagnosed only from the bound session ledger, correlated by toolUseId. Type/required/forbidden-field feedback contains schema-owned paths and expected types, never source values or arbitrary unknown keys. Because context is cached per SDK turn, a recognized rejection pauses before inference and refreshes context in the same session using the existing combined two-repair budget. It does not coerce strings, rewrite calls, alter receipt hashes, add tools, or patch the pinned harness. Value-only errors without a safe structural diagnosis retain the existing fallback.
