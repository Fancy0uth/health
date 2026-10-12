# 本地人工验收 runbook

当前预览已恢复用户上传的电脑端和手机端原页面，沿原菜单/按钮验收。此前共享替代界面停用。此次恢复只进行工程测试和已有数据的浏览器读取，未新增真实模型调用；[准确记录](reviews/native-frontend-restoration.md)。下列后端核对原则仍适用，页面路由以原界面为准。

当前项目：`/Users/fancyouth123/Documents/ChatGPT/expressforpatient`；branch `codex/healththread-shared-backend`。当前领域代码含未知信息修复 `1a673d4`，评测脚本 `a7f71c4`，受信任模型资产 `10bed8c45398820ee485`，均经独立复核。后续文档提交见 `git rev-parse HEAD`。完整工程测试 208/208、67 模块检查通过；真实双端 W1/W2/W3 验收记录在 [浏览器验收](reviews/browser-acceptance.md)。V2 分数属于修复前 `cf632b9`。未推送、合并或部署。

本机预览已启动，可以直接打开电脑版 `http://127.0.0.1:4173/web/` 和手机界面 `http://127.0.0.1:4173/mobile/`，使用下述合成演示账号验收；只有服务停止后才需要重新执行启动命令。示例库中保留了本轮合成记录和两条医嘱事项，便于检查来源、版本、确认过程与恢复历史。

## 启动前提

Node≥24.10，Poppler `pdfinfo/pdftotext`，固定且依赖已安装的干净AGH源码。复制并编辑`.env.example`，配置`AGH_ROOT`、只读`AGH_ACCOUNT_HOME`、`AGH_ACCOUNT_PROFILE=local-dev`，必要时另设产品自有`HEALTHTHREAD_AGH_HOME`。账户凭据只留账户目录；运行目录不能落入源码/账户目录。不要使用历史ChatGPT/桌面复制目录作为操作根。

显式`HEALTHTHREAD_DEMO_AUTH=1`，当前专门合成演示账户为`demo` / `healththread-demo-2026`；`.env`被忽略且应为mode600。本次是合成演示账号，其他机器自行设置。`AGENT_MODE`默认agnes；未就绪不会自动选别的provider/固定输出。

```sh
cd /Users/fancyouth123/Documents/ChatGPT/expressforpatient
git rev-parse HEAD
npm run build:agh-runtime
npm run verify:agh-runtime
npm start
```

预览是同一个`127.0.0.1:4173`服务器、同一个`.runtime/healththread-domain.sqlite`：电脑`/web/`，手机`/mobile/`，并非两个后端端口。真实 AGH 运行环境已构建/核验，当前服务已启动。`/api/health`是liveness+依赖状态，不能仅凭`ok:true`宣称模型可用。Node SQLite实验性警告已知。

## W1：手机录入、电脑核对与冲突

1. 手机界面登录，设置中明确授权分析。记录`目前没有头痛。`。先看到服务端已保存原文/运行回执，随后候选待核对；在确认之前正式事实应为空或不变。查看完整句、negated/current语义与来源定位。normalized时间是否unknown/relative按实际产物展示，人核对，不补日期。
2. 电脑界面用同一账号登录/刷新，找到同一source/run/candidate。打开原文，核对否定没有丢失，选择候选并明确确认。profile revision递增，确认receipt可查；手机刷新看到同一正式事实。
3. 在两端同时保留同一旧核对页/选择，先确认一端，再提交另一端旧版本，应409、保留选择并解释当前版本。旧候选不能强行写新版本。可选择重新读取/拒绝或从保存source重新分析。

## W2：沟通稿及依赖过期

1. 用当前困扰`今天想向医生说明夜间咳嗽。`生成就诊材料。202不表示已生成；等待真实result，检查speech逐句支持当前困扰，questions为咨询问题，未核对source仍是自述。
2. 查看原文与生成状态；D01科室/D02观察分级始终未配置。不能出现伪装临床规则/剂量/分诊阈值。
3. 在事实里发起更正，例如`目前可能头痛。`，该更正也是新原文→候选→用户确认。确认后旧沟通卡应stale，复制旧卡也保留过期/出处提示；没有静默改写旧卡为新事实。

