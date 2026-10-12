# 后端目标契约草案

这是供 M0 冻结的实施建议，不是已经上线的 API，也不是 AGH 原生 API。PRD 是需求来源；当前已运行契约仍为 contracts/README.md。将最终决定写入 contracts/openapi.yaml 与 schemas，后续 Agent 消费同一版本。

v0.2 同时采用 agents/development/rubric-engineering.md 的评分导向工程要求：冻结 I01–I12、不合法转换/失败恢复和 E01–E22 的接口行为，声明已存资料/未知副作用/可恢复状态；不能在一个总体 completed/error 字段中隐藏部分成功。

## 对象与状态

| 对象 | 最小字段与约束 |
| --- | --- |
| User/Session | 服务端生成 user_id；随机会话凭据；认证、到期、注销；所有查询从认证上下文限定 user_id |
| Consent | user_id、purpose、version、granted/revoked、recorded_at；run 保存使用的 consent_version；撤回阻止新的相关处理 |
| Source | id、user_id、kind=self_report/medical_document、immutable original/extracted text、text_version/hash、recorded_at、删除标记；原文件仅受控路径保存 |
| Entry | id、source_id、input_kind、received_at、raw_time_text；输入保存不代表事实已确认 |
| Document | id、source_id、media_type、byte_size、content_hash、extraction_status、页码/文本片段映射；不把文件名当正文 |
| Episode | id、user_id、label、status；模糊关联先 pending，不能关键词匹配后永久合并问题 |
| FactRevision | fact_id、revision、user_id、episode_id|null、field、value、assertion、temporal_scope、effective_time、evidence[]、review_status、supersedes_revision|null |
| FactChange | id、base_profile_revision、proposal[]、kind=new/correction/retraction、conflicts[]、status=pending/confirmed/rejected/expired、owner、确认回执 |
| Run | id、workflow、owner、scope、consent_version、base_profile_revision、phase、status、result_ref|null、error|null、AGH 关联、取消/恢复记录 |
| DispatchRecord | run_id、operation_id、state、attempt、next_attempt_at、deadline、claim/version；与原文/Entry/Run 的接收事务关联，持久化派发与恢复，远程执行在事务外 |
| Result | id、kind、schema_version、structured payload、claims/source_refs、dependencies[]、status=current/stale/withdrawn；只用后端核验的 AGH 元数据 |
| CareTask | id、user_id、document_id、confirmed_fact_refs、instruction evidence、text、explicit schedule|null、status=open/done/paused、version；症状反馈生成 Entry |
| DerivedDependency | result/task → source version、fact revision；更正/撤回/删除使派生物过期或撤回，不悄悄改成新版本 |
| IdempotencyReceipt | user、operation、key、request_hash、outcome、object/run IDs；同 key 不同 body 明确冲突 |
| DeletionJob | id、scope、status、各存储层清理回执/失败/保留原因；partial 不能显示为完全删除 |

run.status 固定为 queued/running/needs_review/completed/failed/blocked/cancelled/interrupted。needs_review 是持久化检查点，结果可供核对，不能误显示“已完成画像更新”。确认后如何继续 W3 由 M0 冻结为 continuation run 或恢复阶段；不得在 HTTP 请求内长期阻塞等人核对。

事实状态、run 状态、任务状态和人的健康状况是不同字段。不要用 completed 推断健康恢复，或用 confirmed 推断诊断正确。

M0 给出合法 transition 表和 CAS/epoch 约束，注明 needs_review 接续、各终态允许的恢复/重试、取消后的既有效果。source/entry/run/dispatch 的业务接收可同 SQLite 事务完成；文件系统与 DB/AGH 不共享原子事务。上传可用受控暂存→核验/持久化→事务关联，留下崩溃恢复与未关联文件回收记录；不能只写 uploaded=true 就声称原文件保存完毕。

确认事务同时完成有效事实、revision、审计/幂等回执和派生失效；在事务内比较当前归属/授权/删除 epoch。未知 commit 结果用原 Idempotency-Key 查同回执，写入 stage 同样检查 operation receipt，不能更换 key 重放。

## 时间与来源

`effective_time` 建议结构：

```json
{
  "raw": "上周开始，具体哪天不记得",
  "precision": "relative",
  "start": null,
  "end": null,
  "timezone": "Asia/Shanghai",
  "anchor_source_id": "src_example"
}
```

