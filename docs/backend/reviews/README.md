# 实现与独立审查记录

这些记录保留各次实现者的声明、独立审查发现及修复后的复核结论。早期报告中的通过状态仅适用于当时范围和版本；当前交付状态见 [实施进度](../progress.md) 和 [本地验收](../runbook.md)。报告里原 `.superpowers/sdd/plan/` 路径是执行期间的工作记录，收尾后以此目录的保存副本为准。

| 范围 | 实现 | 初审 | 修复复核 |
| --- | --- | --- | --- |
| 领域后端 | [实现](domain-implementation.md) | [初审](domain-initial.md) | [修复](domain-fixes.md) |
| 真实 AGH 接线 | [实现](agh-implementation.md) | [初审](agh-initial.md) | [修复](agh-fixes.md) |
| 双端接入 | [实现](frontend-implementation.md) | [初审](frontend-initial.md) | [第一轮](frontend-fixes-1.md)、[第二轮](frontend-fixes-2.md) |
| 故障与历史评测 | [实现](reliability-implementation.md) | [初审](reliability-initial.md) | [修复](reliability-fixes.md) |
| 全分支最终审查 | [集中修复](final-consolidated-fix.md) | [初审](final-initial.md) | [集中修复复核](final-consolidated-rereview.md) |
| 时间规则残留 | [完整 token 修复](final-residual-fix.md)、[标点修复](final-delimiter-fix.md) | [残留复核](final-residual-rereview.md) | [最终复核](final-delimiter-rereview.md) |
| V2 评测器 | [实现与修复](evaluation-v2-implementation.md) | [初审](evaluation-v2-initial.md) | [第一轮](evaluation-v2-rereview-1.md)、[最终复核](evaluation-v2-final-rereview.md) |
| 实测发现的未知信息校验 | [修复](missingness-fix.md) | 原始问题见 [V2 报告](../validation.v2.md) | [独立复核](missingness-review.md) |
| V2 一次实跑结果 | [归档报告](../validation.v2.md) | [准确授权](evaluation-v2-authorization.md) | [结果一致性复核](evaluation-v2-results-review.md) |

[真实双端验收记录](browser-acceptance.md) 包含初次缺口、修复后的操作与真实执行元数据。[手机标题修复](mobile-header-fix.md) 另由协调者重载窄屏验证。最后工程验证与当前预览状态见 [最终工程检查](final-verification.md)；V2 唯一实跑结果见 [V2 验证](../validation.v2.md)，准确外部额度授权见 [授权记录](evaluation-v2-authorization.md)。V2的修复前模型结果与修复后208项工程检查分开记录。

[协调决策与执行历史](execution-ledger.md) 保存所有 `Ruling:`，包括用户选定的本地分支、最多两位并行子 Agent、文件归属、审查阻断与独立评测冻结规则。工程 fixture 测试与真实 Agnes 调用分开记录；AI 辅助开发者合成标签不等于临床专家金标。
