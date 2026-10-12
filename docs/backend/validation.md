# 验证记录：工程测试与真实模型分开

环境：macOS、本机Node `v24.14.0`、SQLite `3.51.2`、Poppler `26.09.0`；AGH固定提交 `7819b23c249fe47ce14bd89e3982e17986e3e197`。真实调用使用 `agnes-ai` / `agnes-3.0-flash`，批准资产generation `fc8a1a31ae4ba17db898`。没有修改外部AGH源码/账户，运行目录与账户目录分离。`node:sqlite`现有实验性警告仍在。

## 工程验证

|命令|实际结果|证据边界|
|---|---|---|
|`node --test tests/faults/*.test.mjs`|28/28 PASS，0 fail，1.14s（含离线summary和result-kind追加回归）|真正router/store/SQLite/Host/SDK；Poppler timeout/cancel是固定subprocess边界注入|
|`npm test`|145 total /144 PASS /0 fail /1 opt-in skip，12.54s（最后一次在HEAD03af5b2与Task4工作区运行）|动态loopback HTTP、真实子进程SIGKILL、所有既有领域/SDK/client测试|
|`npm run check`|64 JavaScript modules，syntax/JSON PASS|不替代业务测试或模型评估|
|`node scripts/evaluate-model.mjs --summarize .runtime/evidence/quality-v1-4fCv9f/evidence.json`|PASS；只从保存证据与合成DB重新计算，不调用模型|复现下列portable结果；金标没有改动|

完整日志：本机 `/tmp/healththread-task4-tests-final.log`、`/tmp/healththread-task4-check-final.log`、`/tmp/healththread-task4-faults-final.log`、`/tmp/healththread-task4-sdk-build.log`。typed OpenAPI测试使用固定AGH安装中离线Ajv `8.20.0`（仅测试工具链，无生产依赖）。检查包含每个documented success的ref解析、实际24+ endpoint-methods、malformed字段/版本拒绝及删除墓碑。本轮显式AGH_ROOT的`node --test tests/sdk-build.test.mjs`已单独1/1 PASS、0skip（当前公开SDK构建/加载，无inference）；Task2历史结果不充当本轮证据。

## 一次真实24例质量评估

开发12 + 留出12由可靠性实现者在任何本轮质量调用前独立按原文语义标注并冻结，commit `621be3f`。数据SHA256：`0e5b3d16a2badd3417ff77e2f5fdb9d6c058407fbbd4df7fd47f8d3542496b10`；标注是developer synthetic gold，没有临床专家复核，不来自模型或现有validator。12/12顺序批次，每次最多2个不同owner，正常global2/owner1、每run120s、repair≤2；没有扩credits/steps/budget。

实际执行：2026-10-12 `05:38:44.783Z`–`05:50:32.944Z`，执行HEAD `621be3f`，固定Task2 `e72cbed`的领域/adapter/runtime资产。本次24个主运行各执行一次，另8个文档确认后独立care_plan接续，总计32个run。没有重新运行失败/留出例或根据留出调prompt/Skills/schema。输入只有虚构原文，包含emoji、相对时间、否定、既往/当前、不确定诊断、未提及/未询问、药名/剂量缺失、部分医嘱确认、多医嘱、无医嘱、病历命令与真实两页文本PDF。

本机完整首尝试与后续proposal证据：`.runtime/evidence/quality-v1-4fCv9f/evidence.json` 和同目录合成SQLite。可提交的逐例原始首stage参数、final候选/产物、错误/repair/session/seq/工具correlation/确认引用与指标：[`evaluation-results.v1.json`](evaluation-results.v1.json)。原证据SHA记录于该文件；完整provider请求、凭据、账户配置没有收集。

观察者在公共SDK `events` / `readToolDetail` 中保存实际stage call/result；Core拒绝的首stage也被观察，不用稍后修复proposal顶替。本次主运行raw首stage观察24/24、unobserved0；D04/H03的首stage `candidates` 是string，标记structural failure。它们留在24例分母中，未被静默丢弃。错误run只有实际绑定session/SDK失败序列，不能计为correlated成功闭环。8个care接续也分别保存首stage与终产物。

最初评估器把JSON object键顺序用于locator相等判断，导致部分候选被错误判为不支持。独立回归先RED后GREEN，修正比较值并把逐字来源支持与严格time-code标签一致分开；全部结果从原存档**离线**重算，不重跑模型、不改金标、不改模型资产。原本机证据/console仍保存原始计分，portable文件明确披露重算。初次启动未保存评估器自身字节hash，不能补称当时测量过；现有脚本已为未来运行记录此hash。

|口径|开发 raw → final|留出 raw → final|总计 raw → final|
|---|---|---|---|
|严格完整原文gold匹配的主例（包括结构失败与未知拒绝）|4/12 →4/12|5/12 →7/12|9/24 →11/24|
|候选五项字段组件准确：value/field/assertion/temporal_scope/time|39/55 →43/50|48/60 →61/65|87/115 →104/115|
|候选逐字定位/来源与assertion/temporal支持（允许source-supported相对时间编码）|7/11 →10/10|8/12 →13/13|15/23 →23/23|
|严格匹配的不同预期候选（漏提/标签差异单列）|1/10 →3/10|4/12 →8/12|5/22 →11/22|
|W2逐字claim支持与覆盖|4/4 →4/4|4/4 →4/4|8/8 →8/8（6个visit例）|
|适用例的否定保留|3/3 →3/3|2/2 →2/2|5/5 →5/5|
|适用例的不确定性保留|3/3 →3/3|2/3 →3/3|5/6 →6/6|
|适用例的past/current marker保留|6/6 →6/6|5/5 →5/5|11/11 →11/11|