precision=exact/interval/relative/unknown。日期可为 YYYY-MM-DD；未知=null；received_at 是带时区时间戳，不能替代发生时间。相对时间转换只有锚点和规则明确才允许，保留 raw 和推导依据。以上值是样例，不是合成数据必须统一的日期。

字段证据建议：

```json
{
  "source_id": "src_example",
  "source_text_version": 1,
  "locator": { "page": null, "start": 0, "end": 4 },
  "quote": "上周开始"
}
```

文本区间采用 JavaScript UTF-16 code unit、0-based、[start,end)，校验 source.text.slice(start,end)===quote。PDF 使用固定 extraction text 版本与页码映射；页码 1-based。模型不能改写来源正文，工具返回的 source_id/version/hash 必须匹配 DB。定位存在只是结构校验；仍需检查原句是否支持对应字段、否定/时态/不确定性是否被改变；重要项要用户核对，不把模型自评当临床证明。

## HTTP 接口草案

所有错误使用现有 `{error:{code,message}}`，可加 detail/request_id；不含模型凭证/内部堆栈/跨用户存在性。版本用正整数；M0 统一 expected_profile_revision / expected_version，不能混用字段名。

扩展字段由 M0 冻结为稳定契约：request_id、phase、retryable、已保存 entry/source/run 关联、operation_id 与 public recovery 信息。公开 message 不等于恢复方案；输入保存前拒绝和保存后分析失败必须可区分。服务端记录脱敏的错误关联/状态转换，不能 catch 后返回 completed。

| 接口 | 输入/结果语义 |
| --- | --- |
| POST /api/auth/login；POST /api/auth/logout；GET /api/me | 最小服务端 session 身份；合成演示账号需明确 opt-in，不能当线上身份体系 |
| GET /api/capabilities | voice、pdf_text、ocr、department、triage 的 enabled/not_configured/unsupported 与原因；两端同源 |
| POST /api/entries | text、input_kind、episode_id|null、Idempotency-Key；先存 source/entry，再返回 202 entry_id/source_id/run_id |
| GET /api/sources/{id} | 按用户授权读取对应原文与定位；文件下载另有受控鉴权，不暴露路径 |
| GET /api/timeline；GET /api/profile | 当前用户的事件/有效事实、profile_revision、待核对/未知/冲突，支持必要过滤 |
| GET /api/fact-changes/{id} | 候选字段、原文证据、before/after、冲突与目标版本 |
| POST /api/fact-changes/{id}/confirm | accepted_change_ids、expected_profile_revision、Idempotency-Key；后端验证实际本人确认、归属、证据、版本，事务返回新 revision/commit_receipt |
| POST /api/facts/{id}/change-requests | kind、用户更正原话/来源、expected_version；创建新来源和候选，不原地覆盖原始事实 |
| POST /api/visit-preparations | current_concern、selected_source_ids、episode_id|null；保存困扰来源、202 run_id；不信任客户端拼的历史事实 |
| POST /api/documents | multipart 文件或粘贴文本（二者区分 input_kind）；202 document_id/source_id/run_id；无文本层、加密、超限明确错误 |
| GET /api/care-tasks；PATCH /api/care-tasks/{id} | 多事项数组；状态变更含 expected_version；反馈文字单独建 Entry |
| GET /api/runs/{id}；GET /api/results/{id} | 当前用户运行/阶段/检查点/结果；result 输出结构受 schema 限制 |
| GET /api/operations/{id} | 当前用户的不透明 operation receipt、已提交效果/未知状态；辅助丢响应恢复，不允许枚举他人操作 |
| POST /api/runs/{id}/cancel | 撤销 scope、取消 AGH/业务 job；不撤销已持久化原文或已确认事实，回执说明现有效果 |
| GET /api/consents；PATCH /api/consents | 分 purpose、version、expected_version 的授权与撤回；不靠浏览器布尔值授权 |
| GET /api/export；DELETE /api/data/{id} | 明确 scope、schema_version、归属和清理 job；DELETE 幂等但不删除其他用户/无关资料 |

保留旧 API 仅作迁移兼容适配器，将 legacy selected_record_ids 映射为受控来源对象；适配器必须调用同一领域逻辑。最终禁止 PUT /api/state 修改事实、授权或医学事项。布局偏好/未提交草稿可单独保存，正式确认由字段级 API 完成。

