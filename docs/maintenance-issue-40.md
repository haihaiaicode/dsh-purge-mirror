# #40：桌面归档入口与磁盘诊断目标不一致

## 已复现的根因

1.6.31 的面板状态经 `gatherState → findAiBase` 查找实际目录，自检经
`currentHost → normalizeHostBase` 从当前启动脚本定位。Electron 从
`Resources/app.asar/dsh/.../dsh-desktop-host/lib/index.js` 启动时，后者得到归档内根。
补丁检查器的 `isFile` 明确排除 `.asar/` 内路径，因而把其中的必需目标报告为
`missing_file`，即使同一安装的 `Resources/app/dsh/...` 已有对应文件。

真实 Electron 44.7.0 的临时归档已复现：同一测试文件，实际目录为 `applied`，
归档路径为 `missing_file`。这证明代码缺陷存在，不代表仅凭报告者的截图已确认其
每一个红项的原因。#40 仍需补充 DSH 版本、启动方式、目标路径及布局详情。

## 1.6.32 的处理

- 新增只读 `diagnosticHost`，供面板 status、自检、diagnose 和 CLI diagnose 共用。
- 只将已选定安装的归档入口解析为同一 Resources 下的实际目录：优先 `app`，
  其次 `app.asar.unpacked`。已有但不完整/不可读的优先目录不切换到更健康的目录。
- 显式实际路径保持原目标；没有启动或显式实例证据时返回未知，不扫描其他安装。
- `currentHost`、安装、应用、补丁表、迁移、提示词与权限逻辑保持不变。
- 原始补丁明细与分层自检使用同一磁盘目标；面板合并显示组与原始条目计数仍不同，
  #76 的只读预设适用性判断也仍保留，不能强行让两个数字相等。
- `app.asar` 仍存在时继续报告布局问题；缺失文件、失败、未知以及权限不匹配均不隐藏。
  磁盘已应用不证明当前进程加载了修改。

## 验证

`npm run test:electron` 新增真实 ASAR 场景，并通过 Cordis 注册的实际
status/selfcheck/diagnose HTTP handler 验证目标一致。使用中性的诊断夹具，不调用模型。
同时检查真正缺失项、密封归档和主动配置的权限差异仍报错，临时提示词/profile 字节不变。
`test/instance.test.mjs` 覆盖两种物理目录、部分目录、未解包、权限拒绝、
显式目标和无实例证据。原有默认预设、未知/失败优先级和 npm 嵌套目录测试继续执行。

CI 在 macOS 与 Windows 运行真实 Electron 诊断；三个平台继续执行安装器与打包测试。
真实桌面 UI、报告者的 macOS 15 安装和当前进程加载状态不由这些测试代替。

## 排查与回滚边界

先收集 DSH 精确版本、安装/启动方式以及是否刚更新过 DSH，核对 status.ai_base、
selfcheck.host、host-status 的 disk/process 字段和报错条目。分享前脱敏用户名、
私人目录名；不要上传提示词、凭证、全量配置或整个备份。

不要仅为消红改权限、删除归档或重新应用全部补丁。需要用户完整退出时先说明原因，
不能自动重启。此修复不迁移用户数据；回滚插件包会恢复旧诊断行为，不应恢复旧用户设置。

Windows CI 的全套 Node 测试固定 `--test-concurrency=2`，避免多个测试文件同时启动
PowerShell 时的冷启动争用。曾在 GitHub runner 复现 12 秒状态等待超时、另一
PowerShell 用例耗时约 26 秒；相同源码在 4090 全套通过。仅限制测试并发，测试列表、
断言、生产助手超时与失败检查保持不变。

## 1.6.35：报告者补充后的独立根因与处理

报告者已补充 macOS 15.7.4、官方 Desktop 0.2.1-rc.2 nightly、独立 Homebrew CLI 及现场磁盘证据。1.6.32 的目标分裂已消失；剩余归档仍是官方原件不是假红。macOS 的 HTTP apply 当时没有像 Windows 一样安排等待退出助手，所以“提示重启”不能保证换包发生。

