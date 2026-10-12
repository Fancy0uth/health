# 六项工程证据与有限对照

权重来自用户提供的`agents/development/rubric-engineering.md`，不是另行核验的官方得分。以下记录可复现实现与证据，不估算比赛分数。

|维度/权重|当前具体实现与证据|限制|
|---|---|---|
|技术深度与系统实现25%|SQLite immutable来源/FactRevision、receipt/outbox、事务CAS、owner隔离、scope/epoch、派生失效；`contracts/openapi.yaml` typed responses；`tests/faults/crash.test.mjs`五阶段真实SIGKILL、`isolation.test.mjs`回滚派生状态|单进程Node+SQLite；没有全局分布式exactly-once|
|验证与异常20%|当前修复后208项工程测试零失败/跳过；I01–I12、E01–E22覆盖映射；DB锁、真实SIGKILL、PDF边界、迟到结果、未知写恢复；时间完整token/限定词/频率标点、未知信息优先和旧候选确认事务回滚|每行未注入子边界明确列出；没有零故障保证，有限缺失词规则不是一般语义证明|
|任务完成与结果15%|双端真实W1/W2/W3及来源/版本/更正/时间/复制过期状态验收；冻结V2唯一实跑24例：strict raw/final各6/24、原文24/24，4个范围编码差异和2个真实缺失信息校验缺口单列，后两者已修复|V2测量cf632b9修复前版本，当前1a673d4无新模型盲测；8个care未执行，日程质量N/A；合成标签无临床专家复核，V1仅历史|
|AGH闭环15%|真实Host+公开SDK、受信任五工具/三个ready Skills、固定provider/资产；真实浏览器三工作流留session/seq/回执；V2记录24个绑定SDKsession、12真实主闭环、12TRANSPORT失败，4次修正≤2/运行|失败保留在分母；82个SDKrequest_sent事件不是计费统计；W1正式事实仍需人工确认；系统拦截与模型正确性/任务完成分开|
|问题价值/融合15%|手机保存→电脑核对；更正后旧卡stale；医嘱部分确认和多事项；失败原文仍在；每结果沿source/run/commit回执解释|未测量节省整理时间或临床健康效果；真人医生处理仍必需|
|创新/发展10%|可操作的来源证据+事务确认+版本失效，而不是仅聊天JSON；固定工程错误注入对照见下表|fixture治理实验，不能称模型能力或临床结局提高|

## 固定治理故障实验（不是模型对照）

同一条合成原文`目前没有头痛。`、同一组6个故意错误proposal、固定通过原样的无验证counterfactual vs当前scope/evidence/CAS路径。counterfactual只`structuredClone(attacks)`，按构造保留全部错误；没有声称它是历史产品实现或实测旧模型。新方案运行实际DomainStore工具和SQLite，不改变proposal迎合测试。

|注入|无验证pass-through fixture|当前source/evidence工作流|
|---|---|---|
|值与quote不等|错误原样保留|拒绝，无fact_change/facts|
|否定改肯定|错误原样保留|拒绝，无fact_change/facts|
|current改past|错误原样保留|拒绝，无fact_change/facts|
|无诊断依据却field=diagnosis|错误原样保留|拒绝，无fact_change/facts|
|他人/不允许source|错误原样保留|拒绝，无fact_change/facts|
|source_text_version=2|错误原样保留|拒绝，无fact_change/facts|

命令：`node --test tests/faults/governance.test.mjs`，测试`fixed engineering counterfactual: unvalidated pass-through retains six wrong proposals while governed staging blocks all six`。控制组字面有效候选能暂存，但仍0正式事实直到用户确认。错误拦截6/6只对应这6个固定工程注入。取消/撤回/删除后的迟到W2 stage同文件各一例；派生卡/事项更正后过期由`isolation.test.mjs`实际断言。受控方案增加读取、暂存、人工核对、receipt/CAS步骤；没有测量并编造其延迟/成本，更没有匹配真实旧模型baseline，所以不作模型提升百分比。
