# HealthThread 双端与共享后端

电脑版和手机版是两套独立的 HTML/CSS/JavaScript 界面。它们共用 Node 业务服务、SQLite 演示档案和公共 API 适配层；模型请求统一经 Agnes Harness 的公开 Node SDK，使用 AGH 中配置的 Agnes 模型。

## 启动

需要 Node.js 24.10 或更新版本。基础模式没有 npm 外部依赖，直接运行：

```sh
npm start
```

打开 http://127.0.0.1:4173/ 选择界面：

- 电脑版：http://127.0.0.1:4173/web/
- 手机版：http://127.0.0.1:4173/mobile/
- 后端状态：http://127.0.0.1:4173/api/health

Windows 可运行根目录的 Start.cmd。Node 当前版本可能提示 node:sqlite 为实验性功能；本仓库用于比赛原型。

本地两个页面共享服务端演示档案。手机设备演示可用 `HOST=0.0.0.0 npm start`，在同一局域网访问电脑 IP。手机上的 127.0.0.1 指向手机自身。此服务尚未实现用户登录，局域网模式仅使用合成演示资料。

## 目录和分工

```text
apps/web/          电脑版页面、交互和素材
apps/mobile/       手机版页面、交互和素材
packages/client/   两端共用的 API、状态同步和合成资料
services/api/      同源静态服务、SQLite、任务和 AGH 接入
contracts/         当前接口协议及后续字段级接口边界
agents/            Harness 固定版本、Skills 和工具接入说明
scripts/           启动、SDK 构建、检查
tests/             HTTP、同步和 SDK 边界测试
docs/              设计、实施计划、来源和后续 pipeline
```

两套界面各自修改页面，公共协议变更同时更新 contracts、后端、packages/client 和测试。手机版不再引用电脑版的 src 目录。

## 当前可用能力

- 一个 SQLite 演示档案供两端读取、保存和同步；页面空闲时自动刷新，编辑时暂缓刷新。
- 写入携带 expected_revision；冲突和网络失败保留本地草稿，不自动覆盖较新版本。
- 服务重启保留资料；空档案和删除状态不自动补回示例病历。
- 同源请求和受限静态目录；后端源码、数据库和 .env 不作为静态文件提供。
- AI 请求返回任务编号，再查询状态和结果。未配置 AGH 时明确返回 AGENT_NOT_CONFIGURED。
- 可选 AGH SDK 适配器处理聊天、日常文字提取、病历文字和表达稿；检查 provider、结束状态、JSON 结构和日期。

保留的模拟病历按钮和初始沟通卡均为合成示例。复制、打印和已有本地核对交互继续保留。

## 连接 Agnes Harness 和 Agnes

AGH 独立运行，代码不复制进本仓库。固定源码提交见 agents/harness.lock.json；当前接口基线为 `7819b23c249fe47ce14bd89e3982e17986e3e197`。在该 AGH checkout 中按官方文档安装依赖、构建 CLI、启动实例，并配置 `agnes-ai` provider 和允许的 Agnes 模型。

1. 把本仓库登记为 AGH workspace。SDK session.new 不会代替 workspace 登记。
2. 按需要创建并审阅健康任务 preset，限制与该原型无关的工具。
3. 复制 `.env.example` 为 `.env`，填写下列配置：

```dotenv
AGENT_MODE=agnes
AGH_ROOT=/absolute/path/to/agnes-harness
AGH_HOME=/absolute/path/to/the/same/agh-home
```

AGH_HOME 必须与运行实例一致；也可以提供 AGH_SOCKET_PATH 或服务端 AGH_SDK_OPTIONS_JSON。可选 AGH_PRESET 指定已审阅的 preset。模型密钥只在 AGH 配置，本项目不另直连模型服务。

启动脚本使用 AGH workspace 的 esbuild 从公开 `@agnes/sdk` 包入口构建适配产物，输出到被 Git 忽略的 `.runtime/`。会检查固定提交版本；禁止跨包导入私有源码路径。首次模型请求会检查 Agnes provider，并将文本执行槽设置为该 Agnes 模型。所需工具审批默认拒绝，不自动授权命令或文件写入。

自动化测试使用明确的 SDK 边界 fixture，不消耗模型额度，也不证明真实模型效果。需要按上述配置单独执行合成输入冒烟测试，核对返回的 agh.session_id 与 AGH 实际轨迹。

## 当前边界和下一步

这次交付是双端组织、共享后端骨架和 SDK 接入基础。`/api/state` 仍保存既有原型的整体状态，不是最终医疗事实接口。用户账号隔离、字段级候选确认与事务、逐字段证据支持、PDF 文本提取、完整 W1/W2/W3 工具工作流、医嘱事项数组及完整轨迹删除尚需实现。当前 PDF 上传会明确报不支持，不伪造解析。

已有核对、日期更正和事项交互仍使用原型规则；它们不是医学判断或已完成的正式确认 API。Agent 文字产物经过结构校验，但事实和医嘱的逐字段证据校验尚未完成。仅使用合成资料演示。

## 验证

```sh
npm test
npm run check
# 已安装固定 AGH 源码时，额外验证真实 SDK 构建与加载：
# AGH_ROOT=/absolute/path/to/agnes-harness npm test
```

测试覆盖两个静态入口、SQLite 重启、并发版本冲突、空档案删除、来源请求限制、未配置 AI、异步结果、客户端草稿保护、Agnes provider 和未完整模型输出。原压缩包中的 Windows Edge 检查脚本不作为本仓库的验证结果。

运行数据位于 `.runtime/`，不要提交数据库、模型凭证、真实病历或 AGH Home。上传来源与保留素材见 docs/frontend-source.md。