现在 macOS apply 安排独立 CJS 助手，在应用外临时目录运行，使用真实磁盘 fs，等待所选 `.app/Contents` 内所有进程退出（排除助手自身）。备份采用同文件系统独占硬链接并核对 inode、设备和 SHA-256，再移除原入口；从不覆盖已有备份。等待时校验归档身份，退出后重新校验主入口和已知 runtime 链接。没有写权限、锁冲突、归档更新或解包不完整均停止并保留原件，不自动提权。

- `handoff`：`not_scheduled`、`starting/ready/waiting_for_quit/moving`、`complete`、`failed/expired/helper_stopped/unreadable` 等。等待最长 30 分钟；未知旧锁不抢占。旧完成记录遇到新归档返回 `archive_reappeared`；备份消失返回 `backup_missing`。
- `disk` 与 `process` 仍独立：换包完成不证明下一次运行的代码已加载；独立 CLI 的 process/权限未知仍保留。
- Desktop shell 路径从显式目标的 Resources 解析，终端本身是 Web/Node 不再造成 #83 假缺失；目标文件真缺失时不寻找另一份安装替代。
- #71 的家族检测限定当前 DSH_HOME：本地预设、各 profile 实际包、fallback 包和依赖声明。没有家族才 na；安装残缺仍 missing，YAML 损坏仍 unmatched，读取或解析依赖不足仍 unknown。不改补丁表或原有处理功能。

### 用户操作与脱敏诊断

先升级插件；在桌面面板点「应用」，看到“等待完整退出”再 **⌘Q**。助手不自动打开 DSH。可在终端使用已核对的同一安装路径检查：

```sh
PURGE_DSH_CLI='/实际安装/Contents/Resources/app/dsh/node_modules/@deepseek-ai/dsh-desktop-host/lib/cli.js' purge-community host-status --profile desktop
PURGE_DSH_CLI='/实际安装/Contents/Resources/app/dsh/node_modules/@deepseek-ai/dsh-desktop-host/lib/cli.js' purge-community selfcheck --json --profile desktop
```

不需要为 shell 诊断额外设置 DSH_SURFACE；不要把示例路径当真实路径。没有明确目标的裸 CLI 继续报 unknown，是正确边界。`handoff.phase=complete` 后手动打开并在面板重测。反馈只需插件/DSH/macOS 版本、handoff.phase/detail、disk/process 和剩余红项，路径可脱敏，不发提示词/密钥/完整配置。

### 失败与回滚

1. 未完成时原归档通常仍在。先检查 phase/detail、是否仍有同安装进程、解包入口/runtime 和当前目录写权限；不要直接删锁/归档或全局改权限。助手 failed/expired 后，原问题解决再由用户重新应用；未知旧锁需人工确认归属。
2. 完成后如下一次打开异常，先由用户完整退出。核对状态记录中的 **同一安装** backup 路径和 archive_sha256；原 app.asar 必须不存在，备份必须存在且哈希吻合，再恢复备份至 app.asar。若已有新归档，不覆盖它；先诊断版本冲突。恢复后仍由用户手动打开。
3. 插件包回滚使用既有快照流程；不回写旧提示词、profile、权限或图库数据。宿主归档恢复与插件回滚分开执行。

### 新增实际验证

`test/macos-handoff.test.mjs` 运行真实独立进程，覆盖手动退出等待、重复请求、备份、归档更新、坏入口/runtime、超时、坏记录、旧锁、启动失败及旧完成记录失效。
`scripts/check-macos-handoff.mjs` 使用独立 **Electron.app 44.7.0** 副本实际从 ASAR 启动，应用后由测试应用自行 quit，确认助手存活、备份哈希及未自动重开，再显式二次启动确认入口为 `Resources/app`；隔离设置哈希不变。
这不等于验证了报告者那一份签名、权限与 nightly 构建，仍需他按上述步骤回报。Windows 原助手代码未改，继续运行 Windows Electron 和完整安装/回滚测试。
