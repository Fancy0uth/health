# 需求—实现—验收映射

绑定规格：`spec.md`；工程I/E映射分别见`invariants.md`、`fault-matrix.md`；模型评估与命令见`validation.md`。以下代码路径为当前实际实现，历史原型模块不作现行领域能力证据。

|需求|实现|实际证据/状态|
|---|---|---|
|服务端事实真相、手工逐项确认|domain-store的immutable source/FactRevision、stageCandidates/confirm|store review-only/事务回滚测试；独立治理错误注入；UI候选语义/出处展示|
|本地明确身份、账号隔离、CSRF|domain-store login/session/scrypt；domain-server cookie/origin/CSRF|server auth测试、独立IDOR全对象测试、client切换/注销缓存测试|
|未知/否定/既往/当前/待排/模糊日期|source-validation完整原句与Evidence；server不做临床推断|语义拒绝与source spans限额测试；冻结24例独立金标，真实结果逐例披露|
|保存/派发、错误与恢复|SQLite接收/outbox/幂等receipts；domain-jobs deadline/backoff|SIGKILL五阶段；SQLite锁fixture；blocked保原文；丢响应原请求恢复|
|W1完整闭环|entry→三业务工具→review→confirm|domain/client自动测试；真实Agnes独立entry样例与历史smoke分开|
|W2材料与过期治理|visit→claims/speech/source/fact dependencies→result；invalidate|当前concern必须出现、错引/剂量拒绝；更正后stale；独立visit样例|
|W3文档、PDF、部分确认与多事项|Poppler安全execFile/受限BLOB保存；document review→care_plan独立run|加密/无文本/损坏/两页PDF；部分医嘱确认、care覆盖与task版本；独立真实文档样例|
|scope与删除epoch晚效果|受信任runtime binding、工具每次复查、mutation事务epoch CAS|genuine SDK scoped fixtures、HTTP body与PDF extraction barrier、晚result拒绝|
|Agnes固定SDK/preset/Skills/工具|runtime host、资产审批generation、五工具plugin、agnes-agent真实receipt correlation|Task2独立review CLEAR；runtime验证；真实provider/session/seq；无泛用执行工具|
|两套布局共用同源后端|apps/web与apps/mobile挂载共享domain-client/domain-ui|client双端CAS与恢复测试；根协调者真实浏览器验收记录补入runbook|
|授权、导出、删除|consent version/epoch；owner export；真实分层partial deletion|跨账号导出无文本；删除本地活动行/BLOB；AGH/备份/残留unverified明确显示|
|公开接口与错误可生成consumer|contracts/openapi.yaml共用typed schemas，与实际HTTP projections一致|tests/faults/contracts.test.mjs：实际24+ endpoint-methods、错误/版本/墓碑schema；offline pinned Ajv8.20.0工具链|
|D01/D02、OCR/语音未支持|capabilities department/triage not_configured；ocr/audio/voice unsupported|只验证关闭与错误呈现，没有临床阈值或医学效果验收|

当前新领域数据库不导入原型state-store/history；当前删除仅处理当前用户的新领域资料。模型schema有效、人工合成标签一致、真人医生核对是不同证据层；本交付没有临床专家评估。
