# HealthThread：两套界面，一个可追溯后端

电脑版 `/web/` 与手机版 `/mobile/` 共用同源 Node ESM + SQLite 领域 API。登录会话决定用户身份；原文先保存，Agnes 只暂存候选，正式事实必须由用户核对汇总后回复确认，或在时间线逐项选择提交。更正、撤回和删除使依赖的沟通卡/事项过期。

界面已按用户纠正恢复为上传的两套原页面，保留原布局/样式，仅在原按钮和数据层接入领域 API；先前的共享替代界面已停用。[恢复说明与验证](docs/backend/reviews/native-frontend-restoration.md)。

## 在另一台电脑从零运行

需要 **Node.js 24.10 或以上版本、npm、Git**，并能访问 GitHub、npm registry 和 Agnes 模型服务。安装前用 `node --version`、`npm --version`、`git --version` 检查。Harness 使用锁定的 `pnpm`，安装脚本会自动获取，不要求全局安装 Agnes 或 pnpm。

```sh
git clone --branch codex/healththread-agh-v1-20261013 https://github.com/Fancy0uth/health.git
cd health
npm run setup
npm run configure:agh
npm run verify:agh-runtime
npm run verify:chat
npm start
```

按顺序执行，某一步失败先解决该步，不要跳过。

1. **安装**：`npm run setup` 下载 `agents/harness.lock.json` 固定版本的官方 Harness，安装其锁定依赖，再构建项目运行包。首次创建权限受限的 `.env`，终端显示本机网页账号 `demo` 和随机密码；也可在自己的 `.env` 查看。已有 `.env`、Harness 改动和账号不会被覆盖。
2. **配置模型账号**：`npm run configure:agh` 输入你自己的 **Agnes API key**（终端不回显），选择服务实际返回的可用模型，再输入 `yes` 保存。需要具有有效凭据及可用额度的 Agnes 账号；项目不附带可共享的模型密钥。密钥经 Agnes 官方配置接口存入本机凭据库，不写入网页、Git 或 `.env`。本版本向导支持 Agnes API key，不提供账号注册。
3. **检查运行环境**：`verify:agh-runtime` 检查模型配置、Harness、Skills 和业务工具，**不调用模型**。它通过不代表额度或实际推理已经通过。
4. **检查真实对话**：`verify:chat` 调用与网页相同的聊天 API，发送一条合成消息，检查真实模型回复和 SDK 工具回执。会产生少量模型调用费用；使用独立测试数据库，不向你的健康记录插入测试消息。失败会以非零状态退出，日志位于 `.runtime/evidence/`。
5. **启动和登录**：`npm start` 后打开下面两端，用安装时显示的**网页账号**登录。进入“设置 → 授权管理”开启健康记录整理，再回到首页提问。网页账号与 Agnes API key 是两回事，不要把 API key 输入网页密码框。

