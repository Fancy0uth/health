# 双端接入 Agent prompt

路径约定：先读取 `agents/development/PATHS.md`。本文件中的项目路径均从当前工作树的 Git 根目录解析；AGH 源码路径从已核验的 AGH_ROOT 解析。子 Agent 使用自己的工作树，不能把主目录或保留项目目录当作写入目标。

你负责把已经完成的两套 HealthThread 界面接到同一个正式业务后端。保留 apps/web 与 apps/mobile 的独立页面、CSS、素材和交互风格。先读总控给出的当前 SHA、已冻结 OpenAPI/schema、frontend-action-map.md，以及 PRD F01/F03/F04/F05/F06/F07。

先读 agents/development/rubric-engineering.md 和apps/web/index.html、apps/web/styles.css、apps/web/ui.css、apps/mobile/index.html、apps/mobile/styles.css，再沿 import 读交互和状态代码；不要只根据 PRD 猜页面。重点落实 E01/E02/E11/E14/E15/E18–E20/E22 的用户可观察状态与恢复动作。

仅编辑分配给你的 apps/web/src/app.js、apps/mobile/{app,store}.js、packages/client/** 和对应前端/客户端测试。公共后端/contract/preset/package.json 不改。共享 client 与两端交互由你单独写，不能另派两个 Agent 同时改同一适配层。

当前 api.js 支持异步 run 轮询，data.js/state-client.js 是整体 legacy state 的同步和草稿保护；不要把这些原型行为当成正式确认/更正/删除已存在。特别检查 mobile/store.js 的关键词 issue 归类、候选日期、prepareVisit、默认医疗资料和假卡，以及 desktop 的对等模板路径。

依次接线：
1. session/me/capabilities；同一个账号在两端读同一资料，账号切换清理缓存但保留用户可处理的未提交草稿，不把上一账号草稿发到下一账号。
2. 录入调用 POST /api/entries；呈现“原文已保存/分析中/待核对/失败”。分析失败保留原文；草稿不能被后台刷新覆盖；不在 client 擅自打“已核对”。
3. 核对页展示 atomic before/after、原文定位、日期 raw/未知、不确定项、冲突；确认 expected_profile_revision + Idempotency-Key。409 保留选择、重新取最新，不循环自动覆盖；重试同一操作复用 key。
4. 来源查看、时间线、事实版本与更正/change-request；不能在 client 直接改事实 JSON 后 PUT /api/state。缓存只用于展示，服务端版本最终裁决。
5. W2 当前困扰/相关历史选择 → run → 卡、表达稿、问题、未知与来源；过期卡标 stale，重生成显式操作。文本编辑不修改事实。科室/观察 feature gate 不可用时撤去现有假推荐并解释原因。
6. W3 支持的真实文件/粘贴文本、上传状态、解析差异、核对回执、多事项列表及 done/paused/feedback API；无文本 PDF/不支持格式明确失败。演示病历保留在明确示例入口，不假装处理了用户文件。
7. 授权、导出、删除使用服务器范围/结果。删除取消相关 run，清缓存/epoch，晚响应不能恢复资料；partial deletion 显示未完成层，不用“本地清空”替代。
8. 聊天只引导到业务流程，临床/来源/版本边界与主流程一致；任何残留基于关键词的事实/治疗建议要移除或明确合成演示。复制/打印仅导出当前明确选定版本，过期提示随产物显示。

支持 run needs_review：结果可取但事实尚未生效。run failed/interrupted/blocked/cancelled 与已保存数据分别显示，不因 HTTP 202 或无 error 就显示成功。两端状态中文文案对应同一语义。

异常状态必须提供对应恢复：保存失败保草稿/重试、保存成功分析失败显示原文与已有 entry/run、409 保留选择并读取最新、依赖未配置解释 capability、超时/取消说明已有效果、partial 删除列未完成层。poll 有界 backoff/deadline/Abort，身份失效停止旧请求；未知确认结果先用同 key 取回执，不反复生成新提交。

保护现有回归：未失焦草稿不被轮询覆盖；in-flight read 不抹草稿；刷新后草稿恢复但不静默重放；退出/删除/账号切换后旧任务 epoch 不匹配拒绝。HTML 渲染必须转义模型/用户文字，不能把模型输出当 HTML 注入。

验收实际用户动作：手机新增→电脑核对→手机新版本；电脑更正→手机旧卡过期；手机上传→电脑差异确认→两端同样多事项；两个账号互不见资料；断网/409/分析失败/取消/删除晚响应；浏览器刷新/服务重启持久化。使用实际两个 UI，不只调用 HTTP 或改 localStorage 截图。

实际浏览器能力不足时给人工步骤并标 manual_only/not_run，不能报告 UI 全通过。问题价值用上述真实旅程和可观察的整理/核对步骤体现，不编节省百分比或临床改善；保留来源/失败/过期提示随复制与打印产物呈现。

回报 commit SHA、每个页面动作到 API 的映射、测试命令与结果/截图索引、兼容迁移遗留、未完成项。不要重做整套视觉设计来掩盖后端接入缺口。
