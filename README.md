# DeepSeek Harness Task Runner

[English](https://github.com/bbskye5008/dsh-task-runner/blob/main/README.en.md) | 简体中文

输入想做的事情，先用 SpecWorkflow 澄清需求、整理规格和生成验收脚本；确认具体版本后，自动创建受门禁保护的任务会话。
已有可信验收命令时，仍可直接执行。
默认最多 **8 轮、90 分钟**；验收失败继续修复，到限取消并记录未完成。
同一候选验收通过、当前 Goal 证书有效且 Goal 已完成，才允许 PUA 自动结束。

这是组合 PUA 与 Completion Guard 的本地集成，当前验证目标为 macOS /
DeepSeek Harness 0.2.0-rc.2，PUA 0.3.27、Guard 0.9.0。其他宿主版本未声明兼容。

## 适合什么任务

适合给已有项目增加功能、修复缺陷或改造命令行工具。只有任务想法时，先澄清需求并准备验收；已有可信验收命令时，直接进入执行。
它新增 `/task-run` 与 `dsh-task` 启动器、任务契约生成、独立副本验收、候选与 Goal 版本绑定的证书门禁、预算取消及本地证据记录。
这些行为由本插件在宿主进程中协调；它不是仅安装一组插件的依赖清单。

## 安装

包内提交了可运行 JavaScript，无须安装时执行 build/prepare 脚本。
在 Harness 的“安装第三方插件”里选择本包的本地目录、本地 `.tgz` 文件或 GitHub 地址。
本机没有 dsh CLI 时也可使用这个入口。先停止正在运行的任务，安装后重启 Harness。

当前验证范围为 **macOS / DeepSeek Harness Desktop 0.2.0-rc.2**；宿主须提供标准 Agent 预设、Goal 服务和两个原组件的安装记录。
其他客户端、Web/headless profile、Windows/Linux 和其他宿主版本尚未验证，不能据此宣称兼容。

在 Desktop 的「插件 → 添加插件」中，按顺序填入下表的安装来源。已有对应版本则保留，不必重复安装。

| 顺序 | 插件 | 安装来源 |
| --- | --- | --- |
| 1 | [PUA（原作者）](https://github.com/MichengAI/dsh-pua) | `@michengai/dsh-pua@0.3.27` |
| 2 | [Completion Guard（原作者）](https://github.com/GreenLv/dsh-completion-guard) | `dsh-completion-guard@0.9.0` |
| 3 | Task Runner | `github:bbskye5008/dsh-task-runner#v0.3.5` |

0.3.4 已内置 SpecWorkflow 的 `to-grill`（需求澄清）和 `to-spec`（规格整理），无需单独安装 SpecWorkflow。
这两个阶段只准备需求、规格和验收；确认后继续由现有 PUA + Guard 执行。
原始技能文件、MIT 许可和来源摘要保存在 `vendor/specworkflow/`；当前 SDK 的适配方式见 [验证记录](VALIDATION.md)。

复制 Task Runner 安装来源，在 Desktop 的「插件 → 添加插件」输入框粘贴并安装：

```text
github:bbskye5008/dsh-task-runner#v0.3.5
```

已有 Task Runner 时，先取消活动任务，再通过同一入口安装这个版本并重启；启动后在插件详情核对版本为 0.3.5。
Task Runner 不会自行联网安装这两个前置插件，也不会修改账户或模型配置。
Desktop profile 由 Electron 应用管理；不要执行 `dsh plugin --profile desktop add ...`，CLI 会拒绝修改这个受管 profile。

GitHub 发布与市场目录更新相互独立，已安装插件也不会自动升级。
市场入口应以目录登记的版本为准；本版可直接使用上述固定标签安装来源。
离线安装可下载 [v0.3.5 Release](https://github.com/bbskye5008/dsh-task-runner/releases/tag/v0.3.5) 的 `.tgz`，
再在安装输入框填写下载文件的本地绝对路径。远程 Release 资产 URL 的直接安装方式尚未验证。

原 Guard 的 Desktop 宿主资格链需要 profile 保留它的正式安装记录；本包不绕过该检查。
原组件文件保持不变；组合层暂停两个原 server 行，加载包内固定版本的 server。
原 PUA 的客户端配置入口可继续使用。卸载组合包并重启后恢复原 server 行。
插件管理器可能要求确认插件来源；安装第三方代码属于用户自己的信任决定。

## 一个启动命令

安装 **0.3.5** 并重启 Harness 后，在已选择所需模型、已绑定工作区的普通会话中输入：

```text
/task-run --task "我想做的事情"
```

Harness 命令默认使用**发出命令的当前会话工作区**；终端 `dsh-task --task "我想做的事情"`
默认使用**当前终端目录**。需要指定其他项目时，再加 `--workspace "/绝对路径/工作区"`，显式路径优先。
当前会话没有有效工作区时会提示指定路径，不会猜测另一个项目或使用 Harness 进程目录。
不提供 `--verify` 时创建独立准备会话，沿用来源会话的模型与推理设置：

1. `to-grill` 阅读项目、逐个澄清必要业务决策，保存 `requirements.md`。
2. `to-spec` 整理范围、非目标、边界与验收条件，保存 `spec.md`。这两个阶段不写代码。
3. 适配层进入验收准备阶段，在 `.spec-workflow/prep-UUID/acceptance/` 生成独立验收脚本，
   用 `acceptance.json` 把每条条件映射到命令和脚本。宿主生成逐项执行的总验收器，任一条件失败则失败。
4. `task_prepare_submit` 生成含需求、规格、条件、命令和文件摘要的 `review.md`，进入等待确认状态。
   用户在准备会话中回答问题，或使用 `dsh-task reply PREP_ID "回答或修改意见"`。
5. 阅读具体产物后输入返回的 `/task-run approve PREP_ID DIGEST`，或终端
   `dsh-task approve PREP_ID DIGEST`，自动冻结整份规格与验收目录并启动现有 PUA + Guard 执行器。

`/task-run review PREP_ID` 或 `dsh-task review PREP_ID` 查看待确认版本；
`/task-run status PREP_ID` 或 `dsh-task status PREP_ID` 查询状态；
`/task-run cancel PREP_ID` 或 `dsh-task cancel PREP_ID` 取消准备。
修改任何已发布文档、脚本或辅助文件后，旧摘要确认失效，需重新提交并确认。
准备阶段若生产文件发生变化则拒绝交接，需要基于新的项目基线重新准备。
准备会话不能改生产代码、运行脚本、启动 Goal/PUA、调用后续 SpecWorkflow 实施技能或自行批准。

**最多 8 轮、90 分钟继续约束正式执行阶段**，从确认后创建执行运行时开始计时；
需求讨论和等待用户确认不会启动或消耗 PUA 执行预算。重试、验收与 Goal 重签均不重置执行截止。
执行中不能降低或修改验收；需求变化要取消当前执行，回到准备阶段形成新版本并重新确认。
模型生成测试不等于测试充分：确认时仍需核对需求与用例覆盖，主观标准需要另行人工验收。
当前适配器要求每条完成条件都有可执行检查，无法自动检查的关键条件须在准备阶段解决。

准备会话的草稿与元数据会持久化；重启后可读取已提交版本并显式确认，但未提交的准备会话不会自动恢复模型执行。
取消后也不会自动启动。确认后使用准备时记录的模型选项，不重置旧执行预算。

### 已有验收命令：直接执行

如果已经有经过检查的验收命令，提供 `--verify` 即可跳过需求准备。在 Harness 中输入：

```text
/task-run --task "具体任务" --verify "npm test"
```

也可以在终端使用已安装插件的 CLI：

```sh
node "$HOME/.dsh/profiles/desktop/node_modules/dsh-task-runner/cli.mjs" \
  --workspace "/绝对路径/工作区" \
  --task "完成具体功能，保留现有行为，并补充自测" \
  --verify "python3 /绝对路径/独立验收目录/check.py"
```

通过 npm 全局链接或包的 bin 安装后，可把 node .../cli.mjs 换成 dsh-task。
本包不默认修改全局 PATH。若 ~/.local/bin 已在 PATH 中，可以一次性建立链接：

```sh
mkdir -p "$HOME/.local/bin"
ln -s "$HOME/.dsh/profiles/desktop/node_modules/dsh-task-runner/cli.mjs" "$HOME/.local/bin/dsh-task"
```

然后在项目目录直接运行 dsh-task --task ... --verify ...。
任务较长时用 --task-file /绝对路径/任务.txt；与 --task 二选一。
可加 --rounds 4 或 --minutes 30 降低限制，任何值都不能提高到 8 轮 / 90 分钟以上。
先打开一个已配置模型的会话。模型沿用最近一个已加载根会话的设置；
--session SESSION_ID 可指定来源会话。没有来源会话时直接报错。
CLI 返回新 sessionId 和证据目录；可用 status 查询，界面显示取决于宿主工作区列表。

该入口创建独立任务会话，沿用提交命令会话的模型配置。
支持等价 JSON 对象输入；无需再粘贴 PUA、Guard 和任务正文四段内容。
显式指定的工作区路径必须绝对；描述和命令必须加引号。本机启动器使用标准 argv/JSON 编码，
不模拟键盘输入，避免此前原生键入破坏 JSON 标点的问题。

```sh
node "$HOME/.dsh/profiles/desktop/node_modules/dsh-task-runner/cli.mjs" status
node "$HOME/.dsh/profiles/desktop/node_modules/dsh-task-runner/cli.mjs" status task-UUID
node "$HOME/.dsh/profiles/desktop/node_modules/dsh-task-runner/cli.mjs" cancel task-UUID
node "$HOME/.dsh/profiles/desktop/node_modules/dsh-task-runner/cli.mjs" diagnose task-UUID
```

Harness 对应命令是 /task-run status 和 /task-run cancel task-UUID。

## 自动做了什么

1. 保存任务原文、执行协议和生成的 profile，绑定具体工作区和会话。
2. 冻结已有 TASK/AGENTS、测试目录、识别出的验收脚本及 npm test 的 package/lock 定义。
   外部脚本默认冻结它所在的独立目录，包含新增文件检测。可以重复使用
   --freeze /额外依赖/路径 明确补充；目录过大或符号链接等不明确情况直接拒绝。
3. 创建真实 Goal，开启 PUA/Guard，将完整任务作为用户命令的原文中继注入模型。
4. 默认一个“实现、独立验收与交付”阶段；模型记录验证 ID、真实结果和剩余工作。
   交付 TASK_GATE_FINAL.md 和 TASK_GATE_PROGRESS.md，宿主检查后签证。
5. Goal 完成导致 revision 变化，旧证书失效；再验收签证后，PUA 才能接受 LOOP_DONE。

验收命令在工作区的独立副本中运行，结果目录位于 ~/.dsh/task-runner/task-UUID/。
副本忽略 .git、node_modules、.scratch 和语言缓存；node_modules 复用现有依赖目录。
命令退出 0 才算通过，打印“pass”不算证据。模型不能用另一个命令替换验收。
命令及其子进程每次最多 120 秒，并受剩余总时间约束。命令应使用相对工作区路径或
环境变量 DSH_TASK_WORKSPACE；写死原工作区绝对路径会破坏副本隔离，前后候选变化会被拒绝。
已有验收文件不能改；任务新增自测使用 self-tests/，避免覆盖被冻结的验收目录。

## 预算和状态

- 正式执行截止从批准后创建执行运行时开始记录；使用 `--verify` 时从直接启动执行开始记录。模型重试、验收和 Goal 重签不重置截止。
- 轮数按 PUA iteration 加额外物理 turn 保守计算；它与模型单次工具调用数不同。
- 到时取消当前模型活动、验收进程组、PUA 自动续轮，并解除 Goal 自动继续资格。
- 超时、到轮次、取消、需要输入、崩溃中断均不会记录成完成。
- 重启后旧运行标记 interrupted，不恢复上一进程的 HMAC 证书，也不自动再给 90 分钟。
- 机器睡眠时无法调度取消，恢复运行时按原绝对截止拒绝后续模型步骤和完成放行。

status.json 保存状态、原截止和最终证书摘要；events.jsonl 保存真实验收与门禁决定；
profile.json / user-message.txt 是冻结契约；checks/ 保存副本和实际进程结果。
控制器仅监听当前用户权限的 Unix socket，不开公网端口，不上传任务内容。

## 0.3.5 工作区默认值

`npm test`：62 项通过，覆盖省略路径时的准备/执行入口、显式路径覆盖、无效路径拒绝，
以及 CLI 的真实子进程目录传递。准备与执行仍绑定规范化后的具体工作区，冻结验收、证书和预算规则不变。
升级后的真实会话验证结果记录在 [0.3.5 Release](https://github.com/bbskye5008/dsh-task-runner/releases/tag/v0.3.5)。

## 0.3.4 实测

2026-10-15，在 macOS / Harness Desktop 0.2.0-rc.2 使用 Flash / High 完成中文 CSV 工单工具联调：

| 检查 | 结果 |
| --- | --- |
| 需求澄清、规格与验收脚本生成 | 实际加载 `to-grill` / `to-spec`，确认前原型未改变 |
| 具体版本确认 | 旧摘要被拒绝；新摘要批准后才启动 PUA + Guard |
| 冻结生成验收 | 原型 3/39 → 交付 39/39；候选自测 34/34 |
| 额外独立业务验收 | 测试前冻结，原型 3/29 → 交付 29/29，验收器未改动 |
| 失败拦截 | 提前完成 Goal 被拒，失败候选不签证 |
| Goal 变化与完成 | 同一候选在 rev1 → rev2 后重新签证，自动 `complete` |
| 正式执行 | 1 轮、327.231 秒；首轮环境问题修复后重新从原型复测 |
| 核心回归 | 57 项通过 |

本次单轮内从失败继续实施到通过；未声称验证了完整 8 轮稳定重试、连续跑满 90 分钟或跨平台兼容。
历史 0.2.2 的 JSONL 任务与预算/中断测试仍见 [验证记录](VALIDATION.md)。
版本变化见 [更新记录](CHANGELOG.md)。

## 边界

三个输入减少的是配置工作，验收标准仍由用户负责。把全文绑定到一个验收命令，
不等于自动理解每条中文要求，也不保证 npm test 已覆盖全部需求。
默认发现规则无法证明任意 shell 命令的传递依赖完整；重要的额外依赖请用 --freeze。
候选摘要包括源码、文档、测试和符号链接，排除上述依赖/缓存；不认证 node_modules 的
每个字节。既有依赖与验收执行环境需要可信。
工具策略和同用户 Unix socket 均不是 OS 沙箱，不能防御任意同用户恶意代码。
证书由宿主进程私钥签发，只证明完成时的绑定和执行证据，不是离线公开签名。

## 常见问题与卸载

- `open_a_model_configured_conversation_first`：CLI 找不到已加载的来源会话；先在 Harness 的正常会话中执行 `/task-run ...`，或加载一个已有会话后再运行 CLI。
- `host_qualification_unavailable`：宿主版本、安装记录或实际依赖树未通过资格审计。先核对上述版本和来源；不要关闭 Guard、改写安装索引或更换验收命令来绕过。
- `round_limit` / `deadline`：预算到限，结果是未完成；检查证据目录后，由用户明确发起新的运行。重启不会自动续给预算。
- `npm test` 等验收命令需要的依赖应在开跑前准备好；验证时不会自动安装依赖。验收应使用相对路径或 `DSH_TASK_WORKSPACE`，额外外部依赖用 `--freeze` 登记。
- 卸载前先 `dsh-task cancel task-UUID`，再通过 Desktop 插件管理器卸载 Task Runner 并重启。保留原 PUA/Guard 插件即可恢复原服务器条目；旧任务证据仍保存在 `~/.dsh/task-runner/`。
- 如果手工建立过 `~/.local/bin/dsh-task` 链接，卸载后确认其仍指向本插件，再移除这个链接；不要删除其他同名命令。

## 上游与本插件的关系

感谢 [MichengAI/dsh-pua](https://github.com/MichengAI/dsh-pua) 和 [GreenLv/dsh-completion-guard](https://github.com/GreenLv/dsh-completion-guard)。
正式前置安装来源均为原作者的 npm 包。本包还携带归属明确的 Apache-2.0 修改版服务器组件，以接入同候选验收和证书门禁；
原始许可证、NOTICE、固定版本与文件哈希见 `vendor/`。这些修改不是上游官方版本，上游作者未背书。
本插件自身新增的协调逻辑位于 `index.mjs`、`runtime/` 和 `guard.mjs`，组合差异可由 `scripts/build-vendor.py` 复现。

## 开发与发布

```sh
npm install --ignore-scripts --legacy-peer-deps
npm test
npm pack
```

SDK peers 必须与宿主共享，不要把本地 SDK 副本打入包。包已含运行构建；GitHub 安装无须 prepare。
市场收录与 GitHub 发布不同：dsh-market 读取 awesome-dsh-plugin 精选目录，需另行提交条目。
任务目录、控制 token、机器配置和测试原始会话不进入发布包。
许可证 Apache-2.0；第三方来源及修改见 NOTICE、vendor/base-provenance.json。
