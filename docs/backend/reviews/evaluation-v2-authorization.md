# V2 真实评测授权

2026-10-12，用户在本主会话直接回答此前准确授权问题。问题 ID：`call_acc15d232c6047c4a04711711dccdc96`。

问题原文：

> 代码和评测脚本已完成并通过审查。是否允许使用你现有的 Agnes 账号，向 agnes-ai / agnes-3.0-flash 发送已冻结的 24 例合成测试资料，并运行至多 8 次医嘱续接评测？这会消耗账号模型额度；保持每次运行最多 2 次修正、120 秒期限，不重跑刷分。

用户原文：

> 允许这次真实评测

授权仅用于同一已准备并审查的命令执行一次：

```sh
node --env-file-if-exists=.env scripts/evaluate-model.mjs --version v2 --dataset tests/fixtures/model-evaluation.v2.json --output .runtime/evidence
```

维持冻结的 24 例、预选医嘱续接、原 provider/model、每次最多两次修正和 120 秒期限。脚本 SHA256 `dd2c2b51d2b632d4423e0e5f294a80e13a9ac905f4fe535b3af9df602777e95e`，数据 SHA256 `7976bcddf9fcd66c1050955d8033da00624a2edad8e68c064dd5c4efa9b2daf1`，冻结清单 SHA256 `eee02c9724d1667333158d6dfa3b521f36cb4360532730b36251732525535507`，受信任资产 `10bed8c45398820ee485`。

使用独立合成数据库与运行目录，保留首次输出、修正、失败、未运行分母和真实 SDK 证据；不修改标签/模型资产、不重跑刷分、不改全局 AGH/账户/源码、不推送。原启动前自动审核拒绝与零执行记录仍保留在历史提交 `d957b41`；本次有新的直接人类授权，不通过其他路径绕过审核。实际启动与结果以更新后的 V2 验证记录为准。
