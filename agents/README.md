# AGH 接入范围

harness.lock.json 固定第三方源码版本。services/api/agnes-agent.mjs 消费公开 Node SDK；通过 AGH 发起任务，不直连模型 API。

当前基础适配使用 JSON 指令并校验真实完成回执，尚未实现三个连续业务工具步骤。后续实现受限 read_source、retrieve_health_context、stage_candidates 工具，以及 daily-record、visit-preparation、post-visit-update Skills。工具的归属、候选提交和校验由业务后端执行；模型不能自行确认事实。

Skill 文件需要在 AGH 中刷新、审阅和启用，不能以文件存在宣称已经加载。工具安装也须检查实际运行状态。SDK 与插件接口均以固定源码版本为准。