## W3：文档、部分确认、独立多事项

1. 粘贴`医嘱：每日记录症状。`与`医嘱：三天后复诊。`两行，保存并等待提取。逐项核对完整原句、instruction、assertion/temporal/time、quote/source version；资料本身不会变成事实。
2. 全选确认后，观察新的care_plan独立run ID；之后出现两个事项，逐条text仍等于已确认医嘱，不补药名/剂量/绝对日期。事项完成只表示执行状态，不表示康复。
3. 另存两条医嘱，只确认其中一条：只应生成已确认条目的任务。无医嘱文档（如`检查记录：考虑肺部感染，待排。`）确认来源事实后接续0任务+说明，不自动补任务。
4. 上传真实文本层PDF，查看一基页码与全局UTF-16 quote。可生成`tests/fixtures/pdf.mjs`的合成PDF；`tests/fixtures/encrypted-synthetic.pdf`应明确拒绝加密，扫描/无文本PDF不伪造正文。OCR/语音/音频不支持。
5. 两端同时对同任务版本操作：一个成功，旧expected_version409。更正依赖资料后旧task标stale并拒绝更新；反馈走新记录。

## 故障/取消/删除恢复

- 需要独立演示未配置失败时，停止当前自己的npm服务，再以`AGENT_MODE=disabled npm start`启动同一合成DB。新原文必须已存、run blocked且有receipt；重新agnes配置后用户显式重试引用同source，不能补模板产物。不要为了演示重复24例真实质量评估。
- 取消queued/running/review运行或撤回分析授权。已存原文保留；旧callback不能创建新的有效候选/result。`tests/faults/governance.test.mjs`、`epoch-boundary.test.mjs`与PDF barrier提供自动受控证据，人工界面无需依赖碰巧race。
- 网络写响应未知时，保留原输入、request key与epoch，用恢复入口查/重试原请求。编辑后的草稿不能替换旧body，旧未知写不能自动升级scope；PDF重选需原bytes fingerprint。失败明确显示保存/phase/恢复状态。
- 在设置下载当前账号导出，检查只有当前用户对象和允许PDF原件。确认删除单条来源或勾选全部删除：SQLite活动资料/BLOB已删，AGH轨迹/备份/残留未验证→**partial**，不能写完全删除。删除回执丢失使用旧session-bound opaque handle恢复同job，不新建DELETE。全部删除递增all_clear_epoch，其他端刷新后清旧健康草稿/证据；单来源删除保留无关草稿。

未知remote效果不能盲重放；running重启为interrupted。检查已存source/run与receipt后用户显式retry。review检查点与confirm后queued continuation重启保留，见真实SIGKILL五阶段测试。

## 验收登记与边界

当前工程与独立代码复核已完成，真实双端验收由协调者执行并单独保存实际 URL、版本、provider、session/seq、操作与结果。W2 记录了一次上游传输失败和一次显式同原文重试成功；它证明恢复行为，不表示首次生成必然成功。PDF 原生选择器自动化及实际 OS 打印未通过本轮浏览器验证。

历史 V1 质量结果：原文保存24/24，主真实闭环21/24，完整严格gold11/24，四个明确时间槽遗漏、一个重复不确定候选，以及失败/标签编码差异，见`validation.md`和`evaluation-results.v1.json`；它们没有被修改或标成最终版本。V2 在准确授权后以 agnes-ai / agnes-3.0-flash 唯一实跑24例，原文24/24保存、真实主闭环12、严格匹配6/24、12个传输失败。预选8次care均未满足冻结确认条件，续接/日程质量未评测。4个范围标签差异与2个实际未知信息校验缺口分开记录，后两者已修复并工程复核。原分数属于修复前cf632b9，不证明当前代码的模型表现，详见[评测报告](validation.v2.md)。本次额度授权已经执行完毕；后续真实批量评测需另行授权，验收无需重复跑分。

旧原型SQLite、历史浏览器local数据不会导入领域，也不属于本次当前用户删除。AGH traces、外部备份和SQLite/WAL/OS残留无法认证擦除；真实负载、断电/磁盘满/完整渗透、临床专家正确性不在本次证明范围。不要提交`.env`、`.runtime`或真实病历。
