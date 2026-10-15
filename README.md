# DeepSeek Harness Task Runner

输入工作区、完整任务和验收命令，自动创建受门禁保护的任务会话。
默认最多 **8 轮、90 分钟**；验收失败继续修复，到限取消并记录未完成。
同一候选验收通过、当前 Goal 证书有效且 Goal 已完成，才允许 PUA 自动结束。

这是组合 PUA 与 Completion Guard 的本地集成，当前验证目标为 macOS /
DeepSeek Harness 0.2.0-rc.2，PUA 0.3.27、Guard 0.9.0。其他宿主版本未声明兼容。

## 安装

包内提交了可运行 JavaScript，无须安装时执行 build/prepare 脚本。
在 Harness 的“安装第三方插件”里选择本包的本地目录、发布 tarball 或 GitHub 地址。
本机没有 dsh CLI 时也可使用这个入口。先停止正在运行的任务，安装后重启 Harness。

本版本需要先安装 @michengai/dsh-pua@0.3.27 与 dsh-completion-guard@0.9.0，
再安装本组合包。Desktop profile 由 Electron 应用管理，请使用界面的插件安装入口；
dsh CLI 会拒绝直接修改这个受管 profile。

组合包安装来源：`github:bbskye5008/dsh-task-runner#v0.2.2`。
源码仓库：https://github.com/bbskye5008/dsh-task-runner 。
已提交预构建 JavaScript，下载后无需编译；GitHub 安装与市场收录是两件事。
原 Guard 的 Desktop 宿主资格链需要 profile 保留它的正式安装记录；本包不绕过该检查。
原组件文件保持不变；组合层暂停两个原 server 行，加载包内固定版本的 server。
原 PUA 的客户端配置入口可继续使用。卸载组合包并重启后恢复原 server 行。
插件管理器可能要求确认插件来源；安装第三方代码属于用户自己的信任决定。

## 一个启动命令

Harness 启动且插件已加载后：

```sh
node /绝对路径/dsh-task-runner/cli.mjs \
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

然后直接运行 dsh-task --workspace ... --task ... --verify ...。
任务较长时用 --task-file /绝对路径/任务.txt；与 --task 二选一。
可加 --rounds 4 或 --minutes 30 降低限制，任何值都不能提高到 8 轮 / 90 分钟以上。
先打开一个已配置模型的会话。模型沿用最近一个已加载根会话的设置；
--session SESSION_ID 可指定来源会话。没有来源会话时直接报错。
CLI 返回新 sessionId 和证据目录；可用 status 查询，界面显示取决于宿主工作区列表。

在 Harness 当前会话中也可直接输入：

```text
/task-run --workspace "/绝对路径/工作区" --task "具体任务" --verify "npm test"
```

该入口创建独立任务会话，沿用提交命令会话的模型配置。
支持等价 JSON 对象输入；无需再粘贴 PUA、Guard 和任务正文四段内容。
工作区路径必须绝对；描述和命令必须加引号。本机启动器使用标准 argv/JSON 编码，
不模拟键盘输入，避免此前原生键入破坏 JSON 标点的问题。

```sh
node /绝对路径/dsh-task-runner/cli.mjs status
node /绝对路径/dsh-task-runner/cli.mjs status task-UUID
node /绝对路径/dsh-task-runner/cli.mjs cancel task-UUID
node /绝对路径/dsh-task-runner/cli.mjs diagnose task-UUID
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

- 总截止从本次任务准备开始记录，模型重试、验收和 Goal 重签不重置截止。
- 轮数按 PUA iteration 加额外物理 turn 保守计算；它与模型单次工具调用数不同。
- 到时取消当前模型活动、验收进程组、PUA 自动续轮，并解除 Goal 自动继续资格。
- 超时、到轮次、取消、需要输入、崩溃中断均不会记录成完成。
- 重启后旧运行标记 interrupted，不恢复上一进程的 HMAC 证书，也不自动再给 90 分钟。
- 机器睡眠时无法调度取消，恢复运行时按原绝对截止拒绝后续模型步骤和完成放行。

status.json 保存状态、原截止和最终证书摘要；events.jsonl 保存真实验收与门禁决定；
profile.json / user-message.txt 是冻结契约；checks/ 保存副本和实际进程结果。
控制器仅监听当前用户权限的 Unix socket，不开公网端口，不上传任务内容。

## 实测

2026-10-15 在实际 Desktop 客户端使用 Flash / High，中文 JSONL 聚合任务在 2 轮、
5 分 7 秒内自动完成。无证书/失败候选被拦截，同一候选在 Goal rev1 → rev2 后重新签证；
封存副本独立验收通过，22 项候选自测通过。另测轮次、慢验收截止取消和重启中断。
0.2.1 另修复固定 GitHub 提交来源的安装身份核对，并增加 10 项针对性测试。
详见 [验证记录](VALIDATION.md)。这不代表已经连续运行满 90 分钟或跨平台验证。

## 边界

三个输入减少的是配置工作，验收标准仍由用户负责。把全文绑定到一个验收命令，
不等于自动理解每条中文要求，也不保证 npm test 已覆盖全部需求。
默认发现规则无法证明任意 shell 命令的传递依赖完整；重要的额外依赖请用 --freeze。
候选摘要包括源码、文档、测试和符号链接，排除上述依赖/缓存；不认证 node_modules 的
每个字节。既有依赖与验收执行环境需要可信。
工具策略和同用户 Unix socket 均不是 OS 沙箱，不能防御任意同用户恶意代码。
证书由宿主进程私钥签发，只证明完成时的绑定和执行证据，不是离线公开签名。

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
