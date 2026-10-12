# 双端动作盘点

盘点基线744faa9（正式领域接入前）；完成状态由 Task3/4 更新。本表只描述原型代码，不能作为新后端验收证据。

|页面/动作|电脑原型|手机原型|目标领域路径与语义|
|---|---|---|---|
|首页记文字|src/app.js saveRecord/requestAgent|app.js addRecord/requestAgent|POST entries，原文接收回执→run，待核对不自动生效|
|核对字段|本地记录 confirmedFields|本地 checkedFields|GET fact-change 展示候选/引用→POST confirm CAS+幂等|
|纠错与撤回|本地覆盖记录|本地日期/字段更新|事实 change-requests 新来源/版本，不改原文|
|就诊困扰/历史选择|visit-preparations 旧 record_ids|visit-preparations 旧 record_ids|selected_source_ids 用户受控；卡含 claims/dependencies/stale|
|病历粘贴/上传|medical-document prompt JSON|medical-document/文件415|POST documents 真上传/提取页码→候选→核对→continuation|
|诊后事项|单个 medical.task/taskStatus|单个 medical.task/taskStatus|多个 care-tasks，每条已确认医嘱原文与版本化 PATCH|
|出处查看|内存记录/病历原文|内存记录/病历原文|鉴权 sources API，后端固定文本/定位|
|授权|本地布尔值|本地布尔值|按purpose/version服务端核验；撤回取消旧scope|
|导出/删除|整体state/浏览器本地|整体state/浏览器本地|API 用户隔离+真实清理层回执；AGH清理不足partial|
|账号|固定示例人物|固定示例人物|显式演示登录；注销清内存/草稿，CSRF+cookie|
|双端同步|whole state revision PUT|whole state revision PUT|只读领域投影+版本化动作，禁止整个state写入事实|
|科室/观察/语音|部分固定建议/浏览器入口|部分固定建议/浏览器入口|D01/D02not_configured，音频/OCRunsupported，同源capabilities|

原型 assets/布局保留，导入主目录相对路径继续有效。所有生成/正式提交动作必须迁移；sample preview 需明确 fixture，不能上传为本人正式事实。
