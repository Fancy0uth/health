# 提示词包核验记录

核验日期：2026-10-12。任务为编写后端实施 prompt 与多 Agent 设置；本次未实现新的产品后端功能、未安装插件/Skills、未调用付费模型、未改 AGH 源码。

## v0.1 初次核验（历史记录）

1. 通过固定版 AGH `7819b23c249fe47ce14bd89e3982e17986e3e197` 的公开 `@agnes/protocol.validatePreset` 验证两份 PresetDoc。
2. 将公开 `@agnes/base.presets`、`@agnes/code.presets` 与两份模板组成验证用目录，通过公开 `@agnes/host.resolvePreset` 解析后，再用 validatePreset 验证继承结果：
   - base → standard → healththread-dev：depth=1、fan_out=2、worktree、aggregate、max_steps=36。
   - base → standard → healththread-runtime：depth=0、fan_out=0、shared、aggregate、max_steps=12、core=[]、repair.max_rounds=2。
3. 通过 `validateProfileManifest` 验证 README 的两组 profile 选择片段（含 name:local-dev，产品 computerUse.enabled=false）。
4. PRD 副本与原文件逐字节相同，SHA-256 与来源记录相同。
5. 七个 prompt 文件均存在；九份提示词/说明 Markdown 的代码围栏配对检查通过。
6. `npm run check` 通过：21 个已有 JS 模块语法与所扫描 JSON 正确；`git diff --check` 通过。没有对未修改的产品功能重复宣称新的业务测试结果。

公开包导出经 AGH workspace 的 package.json 解析，使用已安装 tsx 加载；没有跨包导入私有实现验证。继承测试必须包含 @agnes/base：standard.extends=base，只读 @agnes/code 的目录不完整。

## 已查证的实现限制

- @agnes/code 的 PRESET_NAMES 决定该固定源码加载哪些 recipe；模板文件不会因放进项目而注册。两份定义仅在验证用目录中加入，**没有装配到运行中的 daemon**。
- 普通 subagent 扩展 index.ts 的默认入口为空，但 packages/base/src/ecosystem.ts 的 Host 装配会注入真实 limits 并注册工具；不能只检查空入口断言功能不可用。
- 工具参数源为 subagent_spawn(task/model/isolation/budget)、collect(childKey/wait)、cancel(childKey)；worktree 返回可能降级 shared；collect 不自动合并代码。
- doctor subagents 是维护候选只读查询，不能证明某会话工具可用；该固定版本 --repair 不自动修复。
- 固定源码默认树额度为 20 credits，standard 继承 per_request_cap=4000；模板没有将它们当作团队批准的费用预算。实际运行需核对 provider 报价与额度。
- 产品模板 core=[]、子任务=0 仍不等于全局工具/Skill 白名单；实际目录、角色与 scope 隔离必须由后续实现验证。
- protocol 的实际模型槽为 primary/escalation/fast/compaction/verifier/image/video。文档中的 CLI main 示例不能替代实际槽枚举；本包启动命令没有使用该别名。

## 后续执行必须另行证明

真实 preset 装载、模型槽路由、工具/Skill 安装信任/ready、开发 worktree 并发限制、产品工具隔离、W1–W3 实现、领域事务与两端动作、真实 Agnes 运行和 AGH 轨迹。校验通过只是文件与继承合法，不代表这些工作已经完成。

源码入口：[preset schema](https://github.com/AgnesAI-Labs/agnes-harness/blob/7819b23c249fe47ce14bd89e3982e17986e3e197/packages/protocol/schema/preset.json)、[preset loader](https://github.com/AgnesAI-Labs/agnes-harness/blob/7819b23c249fe47ce14bd89e3982e17986e3e197/packages/code/src/presets/load.ts)、[Host ecosystem](https://github.com/AgnesAI-Labs/agnes-harness/blob/7819b23c249fe47ce14bd89e3982e17986e3e197/packages/base/src/ecosystem.ts)、[subagent tools](https://github.com/AgnesAI-Labs/agnes-harness/blob/7819b23c249fe47ce14bd89e3982e17986e3e197/packages/base/extensions/subagent/src/tools.ts)。

## v0.2 评分导向修订范围

采用用户提供的六项评分权重，没有另行核验官网。增加 rubric-engineering.md 和 07-reliability-tests.md；更新八个 prompt、使用说明及目标契约：12 条不变量、22 类故障、原子接收/持久化派发、文件/DB/AGH 各自边界、幂等/并发/中断恢复、限额/脱敏观测、独立复核与六项证据。

两份 preset JSON 未改变并行数、模型或权限配置；新增测试角色轮换参与，max_fan_out 仍为 2。本轮仅修改提示词/文档，产品服务和前端运行代码未改，也没有运行未来故障矩阵或真实模型。那些用例是交给 AGH 实现和验证的要求。

本次实际检查通过：12 份包内 Markdown 代码围栏配对；8 个角色/阶段 prompt 均引用共同要求；I01–I12 与 E01–E22 编号完整且无重复；六项权重为 25/20/15/15/15/10、合计 100%；PRD 与原件逐字节相同；两份 preset 与 v0.1 已验证包逐字节相同。`npm run check`（21 个已有 JS 模块及 JSON）与 `git diff --check` 通过。

交付 ZIP 为 HealthThread-Agnes-backend-prompts-v0.2.zip，共 16 个文件（提示词/说明/配置与 PRD 来源）。ZIP 清单与当前文件逐字节校验，CRC 检查通过；原通用名称 ZIP 同步为本版，使用显式 v0.2 名称便于识别。
