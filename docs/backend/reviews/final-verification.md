# 最终工程与本地验收检查

2026-10-12，当前仓库 `/Users/fancyouth123/Documents/ChatGPT/expressforpatient`，本地分支 `codex/healththread-shared-backend`，基线 `744faa9`。状态：**代码可验收；新 V2 批量实跑等待明确授权**。未推送、合并或部署。

| 检查 | 实际结果 |
| --- | --- |
| 最终后端/评测器 | 领域代码 `8ba8460`、评测器 `a7f71c4`，所有已知 Critical/Important 审查阻断已关闭 |
| 完整工程测试 | `node --env-file-if-exists=.env scripts/test.mjs` 在 `a7f71c4`：201 项通过，零失败/跳过/取消，13.57 秒 |
| 语法/JSON | `npm run check`：66 个 JavaScript 模块通过；手机 CSS 修复另执行该检查并实屏验证 |
| 真实运行环境 | `npm run build:agh-runtime`、`npm run verify:agh-runtime` 成功；公开 SDK，5 个受限业务工具、3 个明确受信任且 ready 的 Skill |
| 固定源与资产 | 上游 `7819b23c249fe47ce14bd89e3982e17986e3e197`；产品资产 `10bed8c45398820ee485`；provider `agnes-ai`，model `agnes-3.0-flash` |
| 最终真实 UI | W1/W2/W3、原文先保存/人工确认、跨端事实/事项版本、无关更正后医嘱保留、旧卡复制过期标识通过 |
| 真实恢复 | W2 一次上游 TRANSPORT 失败后保留原文/旧卡/失败记录；一次明确的同来源新运行完成；不计入 V2 |
| 手机布局 | CSS-only `eb5932d`；359px 重载后返回/标题横排可读，业务表单按钮不受影响 |
| 电脑布局 | 1280px 显示同一后端的两个事项，保留“每日/三天后”、事实引用和任务版本 |
| 当前预览 | 同一个本地服务 `127.0.0.1:4173`，独立合成 `.runtime/healththread-domain.sqlite`；`/web/`、`/mobile/`、`/api/health` 均实际 HTTP 200 |
| 调度状态 | 最终 `/api/health` 报告 ready、未暂停、零连续失败；这只是当前运行状态，不代表模型 SLA |
| 桌面副本 | `/Users/fancyouth123/Desktop/HealthThread-Backend-Dev` 已删除、已验证不存在；当前仓库/原始附件保留 |
| V2 批量评测 | 自动批准审核在进程创建前拒绝；0 次推理、24 例 not_run、没有模型质量结果；具体 [V2 记录](../validation.v2.md) |

工程测试使用合成资料、独立数据库、动态 loopback HTTP、真实 SIGKILL 与 scripted provider。它们不是模型准确率。公开 SDK 构建用实际固定 AGH 依赖，零跳过；Node SQLite 的已知实验性警告保留。完整本地日志位于 `.runtime/acceptance/final-tests.log` 和 `final-check.log`。

真实浏览器操作、阶段性缺口及最终修复结果见 [浏览器验收](browser-acceptance.md)，已完成的独立审查见 [记录索引](README.md)。[桌面事项截图](../evidence/desktop-shared-tasks.png) 和 [手机页头截图](../evidence/mobile-header-fixed.png) 都来自本地真实合成数据界面，未编辑像素。临时 viewport override 已复位，双端预览保留。

本轮未完成 PDF 原生文件选择器自动化与实际 OS 打印；PDF HTTP/文本解析/故障/删除竞态已有工程覆盖。D01/D02 未配置，OCR/音频/语音未支持；删除仍报告 partial，因为轨迹、备份和存储残留未认证擦除。有限原文校验和 AI 辅助合成标签不证明临床正确性，正式事实仍由用户核对。
