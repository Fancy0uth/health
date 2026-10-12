# HealthThread 后端实施规格（用户已授权执行）

依据原始 PRD、agents/development/prompts/01-master.md、target-contract.md 和 rubric-engineering.md。2026-10-12 用户选择在当前会话以多 Agent 实现后再验收；开发模型与产品运行模型是不同用途。产品运行仅通过 Agnes Harness/Agnes。保留两套现有界面、Node ESM + SQLite，共用同源 API。

## 绑定要求

- 正式事实只能由登录用户明确核对后通过事务提交。Agent 只能读取授权资料、暂存候选/产物，不能确认、修改账号/授权或执行任意 shell/文件/网络。
- 身份从随机到期服务端会话取得，scrypt 本地合成演示账号需显式启用；浏览器提供的 owner/user_id 不作为身份。所有对象读写按用户限定，cookie HttpOnly/SameSite，写请求检查同源及 CSRF。登录限速，错误不枚举账号。
- 原文 immutable，UTF-16 [start,end) quote 校验，PDF 页码1起。未知=null，未提及不等于否认，保留否定/既往/当前/考虑/待排/模糊时间。可验证的 extractive 值只能来自所引片段；字段必须携带 assertion/temporal_scope/time/evidence。此机制不宣称自动证明任意医学语义；人工核对始终必须。
- source/entry/document/run/outbox 接收事务；远程模型调用在事务外。所有接受操作/暂存/确认有请求哈希幂等回执；相同 key 不同请求409。确认检查当前授权、epoch、来源、候选归属和 profile_revision，审计/事实 revision/回执/派生过期同事务。重复确认不重复生效。
- queued/running/needs_review/completed/failed/blocked/cancelled/interrupted；needs_review 是持久化检查点，不是已确认事实。重启中断 running，安全回收 queued；不会偷偷重放未知远程效果。取消/撤回/删除使 scope 失效，迟到写入拒绝，不抹除已经确认的历史。
- W1 文本先存→read_source→retrieve_context→stage_candidates→needs_review→用户确认→有效事实/时间线。W2困扰原文先存→授权有效事实/选中来源→表达稿/问题/unknowns/claims/dependencies→stage_result→卡片，事实变化卡片 stale。W3粘贴或文本层 PDF→来源页映射→候选差异→核对→独立 continuation 读取已确认医嘱→多个 care tasks。只从明确确认医嘱提取事项，不补剂量或复诊时间。
- 科室/观察分级 D01/D02 未批准，返回 not_configured；OCR/音频 unsupported。不编临床阈值。上传有 byte/type/page/text 限额、受控提取，不调用 shell 拼接文件名。空/扫描/加密/损坏 PDF 明确错误。可将原 PDF 作为 SQLite BLOB 保存以避免 DB/文件两阶段不一致，需限额。
- 禁用最终 PUT /api/state 写事实；GET 兼容投影只从领域对象生成。所有双端正式动作使用领域 API；浏览器本地原型数据不能上行成为事实。草稿按登录用户隔离，注销/换用户清缓存，错误/冲突保留草稿且不自动覆盖。
- 分用途版本授权，导出只含当前用户；删除有真实各层回执，AGH 痕迹无法永久擦除则 partial，不显示完全删除。结果/事项有来源和事实依赖，变更/删除失效。退订/资料删除后不能迟到恢复。
- 队列、并发、deadline、输入/上传大小有可配置默认限额。局部输出修复总计最多2次，错误公开 code/request_id/phase/retryable/保存回执，日志不写病历正文/凭据。
- 合成 fixture 与真实模型验证严格区分。真实运行必须有 SDK session/seq、实际业务工具回执，至少连续三步读源/取上下文/暂存。未配置真实能力显示 blocked/not_configured，不能用固定模板假冒成功。
- 新代码要有成功/失败/恢复测试、跨用户/双端旧版本/幂等/取消撤回删除晚回调/重启/证据语义拒绝测试；12开发+12留出合成模型评估样例与工程故障矩阵分开。不得声称异常完美或真实模型已通过而无证据。

## 冻结接口

API 版本1，JSON {error:{code,message,request_id,phase,retryable,details?}}；公开 ID 不泄露路径/身份。所有写接口除 login 都用 X-CSRF-Token；涉及创建/确认用 Idempotency-Key（16–128字符）。服务端不信任额外 owner 字段。

POST /api/auth/login {username,password}; POST /api/auth/logout; GET /api/me → {user:{id,username}|null,csrf_token,profile_revision}; GET /api/capabilities。
POST /api/entries {text,input_kind:'self_report'} →202 {entry_id,source_id,run_id,operation_id}; POST /api/documents JSON {text,name?} 或 multipart file →202 {document_id,source_id,run_id,operation_id}。
POST /api/visit-preparations {current_concern,selected_source_ids:[]} →202同类运行回执；GET /api/runs/:id（含 phase/status/fact_change_id/result_id/保存回执）；GET /api/results/:id；POST /api/runs/:id/cancel。
GET /api/profile →{profile_revision,facts,pending_changes}; GET /api/timeline →{entries}; GET /api/sources/:id；GET /api/fact-changes/:id →候选/原文/差异；POST /api/fact-changes/:id/confirm {accepted_change_ids,expected_profile_revision} →{profile_revision,commit_receipt,continuation_run_id?}；拒绝候选有明确 reject 操作。
POST /api/facts/:id/change-requests {kind:'correction'|'retraction',text,expected_version} 创建原文和候选核对；GET /api/care-tasks；PATCH /api/care-tasks/:id {status:'open'|'done'|'paused',expected_version}。
GET /api/consents；PATCH /api/consents {purpose:'analysis',granted,expected_version}；GET /api/operations/:id；GET /api/export；DELETE /api/data/all 或 /api/data/:source_id →删除 job。
GET /api/state 兼容领域投影（登录必需）；PUT →405。旧生成接口仅迁移适配领域接收，不另建权限或事实入口。正式 chat 收窄为信息表达，不诊断。

业务工具只有 healththread_read_source、healththread_retrieve_context、healththread_stage_candidates、healththread_get_confirmed_instructions、healththread_stage_result。工具 args 不接收 owner/token/path。受信任 runtime session 关联 run scope，owner/授权/epoch/TTL/允许源/事实版本在每次工具调用重查。最小 payload/schema 见 contracts/schemas/。stage 对同 operation_key 幂等。Tool receipts 由服务端产生。

## 实现界面约定

DomainStore 构造({dbPath,demoAccounts?,clock?})，SQLite；公开所有者受控 methods，DispatchQueue 接收 agent.run({run,scope,tools,signal})。tools 是绑定 scope 的对象，每个函数返回真实结构化回执；agent 不能构造 owner。真实AGH适配器通过可信插件/调用上下文接线，不把这些函数假装SDK固有工具。测试可注入 deterministic fixture agent，须 mode=fixture。

createApp({root,dbPath,agent?,demoAccounts?,limits?}) → {server,store,jobs,close()}；服务器必须对默认未配置身份/模型 fail closed。保留静态入口 /web/、/mobile/ 和共享 client。临床与工作流规则放产品 agents/runtime，开发 prompt 不加载到产品 workspace。
