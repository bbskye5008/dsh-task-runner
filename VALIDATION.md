# 0.2.2 验证记录（含 0.2.0 任务基线）

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