建议错误码：AUTH_REQUIRED、FORBIDDEN（或防枚举的 NOT_FOUND）、CONSENT_REQUIRED、VALIDATION_ERROR、REVISION_CONFLICT、IDEMPOTENCY_CONFLICT、AGENT_NOT_CONFIGURED、AGNES_PROVIDER_REQUIRED、SOURCE_NOT_SUPPORTED、UNSUPPORTED_DOCUMENT、INVALID_AGENT_OUTPUT、RUN_CANCELLED、SCOPE_REVOKED。沿用已有可复用错误，不无理由打破 client。

同时冻结限额/背压与依赖失败的 code（如 QUEUE_BUSY、DEPENDENCY_UNAVAILABLE、DEADLINE_EXCEEDED）及 HTTP 映射/Retry-After/安全重试条件；输入/文件/查询/队列/全局和每用户并发/deadline 可配置。health/capabilities 区分 liveness 与依赖 readiness，不把模型/Skill 缺失当全部就绪。数值由工程决策/实测填写，不虚构 SLA。

## AGH 产品工具：拟实现接口

这些 healththread_* 名称是本项目将注册的工具，不是 AGH 已有能力。注册后必须查实际目录并调用验证。

| 工具 | 可见参数 | 服务端约束和效果 |
| --- | --- | --- |
| healththread_read_source | source_id | 从真实 session/run scope 取 owner；读允许来源/文本版本；不接受路径/user_id/token |
| healththread_retrieve_context | query、episode_id|null、source_ids[] | 限当前用户/授权/有效版本/数量；返回 facts、证据、冲突与 snapshot_revision；不查已删除/已撤回内容 |
| healththread_stage_candidates | candidates[]、base_profile_revision、operation_key | 检查 source support/schema/scope；只落候选暂存，幂等，不生效正式事实 |
| healththread_get_confirmed_instructions | document_id | 仅取已确认医嘱及出处；不把诊断文本转为治疗建议 |
| healththread_stage_result | kind、payload、dependencies[]、operation_key | 校验 W2 材料或 W3 事项候选，暂存产物；不得直接完成用户确认或任务状态变更 |

每个工具结构化结果携带 operation_id、scope/run 关联、snapshot_revision、server validation/errors，作为真实回执。只读工具 replay=safe；写入暂存工具须按真实幂等能力选 replay=idempotent/never、isReadOnly=false；stage 不能继续套用官方字数统计示例的只读 metadata。

独立插件通过 `package.json` 的 `agnes.plugins`、`inject:["extension"]` 与 `ctx.extension().registerTool` 注册；parameters 使用 TypeBox 或正确 kind marker。安装/信任/enable/ready 是运行前条件，文件落盘不算安装。引用公开包入口，不跨包 deep import 私有源码。

scope 在业务服务中生成，绑定 AGH session key、run、user、consent、allowed_source_ids、snapshot_revision、过期时间、purpose；通过受信任接线传给插件，凭据不得让模型生成或放在可见 args/prompt。每次工具调用重新核验 scope 和当前删除/授权 epoch。模型提供的 ID 只是请求对象，不成为权限依据。

暂存和确认均验证 run/资料仍有效；分析期间撤回/删除后，迟到回调不能写回。确认事务必须比较版本并创建审计/幂等回执；副作用未知时先查回执，不能盲目重试。

## 产物 schema

- W1：source_id、snapshot_revision、candidates[]、missing_fields[]、conflicts[]、review_required。每个候选 atomic field/value、assertion/temporal_scope/time、evidence、proposal_kind、关联建议。
- W2：speech、questions[]、unknowns[]、claims[]（文本片段→fact revision/source evidence）、dependencies、department/triage capability 状态；选取的未核对自述显式标注，不能变成确认诊断。
- W3 提取：document_id、candidates[]、diff[]、unclear_items[]；提交后事项：tasks[]（每项 instruction_refs、text、explicit schedule|null、review/status）。没有明确医嘱则 tasks=[] 并解释，不补“一定复诊/调整药量”。
- AGH 元数据：session_id、last_seq、实际 tool receipts 索引、provider/model/version，来自 SDK/日志真实事件。阶段与证据不足时不能把结果标 completed。

## 拒绝路径必须可测试

身份猜测、来源 IDOR、恶意文档指令、过期事实、模糊日期、否定/待排误改、两端旧版本确认、重复提交/未知结果、模型失败、服务重启中断、取消/授权撤回/删除后晚返回、过期卡和无文本 PDF。来源 quote 命中但不支持字段也是失败样例。

合成测试与真实模型结果分开记；保留 PRD 12 开发/12 留出建议，样例覆盖这些输入类。工程检查不能替代专业规则审阅。
