# HealthThread：两套界面，一个可追溯后端

电脑版 `/web/` 与手机版 `/mobile/` 共用同源 Node ESM + SQLite 领域 API。登录会话决定用户身份；原文先保存，Agnes 只暂存候选，正式事实必须由用户逐项核对并提交。更正、撤回和删除使依赖的沟通卡/事项过期。

## 本地启动

需要 Node ≥24.10；文本层 PDF 需要 Poppler 的 `pdfinfo` / `pdftotext`（支持 `/opt/homebrew/bin`、`/usr/local/bin`、`/usr/bin`）。Node 会报告现有 `node:sqlite` 实验性警告。

```sh
cp .env.example .env
# 编辑 .env：显式开启合成演示登录、填写账号，并选择已配置的 Agnes 账户位置
npm run build:agh-runtime
npm run verify:agh-runtime
npm start
```

两端使用同一个监听端口和数据库：

- [电脑版](http://127.0.0.1:4173/web/)
- [手机版](http://127.0.0.1:4173/mobile/)
- [服务状态](http://127.0.0.1:4173/api/health)

`AGENT_MODE` 默认 `agnes`。产品只调用 AGH 配置的 `agnes-ai` provider；未就绪时保存输入并给出 `blocked`，不会切换模型或用模板冒充真实输出。`AGENT_MODE=disabled` 可检查保存/登录/错误恢复。未显式设置 `HEALTHTHREAD_DEMO_AUTH=1` 与演示账号时登录不可用。仅使用合成资料演示。

当前验收环境使用专门的本地合成账号 `demo` / `healththread-demo-2026`，不写入代码默认值；这是演示账号，不连接真实患者。其他机器应在被忽略的 `.env` 中自行设置并保护文件权限。服务绑定 `127.0.0.1`；局域网/TLS 部署未在本次验收范围内。

## AGH 配置与边界

固定 AGH 提交为 `7819b23c249fe47ce14bd89e3982e17986e3e197`，见 [harness.lock](agents/harness.lock.json)。`AGH_ROOT` 指向已安装依赖的干净源码；构建只读该 checkout，将产品构建产物写入 `.runtime/`。账户凭据留在独立的 `AGH_ACCOUNT_HOME`，`AGH_ACCOUNT_PROFILE` 默认 `local-dev`。旧 `AGH_HOME` 仅作为账户路径别名。`HEALTHTHREAD_AGH_HOME` 是可选的产品运行目录，必须与账户/源码目录分离。

产品运行 workspace 只安装已审阅的三个 Skills 和五个受范围限制的业务工具；没有任意 shell、文件、网络或子 Agent 权限。审批、工具 schema、真实来源/授权/epoch/版本检查共同限定写入。开发提示词不进入产品 workspace。实际 SDK session、seq 和业务回执才作为真实模型证据。

## 三个工作流

1. W1：文字原文保存 → 读取/上下文 → 候选 `needs_review` → 用户选择确认 → 事实与审计/回执同事务提交。
2. W2：当前困扰与授权资料 → 有来源的逐句表达稿、问题、未知项 → 沟通卡。事实变化后卡片 `stale`。
3. W3：粘贴资料或文本层 PDF → 带原文/页码的候选 → 用户确认 → 独立已确认医嘱接续 → 多个版本化事项。部分确认只使用选中的医嘱；没有医嘱可产生空事项与说明。

候选值保留完整原句、否定/既往/不确定性与原文时间。逐字证据和 schema 校验只能证明指定机械约束；人工核对仍必需。科室 D01 / 观察分级 D02 未配置；OCR、音频和语音不支持。

`GET /api/state` 仅为领域对象投影，`PUT` 返回405。账号、CSRF、幂等回执、资料/事实版本及 `X-HealthThread-Epoch` 共同处理跨端竞争和删除后的迟到输入。未知旧请求不能自动升级 epoch。全部删除才增加 `all_clear_epoch`，其他会话据此清理旧健康草稿。导出只含当前用户；删除提供各层回执，AGH 轨迹、备份和磁盘残留无法认证擦除时显示 `partial`。

## 验证与验收

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

旧原型 SQLite/浏览器历史不会自动导入新的领域模型，也不属于当前用户删除的对象。仅本地 feature 分支交付；未推送、部署或合并。