输出候选分母只计可解析数组中的候选，结构失败另留在case分母；不能把115字段组件当成24例全部完整输出。source支持23/23只是有限原文/定位/标签约束，不是100%临床正确，H03重复候选虽逐字支持仍使case失败。严格time标签gold使用unknown/null时，模型保留`目前`/`既往`/`daily`等source-supported relative/raw会计差异；不把这些差异当成虚构医学结论，也不为提高分数修改冻结标签。

主run真正有SDK成功correlation并关闭21/24；全部真实run成功29/32。W3接续8/8全部完成，期望9个事项逐条覆盖真实已确认fact_id/revision；D10/H10无医嘱返回0任务+说明，D11/H11只生成部分选中的1事项。各接续raw与final都满足这批独立gold（task引用的gold来自持久化用户确认FactRevision，不能从最终模型task反算）。全部source保存24/24。正常repair总计12，8个run用过repair，每run最多2。

D04/D05/H04对未提及/未询问/不详候选最终失败，公开`DEPENDENCY_UNAVAILABLE`；实际SDK诊断分别为E_STEP_FAILED或AGH_REPAIR_LIMIT。原文仍在、0确认事实、0result，作为未知项受控拒绝3/3；它们没有empty-success产物，仍不计成功workflow。H03首Core结构拒绝后repair2，最终出现同一不确定句的两个候选（diagnosis和reported_text），严格case失败且没有用户确认。其余9个final严格差异中，D01/D02/D10/H01/H02是不同但有来源支持的time-code编码，D09/D11/D12/H12是明确“每日/daily”的normalized raw+relative时间槽遗漏。后4例保留了完整原句，但时间槽缺失仍是模型质量缺口，不能用标注歧义开脱。无模型成本、吞吐SLA、分位数或临床效果推断。

|例|主阶段捕获状态|raw/final严格gold|repair主/接续|接续事项|case wall ms（含同batch等待）|差异/错误|
|---|---|---|---|---|---|---|
|D01|needs_review|fail/fail|0/—|—|26527|relative目前 vs unknown/null|
|D02|needs_review|fail/fail|0/—|—|26527|既往/目前time-code|
|D03|needs_review|pass/pass|0/—|—|28839|不确定诊断保留|
|D04|failed|fail/fail|2/—|—|28838|Core首candidates string；E_STEP_FAILED|
|D05|failed|fail/fail|2/—|—|39166|未询问拒绝；AGH_REPAIR_LIMIT|
|D06|completed|pass/pass|0/—|—|39164|当前困扰与未知表述|
|D07|completed|pass/pass|0/—|—|37062|emoji/否定出处|
|D08|completed|pass/pass|0/—|—|37060|既往/当前不确定|
|D09|needs_review|fail/fail|1/0|2|58088|首时态错误被拒；final每日时间槽遗漏|
|D10|needs_review|fail/fail|0/0|0|58088|目前time-code；无医嘱空任务说明|
|D11|needs_review|fail/fail|1/0|1|85620|首时态错误被拒；final每日时间槽遗漏；部分确认|
|D12|needs_review|fail/fail|0/0|1|85619|每日时间槽遗漏；病历命令未成为有效产物|
|H01|needs_review|fail/fail|0/—|—|26120|relative目前 vs unknown/null|
|H02|needs_review|fail/fail|0/—|—|26118|过去/当前time-code|
|H03|needs_review|fail/fail|2/—|—|58723|Core首candidates string；final重复不确定句|
|H04|failed|fail/fail|2/—|—|58724|不详拒绝；AGH_REPAIR_LIMIT|
|H05|needs_review|fail/pass|1/—|—|98517|首省略原句时间限定，修复保留大约两周前|
|H06|completed|pass/pass|0/—|—|98518|否定与未询问原句|
|H07|completed|pass/pass|0/—|—|42875|文档命令不改变工具权限|
|H08|completed|pass/pass|0/—|—|42875|emoji/过去/当前不确定|
|H09|needs_review|fail/pass|1/0|2|121659|首时态错误被拒，修复保留两周后|
|H10|needs_review|pass/pass|0/0|0|121660|无明确医嘱，不创建任务|
|H11|needs_review|pass/pass|0/0|1|83930|只确认第二条医嘱|
|H12|needs_review|fail/fail|0/0|2|83926|真两页PDF；daily时间槽遗漏|

W3主阶段status是用户确认前capture；确认后原run完成并创建独立接续。case wall计时等待同batch所有run，文档含两run，因此可超过单run120s；不是纯provider延迟。queue wait/细阶段时长/费用未单独测量，不编造统计。历史四次real smoke仍保留在`reviews/agh-implementation.md`，不能替代本次质量评估。

## 未验证边界

没有断电/磁盘满/真实Poppler卡死/临时文件权限错误/外部AGH真实429/凭证停用/长网络分区/完整渗透与负载长跑；远程session轨迹、备份、WAL/OS残留无法认证擦除；删除仍partial。D01/D02没有获批临床规则，OCR/voice/audio不支持。根协调者真实浏览器双端验收和最后独立review单独登记，不能从fixture推导其通过。
