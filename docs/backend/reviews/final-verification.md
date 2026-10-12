# 最终工程与本地验收检查

2026-10-12，当前仓库 `/Users/fancyouth123/Documents/ChatGPT/expressforpatient`，本地分支 `codex/healththread-shared-backend`，基线 `744faa9`。状态：**代码可验收；获批 V2 唯一实跑已归档，随后未知信息校验修复已复核**。未推送、合并或部署。

| 检查 | 实际结果 |
| --- | --- |
| 当前后端/评测器 | 未知信息修复 `1a673d4`、评测器 `a7f71c4`；此前源代码审查阻断关闭，新增缺失信息 guard 的独立复核也 CLEAR |
| 完整工程测试 | 修复实现者在当前代码运行完整测试：208 项通过，零失败/跳过/取消，13.38 秒；协调者读取原始日志，独立复核亦已检查 |
| 语法/JSON | `npm run check`：67 个 JavaScript 模块通过；手机 CSS 先前已实屏验证 |
| 真实运行环境 | `npm run build:agh-runtime`、`npm run verify:agh-runtime` 成功；公开 SDK，5 个受限业务工具、3 个明确受信任且 ready 的 Skill |
| 固定源与资产 | 上游 `7819b23c249fe47ce14bd89e3982e17986e3e197`；产品资产 `10bed8c45398820ee485`；provider `agnes-ai`，model `agnes-3.0-flash` |
| 最终真实 UI | W1/W2/W3、原文先保存/人工确认、跨端事实/事项版本、无关更正后医嘱保留、旧卡复制过期标识通过 |
| 真实恢复 | W2 一次上游 TRANSPORT 失败后保留原文/旧卡/失败记录；一次明确的同来源新运行完成；不计入 V2 |
| 手机布局 | CSS-only `eb5932d`；359px 重载后返回/标题横排可读，业务表单按钮不受影响 |
| 电脑布局 | 1280px 显示同一后端的两个事项，保留“每日/三天后”、事实引用和任务版本 |
| 当前预览 | 修复后重启：同一个本地服务 `127.0.0.1:4173`，exec54632/PID49582，独立合成 `.runtime/healththread-domain.sqlite`；协调者重新只读检查 `/web/`、`/mobile/`、`/api/health`，均实际 HTTP 200，未新增模型调用 |
| 调度状态 | 最终 `/api/health` 报告 ready、未暂停、零连续失败；这只是当前运行状态，不代表模型 SLA |
| 桌面副本 | `/Users/fancyouth123/Desktop/HealthThread-Backend-Dev` 已删除、已验证不存在；当前仓库/原始附件保留 |
| V2 批量评测 | 准确人类授权后唯一实跑：24 主尝试、24 原文保留、12 真实主闭环、strict各6/24、12 TRANSPORT；8 care未执行，日程质量未评测，具体 [V2 记录](../validation.v2.md) |
| 版本边界 | V2测量 `cf632b9`；2处缺失信息校验缺口后来在 `1a673d4` 修复，7/7专项、208/208全套并独立复核；无修复后实跑分数，无重跑/改gold |
| 结果一致性复核 | 独立只读审查重新离线计算，原运行汇总/portable聚合完全一致，冻结哈希、首次输出、失败分母及care未测边界核对 CLEAR；未调用模型 |

工程测试使用合成资料、独立数据库、动态 loopback HTTP、真实 SIGKILL 与 scripted provider。它们不是模型准确率。公开 SDK 构建用实际固定 AGH 依赖，零跳过；Node SQLite 的已知实验性警告保留。当前修复的原始完整日志保存在 `.runtime/acceptance/post-evaluation-tests.log` 和 `post-evaluation-check.log`；先前201项检查仍保留 `final-tests.log` / `final-check.log`。来源修复与独立证据见 [实现](missingness-fix.md) 和 [复核](missingness-review.md)。

真实浏览器操作、阶段性缺口及最终修复结果见 [浏览器验收](browser-acceptance.md)，已完成的独立审查见 [记录索引](README.md)。[桌面事项截图](../evidence/desktop-shared-tasks.png) 和 [手机页头截图](../evidence/mobile-header-fixed.png) 都来自本地真实合成数据界面，未编辑像素。临时 viewport override 已复位，双端预览保留。

本轮未完成 PDF 原生文件选择器自动化与实际 OS 打印；PDF HTTP/文本解析/故障/删除竞态已有工程覆盖。D01/D02 未配置，OCR/音频/语音未支持；删除仍报告 partial，因为轨迹、备份和存储残留未认证擦除。有限原文校验和 AI 辅助合成标签不证明临床正确性，正式事实仍由用户核对。
