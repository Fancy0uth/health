# 持久化运行状态与恢复

当前实现由 `DomainStore.claimRun/failRun/confirm/reject/reanalyse/cancel` 与 `DispatchQueue` 管理。202只说明接收事务已持久化，用户原文不等于有效事实。

|从|触发/守卫|到|提交效果与恢复|
|---|---|---|---|
|无|身份、授权、限额、epoch、idempotency校验通过|queued|source/entry/document/episode/run/dispatch/保存receipt同事务；之前失败没有假保存|
|queued|deadline和当前scope有效，受global2/owner1限制claim|running|持久化dispatch attempt/version；远程调用在事务外|
|queued|未派发前deadline过期或scope失效|failed/cancelled|原文/接收receipt保留；旧scope不得提交|
|running|W1/W3有序读取后候选stage校验通过|needs_review|候选/工具receipt/dispatch检查点持久化；不写有效事实，不占工作线程等人|
|running|W2/care_plan合法result stage|completed|result/任务与回执持久化；后续SDK异常可另有execution_error|
|queued/running|依赖未配置/未就绪|blocked|已存原文保留；修复配置后用户显式retry产生关联新run|
|queued/running|deadline/provider/格式失败|failed|错误code/phase/request_id；repair≤2，不无限重试|
|running|真实进程重启；或本机close中止活动等待|interrupted|标明RUN_INTERRUPTED，不伪造远程完成；未知效果不能自动盲重放|
|needs_review|用户确认选中候选，当前profile/consent/epoch/source有效|completed/confirmed|事实revision/审计/回执/依赖失效同事务；W3另建queued continuation|
|needs_review|用户拒绝或confirm空选择|completed/rejected|没有新增事实；有真实commit receipt|
|needs_review|显式reanalyse，当前revision CAS通过|旧cancelled/reanalysed + 新queued|旧候选expired；新run复用保存的source，不把旧候选强行重基|
|queued/running/needs_review|cancel、撤回授权、删除|cancelled|scope/epoch失效；已提交效果与后来删除区分；源是否保留取决于具体动作|
|failed/blocked/interrupted|当前授权/epoch有效且原run无已stage产物，用户retry|旧终态保留 + 新queued|新run/receipt引用旧run，不重复source；禁止retry已取消或review检查点|
|completed/cancelled等终态|再次cancel/晚callback|保持终态|不可回到running；工具范围校验拒绝晚stage|

`needs_review/completed` 后provider失败不会删除检查点，公开`execution_error`。原始运行成功不是医学诊断正确。源删除/授权变化不会撤销已发生且未删除的用户历史确认。删除保留无原文的run/operation墓碑与`trace_erasure:unverified`。

真实子进程SIGKILL覆盖提交前、queued、running、review、confirm后的queued continuation；外部AGH崩溃、断电、磁盘满和远程擦除不在自动进程测试证明范围。source和FactRevision由SQLite触发器禁止更新；更正是新source与新revision。
