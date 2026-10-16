# 验证记录

## 0.3.7 单插件安装验证

2026-10-16，使用 Harness Desktop 0.2.0-rc.2 实际 SDK、官方 `initProfile` / `runProfile`
及 `pluginManager.installBundle`，创建独立空 Desktop profile，只安装 Task Runner 本地 tgz。
profile、lock 和 node_modules 由正式初始化器/安装器生成，未复制旧安装记录、用户配置或账户数据。

安装后以另一个独立进程冷启动，核对：

- profile 只有 Task Runner 一个外部依赖，bundle 为官方 base、web-app 和 Task Runner。
- 没有 `@michengai/dsh-pua` 或 `dsh-completion-guard` 独立安装目录。
- 内置 Guard 的完整宿主资格链为 `supported`。
- 真实 Agent 预设挂载后，`/task-run help`、`/pua status` 及 `/context-guard on` 均成功。
- 四个组合组件各注册一次；没有向模型发起请求。
- 清单覆盖 172 个运行及组件文件；87/87 回归通过，包括来源、组件字节/版本、额外文件、链接、错误 profile 和加载主体拒绝。

空 profile 对兼容补丁中两个不存在的原 server 目标产生 `entry not found` 提示；补丁跳过，
四个组合组件正常加载。该提示不要求补装原插件。早期 SDK 探针缺少 Desktop 环境字段及
Agent 工厂参数的问题已修正；最终冷启动结论来自修正后的独立进程。