- [电脑版](http://127.0.0.1:4173/web/)
- [手机版](http://127.0.0.1:4173/mobile/)
- [服务状态](http://127.0.0.1:4173/api/health)

两端共用同一端口、账号和数据库。默认仅绑定本机 `127.0.0.1`；这里的手机版是手机界面预览，不自动开放给局域网手机。仅使用合成资料测试。文本 PDF 解析另需 Poppler 的 `pdfinfo` / `pdftotext`，纯文字聊天不需要它。Node 的 `node:sqlite` 实验性提示本身不是失败。

### 默认目录与已有配置

无需填写任何人的电脑路径。默认目录均位于当前项目：

| 用途 | 默认位置 |
| --- | --- |
| 固定版本 Harness 源码和依赖 | `.runtime/agnes-harness` |
| Agnes 账号凭据库 | `.runtime/agh-account`，profile 为 `local-dev` |
| 项目 Host、会话及构建文件 | `.runtime/agh-home`、`.runtime/agh-dist` |
| 网页账号及本地设置 | `.env` |
| 健康数据 | `.runtime/healththread-domain.sqlite` |

已有外部 Harness/账号可以在 `.env` 设置 `AGH_ROOT`、`AGH_ACCOUNT_HOME`、`AGH_ACCOUNT_PROFILE`；相对路径统一相对于项目根目录。旧 `AGH_HOME` 仍兼容。不要把账号目录、源码目录和 `HEALTHTHREAD_AGH_HOME` 设成同一目录或相互包含。**不要提交或共享 `.env`、`.runtime`、数据库及凭据目录。**

如果以前复制过 `.env.example`，安装会保留该文件。删除其中旧的示例路径或改为自己的路径，并设置 `HEALTHTHREAD_DEMO_AUTH=1`、网页用户名和至少 10 字符的密码。模型账号已配置时，向导会停止并保留配置；需要独立模型账号时设置一个新的 `AGH_ACCOUNT_HOME`，重新运行配置与检查。

### 常见问题

| 现象 | 处理 |
| --- | --- |
| GitHub/npm 下载失败 | 检查网络、代理和仓库访问权限，重新运行 `npm run setup`；不会清空已有源码 |
| Harness 版本不符或源码有改动 | 保留现有工作，将 `AGH_ROOT` 指向一个新的不存在目录，再运行安装；不要直接重置别人的目录 |
| `AGH_SOURCE_MISSING` / 缺少依赖 | 运行 `npm run setup` |
| `AGENT_NOT_CONFIGURED` | 运行 `npm run configure:agh`，检查账号目录和 profile 是否一致 |
| 已配置但 `verify:chat` 失败 | 检查 Agnes 凭据、额度、模型权限和网络；环境就绪检查不会验证实际推理 |
| 网页不能登录 | 使用本机 `.env` 的网页账号，检查 `HEALTHTHREAD_DEMO_AUTH=1`；其他电脑的测试账号不会自动同步 |
| 登录后提示尚未授权 | 在网页设置中开启健康记录整理 |
| 端口 4173 被占用 | 停止旧服务，或在 `.env` 修改 `PORT`，按启动时显示的新地址访问 |

默认 `AGENT_MODE=agnes`：模型环境初始化失败时启动直接退出并给出配置步骤，避免把不能聊天的网页误认为运行成功。只有明确设置 `AGENT_MODE=disabled` 才进入无需模型的界面/数据调试模式；该模式不能与模型对话。

## AGH 配置与边界

固定 AGH 提交为 `7819b23c249fe47ce14bd89e3982e17986e3e197`，见 [harness.lock](agents/harness.lock.json)。`AGH_ROOT` 指向已安装依赖的干净源码；构建只读该 checkout，将产品构建产物写入 `.runtime/`。账户凭据留在独立的 `AGH_ACCOUNT_HOME`，`AGH_ACCOUNT_PROFILE` 默认 `local-dev`。旧 `AGH_HOME` 仅作为账户路径别名。`HEALTHTHREAD_AGH_HOME` 是可选的产品运行目录，必须与账户/源码目录分离。

产品运行 workspace 只安装已审阅的四个 Skills 和五个受范围限制的业务工具；没有任意 shell、文件、网络或子 Agent 权限。审批、工具 schema、真实来源/授权/epoch/版本检查共同限定写入。开发提示词不进入产品 workspace。实际 SDK session、seq 和业务回执才作为真实模型证据。

## 三个工作流

1. W1：首页记录身体感受 → 原文保存为同一记录会话的草稿 → Agnes 读取本轮和历史补充、整理候选及追问 → 聊天展示完整待确认汇总 → 用户回复“确认”/“确认记录”，或稍后在健康时间线逐项确认 → 事实、人工回复、审计与回执同事务提交。补充后旧汇总失效，原文和历史汇总仍保留。
2. W2：当前困扰与授权资料 → 有来源的逐句表达稿、问题、未知项 → 沟通卡。事实变化后卡片 `stale`。
3. W3：粘贴资料或文本层 PDF → 带原文/页码的候选 → 用户确认 → 独立已确认医嘱接续 → 多个版本化事项。部分确认只使用选中的医嘱；没有医嘱可产生空事项与说明。

首页“向助手提问”使用独立的 `health-assistant` Skill：读取问题 → 检索授权上下文 → 暂存 `assistant_reply`。问题和回复从后端重建，多轮会话共享，提问不生成医生沟通卡或自动确认事实。回复中的产品引导语由界面提供，引用原句与追问来自经工具校验的模型产物；只有实际 SDK 回执闭环后才显示“AGH 回执已核验”。

候选值保留完整原句、否定/既往/不确定性与原文时间。逐字证据和 schema 校验只能证明指定机械约束；人工核对仍必需。科室 D01 / 观察分级 D02 未配置；OCR、音频和语音不支持。

`GET /api/state` 仅为领域对象投影，`PUT` 返回405。账号、CSRF、幂等回执、资料/事实版本及 `X-HealthThread-Epoch` 共同处理跨端竞争和删除后的迟到输入。未知旧请求不能自动升级 epoch。全部删除才增加 `all_clear_epoch`，其他会话据此清理旧健康草稿。导出只含当前用户；删除提供各层回执，AGH 轨迹、备份和磁盘残留无法认证擦除时显示 `partial`。

## 验证与验收

2026-10-13 记录聊天与确认修复：240 个测试通过、零失败，1 个旧 SDK 条件测试跳过；当前真实 Host/SDK 工具测试已通过。双端浏览器验收完成两轮真实 Agnes 对话、手机聊天回复确认、时间线稍后确认、首页待核对入口，以及过期核对保留勾选后刷新提交。真实调用仅使用独立合成账号，2 轮记录工作流，不重跑冻结评测；原 CSS/HTML 未变。详细范围与证据见 [修复记录](docs/backend/plans/record-dialogue-repair.md)。

```sh
npm test
npm run check
node --test tests/faults/*.test.mjs
# 具备固定 AGH 源码时验证公开 SDK 构建：
AGH_ROOT=/absolute/path/to/agnes-harness node --test tests/sdk-build.test.mjs
```

当前后端 `1a673d4` 工程验证为 **208/208，通过且零失败、零跳过**，语法/JSON 检查通过 67 个模块；scripted provider / fixture 不是模型质量证据。双端真实 W1/W2/W3、事项版本同步、无关更正后医嘱依赖保留、旧卡复制过期标识及一次传输失败恢复见 [浏览器验收](docs/backend/reviews/browser-acceptance.md)。手机子页标题另经 359px 实际截图验证。

历史 V1 的 12开发 +12留出评估见 [历史验证](docs/backend/validation.md)。用户[明确授权](docs/backend/reviews/evaluation-v2-authorization.md)后，V2 已完成唯一一次 24 例实跑：原文保存 24/24，真实主闭环 12/24，严格全字段匹配 6/24，12 例 TRANSPORT 失败均留在分母。8 个预选医嘱续接均未满足固定确认条件，未执行，日程质量未评测。完整 [V2 报告](docs/backend/validation.v2.md) 区分了 4 个范围标签差异与 2 个未知信息校验缺口；后者已在 `1a673d4` 修复并独立复核。这批分数属于修复前 `cf632b9`，未重跑，不代表修复后模型表现。冻结标签为独立 AI 辅助开发者合成标注，未经临床专家复核。

详细验收操作见 [runbook](docs/backend/runbook.md)，接口见 [OpenAPI](contracts/openapi.yaml)，故障范围见 [fault-matrix](docs/backend/fault-matrix.md)。所有运行数据库、凭据和原始 SDK 证据保存在被忽略的 `.runtime/` / `.env`，不要提交真实健康资料。

旧原型 SQLite/浏览器历史不会自动导入新的领域模型，也不属于当前用户删除的对象。代码通过 feature 分支交付；本地运行不等于已部署公网服务。

## 无终端配置的评委版

评委发行包内置 Agnes Harness 与 Node.js，解压后双击启动，在浏览器里填写 Agnes API Key、验证连接和选择模型。支持 Windows x64、macOS Apple Silicon 与 Intel 三种包。使用与排错步骤见 [评委版使用说明](docs/distribution/评委版使用说明.md)。维护者运行 `npm run package:judge` 生成发行包；`npm run start:judge` 可在本机体验相同的配置流程。
