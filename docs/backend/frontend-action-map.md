# 双端动作与业务接口

`apps/web/src/app.js`、`apps/mobile/app.js` 挂载共享 `packages/client/domain-ui.js` / `domain-client.js`。两入口同源且同用户scope；手机版不是另外一个数据库或后端端口。最终真实浏览器验收由根协调者记录。

|两端动作|当前业务接口|完成/失败的用户反馈与证据|
|---|---|---|
|登录/恢复/退出|POST auth/login、GET me、POST auth/logout|明确本地合成登录；注销/切换清缓存；client跨tab/logout测试|
|保存身体感受|POST entries→GET runs/:id|已保存原文与needs_review分开；blocked仍能查保存receipt；草稿按原请求key恢复|
|候选原文/语义核对|GET fact-changes/:id、sources/:id|完整field/assertion/temporal/time/quote/page；内部IDs折叠；未确认不显示有效事实|
|选中确认/拒绝|POST fact-changes/:id/confirm或reject|profile CAS冲突409保留选择；确认commit receipt，拒绝无新增事实|
|旧核对重新分析|POST runs/:id/reanalyse|复用已存source，旧候选expired；不悄悄确认旧版本|
|时间线/版本史|GET timeline/profile、export|source原文与FactRevision旧版保持；history明确版本|
|更正/撤回|POST facts/:id/change-requests→核对confirm|新来源/候选，不直接修改事实；确认后旧沟通卡/任务stale|
|沟通材料|POST visit-preparations→GET result|当前困扰/授权来源；未核对自述标签；复制旧卡保留stale出处|
|PDF或粘贴资料|POST documents multipart file或JSON|真实byte/type/page限制；扫描/加密/损坏拒绝；无OCR正文伪造|
|多事项/标为执行完成/暂停|GET care-tasks、PATCH care-tasks/:id|仅来自已确认医嘱的独立continuation；expected_version，stale409；执行完成不等于康复|
|分析授权/撤回|GET/PATCH consents|purpose/version；撤回scope失效，旧callback不能恢复|
|运行/病历发现和更早历史|GET runs/documents（limit/before）|owner限定、分页游标；刷新保已加载旧页，失败/中断/blocked可发现|
|取消/显式重试/回执恢复|POST runs/:id/cancel、retry、GET operations/:id；原key重发|未知请求不静默重发/换body；PDF重选核对原bytes；错误保草稿|
|导出当前账号|GET export|下载source/fact版本/原PDF等；不含对方资料|
|删除来源/全部|DELETE data/:source_id或all|明确确认后显示分层partial；全部删除all_clear_epoch清本机健康草稿；丢DELETE用不含正文的旧session handle恢复|
|语音/通用医学问答/科室/观察分级|capabilities|voice/OCR/audio unsupported，D01/D02 not_configured；没有本地医学规则产物|

`tests/client/domain-client.test.mjs` 提供transport/存储边界自动验证；`tests/client/presentation.test.mjs` 验证逐项语义与转义。自动fetch fixture不能替代真实浏览器工作流，后者的版本与结果在runbook单列。