本次没有重跑 0.3.6 的模型长任务，也不将 SDK 安装/命令验证解释为新机器完整 GUI 实测。
冻结验收、HMAC 签证、Goal 版本绑定、跨 turn 和预算代码未因安装简化而放宽。
以上为发布前本地包验证。发布后的干净 GitHub 标签安装与冷启动结果记录于
[v0.3.7 Release](https://github.com/bbskye5008/dsh-task-runner/releases/tag/v0.3.7)，
不以发布后的结果倒写或移动已发布标签。

### 发布后固定 GitHub 来源与完整桌面重启

固定来源：`github:bbskye5008/dsh-task-runner#v0.3.7`，提交 `928c5fd618f0e84d6298ef321c80096be1caebaf`。

1. 新建完全空的独立 SDK Desktop profile，由官方安装器直接安装固定 GitHub 标签，独立进程冷启动。
   仅一个外部依赖，无独立 PUA/Guard，资格 `supported`，三条命令成功，182 个安装文件与 Release tgz 逐字节一致。
2. 另退出完整 Electron 应用，保存原 profile 与 Task Runner 状态，使用全新插件 profile 和状态启动；
   此 UI 测试保留已有账号登录。初始只有官方 base/web-app，外部依赖为空。
   在插件界面从上述 GitHub 来源只安装 Task Runner，并点击「立即启用」。
3. 完全退出并重新打开完整桌面应用，确认原宿主进程已退出、宿主 PID 已变化。
   实际会话中的 `/task-run help`、`/context-guard on`、`/pua status` 都有成功界面响应。
   UI 安装的 182 个文件仍与 Release tgz 一致；没有独立 PUA、Guard。
4. 不传 `--workspace` 创建准备会话，工作区符合来源会话。
   额外两次模型尝试均因新 profile 的默认 `deepseek-official` 路由缺少 API Key 而 `MISSING_CREDENTIAL`，
   已显式取消；没有据此宣称模型冒烟、需求澄清内容或长任务通过。
5. 结束后恢复原 profile 和 Task Runner 状态，原 profile manifest 摘要未变。

完整桌面测试未复制旧插件记录；已有账号登录保留，不能描述成另一台无账号机器实测。
发布前的无账号 SDK 测试与发布后完整桌面测试分别记证，不混用结论。
公开附件 `dsh-task-runner-0.3.7.tgz`、`SHA256SUMS`、`installation-validation.json`
均已匿名回读下载，与上传前本地文件及 GitHub 返回摘要一致。

[发布后机读结果](validation/0.3.7-github-install.json)。标签及 Release 包保持不变，后续文档补充留在 main 与 Release 说明。

## 0.3.6 跨物理 turn 失败恢复

日期：2026-10-16。macOS / DeepSeek Harness Desktop 0.2.0-rc.2，PUA 0.3.27、Guard 0.9.0。
模型：`deepseek-account / deepseek-flash / high`，以全部实际请求配置核对。

任务为离线 Python 标准库库存 JSONL 审计 CLI，包含严格字段/日期验证、确定性重放、
时点过滤、缺货与最低库存统计、输出路径保护、原子发布、万条性能、自测及中文说明。
与上次 0.3.5 使用完全相同的中文任务、缺陷原型、公开与独立验收器。
启动不传 `workspace`，来源会话、新任务会话及实际运行目录一致。

原任务强制首个物理 turn 只读；必须收到原生 Goal 自动后续消息，且真实 `get_goal`
返回 `roundsStarted >= 1` 后，才允许修改实现。不能用 PUA 的“第 N 轮”冒充物理 turn。

| 步骤 | 实际证据 |
| --- | --- |
| 首轮失败 | phase verify 为 8/52、退出 1；checkpoint 返回 not_issued；提前完成 Goal 被工具门禁拒绝 |
| 原生调度交接 | seq 109 turn/end(1) → seq 111 turn/start(2) → seq 114 原生 Goal 消息（round=1） |
| 修复时序 | seq 119 get_goal 返回 roundsStarted=1；首次写文件为 seq 132，晚于真实边界和 Goal 读取 |
| 第二 turn 验收 | 实现、自测、文档及交付补齐，原冻结验收 52/52，签发 revision 1 证书 |
| Goal 变化 | seq 241 Goal complete，revision 1 → 2；模型结束回复时尚未补签，运行仍 active |
| 补签交接 | 插件自动开启第三 turn，prepare 检测旧证书过期；重新运行原验收，签发 revision 2 证书 |
| 自动完成 | 同候选最终 PUA 验收 52/52，完成门禁通过，宿主记录 complete，3 个 turn 均正常结束 |

正式运行耗时 **495.411 秒**。3 次 PUA 迭代 + 2 个额外物理 turn 按原有保守算法计为 **5/8 轮**。
开始/截止没有重置；上限仍为 8 轮、90 分钟。启动后没有人工回复、手动续跑命令或外部补丁。
两次交接来源不同：第一次由原生 Goal driver 发起，第二次是 Goal 已完成后的插件 next-turn 补签消息。

结束后封存候选，用原脚本从外部独立执行：公开冻结验收 **52/52**、独立验收 **58/58**，均退出 0。
项目自测 **36 项**通过；工作流审计 **10/10**、约束审计 **18/18**。
原公开/独立验收、业务契约、场景 SHA-256 未变化；历史交付日志前缀保留，改动仅限约定范围。
独立验收器未交给执行模型，最终独立结果未回灌模型。

最终候选 SHA-256：`42e9f61c37e9ef57b995219cf6d678d3a4616d12f62604e2bc7f0f99cab9cd50`。
Goal revision 1 证书：`22aa23c83c1a824d7d2f8e42301088accb9b0304c7b4a639a0be2f0184e790ac`。
Goal revision 2 证书：`0cb9a990e6a8ea9622fe266ff64471014136c99ce4cd310a72de1461fe662ff2`。
两张证书、最终验收、完成事件、归档及活工作区的候选摘要一致。HMAC 由实际宿主运行时验证；
外部审计核对事件、身份绑定及文件字节，不复制私钥，也不把证书当作离线公开签名。

| 相同场景 | 0.3.5 | 0.3.6 |
| --- | --- | --- |
| 终态 | round_limit，未完成 | complete |
| 物理 turn / PUA 迭代 / 保守轮数 | 1 / 8 / 8 | 3 / 3 / 5 |
| 最终冻结验收 | 8/52 | 52/52 |
| 最终独立验收 | 6/58 | 58/58 |
| Goal 版本重签 | 无证书 | v1、v2 同候选两张证书 |
| 耗时 | 476.161 秒 | 495.411 秒 |

核心回归 `npm test` **73/73**；覆盖原生交接、补签 turn 去重、预算不重置、暂停/取消/到限拒绝交接及完成标签误匹配。
本机实测安装包的 178 个文件前后逐字节一致，Guard 资格 supported、完整性 valid、违规列表为空。
发布时仅更新文档与公开摘要；实测包和发布包的运行代码应保持逐字节一致。
公开可核对结果见 [validation/0.3.6.json](validation/0.3.6.json)，不包含机器路径、控制凭据或原始会话。

这是本机固定宿主版本的一次指定场景测试；没有跑满 90 分钟，没有新增跨平台或崩溃恢复实测。
本次未重跑需求澄清全链路，其早前结果保留在下方历史记录。取消、暂停、到限拒绝交接的新增部分由回归测试覆盖。

## 0.3.5 默认工作区

`npm test`：62 项通过。新增 5 项测试覆盖省略路径的准备/执行输入、JSON 输入、显式覆盖、
缺少或无效工作区的拒绝，以及真实 CLI 子进程使用终端当前目录并保留显式路径。
真实 SDK 的技能加载与准备工具适配检查通过；其中 Agent 工厂及执行启动使用测试替身，不等同于模型实测。
升级后的真实 Harness 会话验证结果见 [0.3.5 Release](https://github.com/bbskye5008/dsh-task-runner/releases/tag/v0.3.5)。
本次改动未修改冻结验收器、证书门禁和轮次/时限约束。

## 0.2.2 验证记录（含 0.2.0 任务基线）

日期：2026-10-15。环境：macOS、DeepSeek Harness 0.2.0-rc.2、PUA 0.3.27、Guard 0.9.0。
真实模型路由：deepseek-account / deepseek-flash，reasoningEffort=high。

## 核心测试

`npm test`：36 项通过、0 失败（原 26 项与新增 10 项安装来源测试）。覆盖输入及 8 轮/90 分钟边界、快照验收、打印 pass 但非零退出、
验收子进程超时/取消、冻结测试目录及外部验收依赖新增检测、候选绑定、Goal 版本变化重签、
终态拒绝和进程重启只恢复无权限墓碑。

## 实际客户端测试

| 场景 | 实际结果 |
| --- | --- |
| 中文 JSONL 聚合任务，默认最多 8 轮/90 分钟 | 2 轮、307.081 秒，宿主自动记录 complete |
| 无证书调用 update_goal complete | 被实际工具门禁拒绝，Goal 未提前完成 |
| 未实现候选触发 LOOP_DONE | 冻结验收 exit 1，被拒后自主实施；没有更换验收命令 |
| 同一候选 Goal rev1 → rev2 | 两张不同证书，候选摘要相同；旧版本证书失效，重新验收签证 |
| 持 rev2 有效证书输出 LOOP_DONE | PUA Oracle 与 Guard AND 门禁通过，自动结束 |
| 不可修复失败，轮次上限缩至 1 | 48.969 秒，round_limit，1 轮，无证书、未完成 |
| 模型运行截止缩至 1 分钟 | 60.006 秒，deadline，无证书、未完成 |
| 慢验收截止缩至 2 分钟 | 120.005 秒，deadline；验收进程已启动，收到 SIGKILL，确认无残留 |
| 活动任务期间退出并重启客户端 | interrupted，原始开始/截止保留；新进程没有恢复活动运行或证书 |

成功候选摘要：`eefcaa9d68461a5cceafd07ef2fedab2b8d4cfeaf84b1e943159e317fc29e9b8`。
Goal rev1 证书摘要：`41c18ff0436b75197b6800c7579cab5dbcef6322fb15ad42ec3114eee7f88ba9`。
Goal rev2 最终证书摘要：`adb238c3d4af71ebcb307f53bc7e8f72ca8e1323c34ab3cda8e99b74a5a59c43`。

## 独立验收

测试任务：标准库 Python JSONL SKU 数量聚合 CLI，包括中文、零和、排序、边界值、
非法输入保留原输出、确定性、1600 行规模、自测与使用说明。
完整任务在开跑前冻结，验收脚本位于候选工作区外；模型没有修改验收器。

结束后由外部评估者封存候选并重跑原冻结命令，退出 0。7 组检查通过，候选自测 22 项通过。
封存副本与完成证书绑定的候选摘要一致。三个实测验收器的 SHA-256 均与开跑前一致。

## 与首次联调对比及限制

首次组合包已能创建会话，但只记录了预设名称，未挂载预设；新会话缺失基础工具，
Guard 因 activation_source_unavailable 失败关闭，没有取得成功证书。
修复在 Agent 工厂 setup 阶段通过官方 agentPresets.mount 挂载预设，并在启动时检查
Guard 激活、宿主资格与持久化状态。之后通过上述真实测试。

预算测试使用缩小的实际时限；默认 8/90 通过配置边界测试，未声称实际跑满 90 分钟。
重启测试为正常退出后的中断恢复；断电/强杀只由进程墓碑逻辑与核心测试覆盖。
只验证上述 macOS 宿主版本，其他版本不声明兼容；宿主自身的历史会话恢复问题不在本次修复范围内。
HMAC 私钥属于宿主进程，公开摘要用于核对证据身份，不能作为离线公开签名验真。
原始会话、任务数据、控制 token 和机器配置未发布到仓库。

## GitHub 安装适配修订

0.2.0 本地包通过上述任务验证，但首次从 GitHub 安装后，Desktop 的 pnpm hoisted 索引
使用固定提交的 codeload URL，旧身份检查把 URL 与 package.version 直接比较，导致
启动时 host_qualification_unavailable。此时没有启动模型或签发证书。

0.2.1 为非关键插件的直接依赖增加来源身份适配：仅接受 40 位固定提交的 GitHub URL，
同时匹配 profile 声明、lock importer 完整引用、package 版本、tarball URL、SHA-512 字段
和 snapshot。浮动分支、缺失锁定或不一致均拒绝；关键 Host SDK 不允许走此分支，
继续通过原有 registry SRI、模块字节及依赖路由审计。没有修改或伪造宿主安装元数据。

新增 10 项测试覆盖成功元组、版本/名称/提交/声明/URL 不一致、缺失 SRI/snapshot、
浮动引用与关键 peer 替换拒绝、原 registry/file 行为。对实际 GitHub 安装树执行修订后的
完整宿主资格链，得到 supported 且 Goal capability 可用。

0.2.2 另移除开发打包脚本对旧版本号的固定判断，支持按当前 package 版本生成安装包。
# 历史检查点：0.3.0 需求准备阶段（后续结果见 0.3.4）

2026-10-15 local source and package validation:

- 54 automated tests passed, including unchanged PUA/Guard tests and preparation
  handoff, artifact binding, frozen acceptance and upstream skill provenance.
- Actual Desktop installer rejected upstream `specworkflow@0.1.1`: its SDK peer
  `@deepseek-ai/dsh-skill-filesystem ^0.1.0-rc.6` does not match installed
  `0.2.0-rc.2`. The installer reported nothing installed; no exemption was granted.
- Added a current-SDK bundled-provider port exposing only the unchanged upstream
  `to-grill` and `to-spec` skills. All 11 included upstream files match npm 0.1.1
  bytes; MIT license and provenance are included.
- `scripts/check-specworkflow-sdk.mjs`, run using the installed Desktop's actual
  Electron/SDK, discovered exactly those two skills and loaded both full bodies
  and language references without warnings. This is an SDK integration check,
  not proof that the new package has been installed or the full workflow passed.
- The medium Chinese CSV task, predetermined business decisions and separate
  29-check independent acceptance script are prepared. Original prototype passes
  only 3/29, so it cannot pass final independent acceptance unchanged.
- At this checkpoint, 0.3.0 is a local package only. New-package installation,
  real requirement interview, operator approval, execution, failure probes and
  final independent acceptance are still pending. No complete-run claim is made.

Evidence: `outputs/deepseek-harness-specworkflow-20261015/` in the local workspace;
`core-tests.log`, `sdk-smoke.json`, `independent-baseline.json`, `progress.json`.


# 0.3.4 前置需求流程与最终真实联调

2026-10-15，实际安装并重启 Harness 0.2.0-rc.2；模型 deepseek-account / deepseek-flash，High。

- 原始 SpecWorkflow 0.1.1 因 SDK peer 不兼容未直接安装；组合包适配当前 SDK，仅包含字节不变的前两阶段及引用材料，共11个原始文件。
- 修复真实工具参数schema、准备阶段转换工具允许列表、长中文验收入口，以及临时目录在候选内导致的递归复制。
- 57项核心测试通过；真实SDK工具与门禁检查通过（SDK smoke的agent factory/start使用替身）。安装包176个文件与实际安装文件一致。
- 新中文CSV任务实际经过 to-grill、to-spec、生成脚本、具体版本审阅和摘要批准。旧摘要真实调用被拒，确认前原有4个文件未改变。
- 原型先验收3/39并拒签，提前完成Goal被拒；随后模型自行实施，自测34/34，冻结验收39/39。
- 同一候选 Goal rev1→rev2 重新签证；PUA最终验收放行，宿主自动complete：1轮、327.231秒。
- 外部原冻结独立验收29/29（原型3/29）。封存副本重跑生成验收39/39；14项完成证据全部通过，冻结文件与目录树未变。
- 首次执行0.3.3因验收临时目录环境问题取消，没有证书；业务独立验收同为29/29。修复后从原型重新走完整流程，累计2轮，含修复和重新准备的总墙钟时间1286.007秒；第二次7轮/70分钟的截止未超过原8轮/90分钟的截止。

最终候选：`7915aec9762547c17f61487e11f6ae5d92fbf0a32dbb36db863a61005126ccdb`。
rev1证书：`caf9fceb3d92318fbb50ad6772cc3f4e3bfe3c0bd5e7f9be828b611473504e60`。
rev2证书：`9d2d3f9a0bb56773dc35992288abe6dbb9684745988d7dc9895a75c4b85b31a1`。

本次证明一个任务的完整联调，未声称满90分钟连续运行或跨平台兼容。自动生成的验收仍需审阅，本次在冻结前修正了漏测、错误期望和私有函数耦合。HMAC有效性由完成时的实际宿主验证，外部核对候选字节与记录绑定，不是公开离线签名验真。

本地完整证据：`outputs/deepseek-harness-specworkflow-20261015/独立验收与联调报告.txt`、`completion-independent-audit.json`、`independent-final.json`、`final-run/`、`archived-candidate/`。
以上是 0.3.4 发布前的本地包与真实客户端验证记录。本次发布将这些结果纳入正式文档；版本标签的 GitHub 安装验证见对应 Release 说明。
