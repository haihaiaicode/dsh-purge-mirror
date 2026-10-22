# 安装、升级与故障排查

当前版本 **1.6.41**。面向用户与协助安装的 Agent。支持的安装器环境：Linux CLI/Web；macOS Desktop；Windows 11 的 PowerShell 5.1/7。完整 Windows 宿主补丁及界面验收与安装器测试分开，不能因安装通过就宣称全部功能正常。

## 安装前

- 确认用户授权，读取实际 DSH 版本和应用路径，先打开一次完成 profile 初始化。
- 默认数据目录 `~/.dsh`、profile `desktop`。不同目录/profile 必须显式指定，不能自动选另一个实例。
- 保留正在运行的任务；安装不会停止进程或自动重启。用户在任务结束后手动重开。
- 不需要管理员权限或全局 Node/pnpm；Desktop 入口使用该应用的 Electron 运行时和 CLI。遇到权限问题先核对路径，不建议盲目提权。

## 命令

macOS：下载 README 中的 `scripts/install.sh`，`sh /tmp/purge-install.sh --dry-run` 只校验，去掉 `--dry-run` 才安装。可以设置 `DSH_APP`、`DSH_HOME`、`PURGE_VERSION`，传入 `--version=1.6.26`、`--profile=desktop`。

Windows：下载 README 中的 `scripts/install.ps1`，`& "$env:TEMP\purge-install.ps1" -DryRun` 只校验。正式安装去掉 `-DryRun`。支持 `-DshExe 'C:\path\DeepSeek Harness.exe' -DshHome 'C:\path\home' -Profile desktop -Version 1.6.26`。应用路径不唯一会停止。默认先读取运行进程、卸载注册表中的安装位置，再检查常见目录；只读注册表，不写 PATH。

若 PowerShell 执行策略阻止，先审阅脚本，再用独立进程 `powershell -NoProfile -ExecutionPolicy Bypass -File "$env:TEMP\purge-install.ps1"`；不需要 `Set-ExecutionPolicy` 修改全局/持久策略。不用 `iex` 执行返回内容。

Web/Headless：下载本仓库发行 `.tgz` 与 SHA256SUMS，校验**该文件对应的那一行**后解包，用当前服务的 Node 执行 `package/bin/community.js migrate <绝对tgz路径>`；设置 `PURGE_DSH_CLI`、`DSH_HOME`、`DSH_PROFILE` 指向该实例。不要使用 Desktop 自动发现。维护定位见 [WEB-MAINTENANCE.md](WEB-MAINTENANCE.md)。

### Linux CLI / Web

已在 CachyOS x86_64、DSH 0.2.1-rc.2 上验证。仓库内运行 `sh scripts/install.sh --dry-run`，核对来源与 SHA256 后去掉 `--dry-run` 安装。默认使用 PATH 中的 `node` / `dsh` 和 `web` profile；可设置 `DSH_NODE`、`PURGE_DSH_CLI`、`DSH_HOME`、`--profile=名称`，已有 Linux Electron 桌面程序可显式设置 `DSH_APP`，默认 profile 随之变为 `desktop`。

安装本分支未发布的代码时，先打包，再使用 `--archive=/绝对路径/包.tgz --sha256=预期摘要`。本地包也验证包名、版本和仓库身份；依赖安装仍需要网络或缓存。完整命令见 [README 的 Linux 安装入口](../README.md#linux--cli--web)。

系统 npm 目录不可写时，安装器保留原安装，将完整宿主复制到用户目录，插件迁移成功后才创建或切换 `~/.local/bin/dsh`。迁移失败保留原入口；未激活副本供重试复用。入口被并发修改则停止，不覆盖用户命令。退出旧服务、用该入口启动后再应用补丁；网页刷新不会切换入口。已有无关启动器不覆盖，dry run 不复制宿主；不修改 `/usr` 权限。更新系统 DSH 后，需显式选择新的系统 CLI 重新运行安装器以建立新副本。

## 安装器承诺与边界

1. 仅从本仓库稳定 GitHub Release 下载，限制跳转来源、下载大小和等待时间。
2. SHA256 只匹配下载的版本包，不要求清单中的稳定别名也已下载；重复条目或校验不符停止。
3. 解包前检查文件路径，安装前核对 package name/version/repository，再调用发行包迁移器。
4. 迁移器先建快照，将包保存在持久目录后交给 DSH CLI，避免下次解析指向已清理的临时文件。
5. 现有提示词、规则和其他插件配置不被重写；Purge 的依赖版本与启用入口会更新，profile 锁文件由 DSH 包管理器维护。
6. 退出码非零就是失败，临时下载会清理，持久快照保留。不自动 apply、不重新启动 DSH。

## Issue #7：镜像缺版本

日志特征：`ERR_PNPM_MINIMUM_RELEASE_AGE_VIOLATION`，唯一失败项为 `@dsh-ops/bash-win32-x64@<版本>`，原因明确是 `version not present in registry manifest`。

调查时 npm 官方源存在 0.2.1，npmmirror 元数据缺少这个版本。该状态会变化，不能永久假设镜像缺失；安装器每次遇到此错误才实时核对官方元数据。

恢复范围很窄：读取当前 profile 的生效源；只有该 scope 或默认源明确为 `https://registry.npmmirror.com/`，且官方响应的包名、版本、发布时间、SHA512 与 tarball 来源完整时，才给本次 CLI 增加 `--config.@dsh-ops:registry=https://registry.npmjs.org/`，重试一次。其他依赖沿用原源；不写 `.npmrc`。pnpm 仍自行检查发布时间、完整性和信任策略，官方有包不等于必然允许安装。

私有/未知源不会回退；真实“发布时间不足”、integrity/trust 错误不会回退；官方查询失败或重试失败就停止，不继续猜测。

市场 JSON 首次安装先执行 DSH 的包管理器，插件尚未加载，无法利用插件内修复。可在 DSH 安装对话框选择 npm 官方源重试，或使用本版独立安装器。直接换 tarball 仍可能在宿主依赖校验阶段失败。不要声称我们已经修改了官方 DSH 安装器。

`HEAD https://github.com/... UND_ERR_DESTROYED` 属 GitHub 网络问题。保留完整脱敏日志区分错误；切 npm 源不保证修复 GitHub 连接。

## 失败、备份与回滚

- 记录失败阶段、DSH/插件版本、profile、下载源与 backup_id；隐藏用户名、私有地址、token。
- 下载/校验失败尚未执行迁移，不应有安装改动。迁移失败保留快照，不能先删备份。
- `purge-community backup` 显式备份；`purge-community rollback <id>` 验证快照后回滚插件代码与入口，保留当前用户内容。原锁文件保存在快照供核对，不盲目覆盖其他插件的新依赖。
- 如果失败导致插件无法启动，可用已验证发行包的 `bin/community.js rollback <id>` 配合明确的当前 CLI/home/profile。见 [维护文档](MAINTENANCE.md)。
- 禁止通用“修复”动作：删全部锁文件、清空全局缓存、关闭 minimumReleaseAge/trust/integrity、全局换源、自动重启或自动重打宿主补丁。

## 开发验收

`node --test test/install-registry.test.mjs test/bootstrap-install.test.mjs` 覆盖正常安装、精确错误重试、私有源、混合错误、官方缺元数据、网络失败、SHA256 稳定别名、临时路径与子进程。`test/install-windows.ps1` 在 Windows PowerShell 5.1 和 PowerShell 7 验证入口参数、路径、退出状态和环境恢复。CI 在 Linux/macOS/Windows 执行安装器测试。真实 DSH 隔离 profile 的迁移/回滚另行记录；这些测试均不能替代完整 Windows DSH UI/宿主补丁验收。

## Windows 历史真实运行时回归

官方 Desktop 是 GUI 子系统 exe，PowerShell call operator 不足以证明安装结束。安装器通过 Start-Process 等待进程，读取实际退出码和 UTF-8 输出后才删除临时脚本。CI 增加延迟读取 bootstrap 的 GUI 子系统测试，防止再次出现假成功与 MODULE_NOT_FOUND。生产安装不需要 .NET 编译器；GUI 测试程序只由开发/CI 编译。

历史版本在真实 Windows 11 专业版（build 26300）使用签名有效的官方 Desktop 0.2.1-rc.2 运行时、独立应用副本、DSH_HOME 和 user-data-dir 验证下载校验、安装、快照、回滚及设置保留，PowerShell 5.1/7 回归通过。该证据不代表登录、完整 UI 或全部宿主补丁已经验收。详见 [1.6.10 记录](releases/1.6.10.md)。

1.6.14 修复 macOS CLI 执行位丢失，并增加只读 host-status。当前版本的测试范围见 [1.6.14 验收记录](releases/1.6.14.md)，不要将历史 Windows 桌面验收写成本版重新进行了完整界面验收。

## 1.6.29：回滚与网络

面板回滚通过归档安装并校验新进程加载，失败恢复本轮前的依赖图。更新代理只作用于插件请求，不修改系统；token 仅发往 GitHub API。环境变量需由实际宿主进程继承。旧版本损坏 link 可用校验后的新版发行包通过独立入口恢复；不要删用户设置或全局缓存。限制及实测方法见 [维护说明](maintenance-issues-34-35.md)。

## 1.6.39：慢网更新与审计属主

归档预算使用 `PURGE_DOWNLOAD_TIMEOUT_MS`（默认 180000，范围 30000–900000）；可选 `PURGE_GH_MIRROR` 仅传输社区 TGZ，官方摘要不可用就停止。容器 root home 需明确服务 UID/GID；不要扩大权限或改全局代理。完整步骤、变量及测试边界见 [维护说明](maintenance-issues-44-47.md)。不自动重启。

## #52：下载失败与备用通道

新版独立安装器会报告 `[download] stage=archive host=github.com transport=fetch attempt=1/3 code=…`。最多两次 fetch 和一次系统 curl；来源、证书与 SHA256 不会因此放宽。先重新下载入口脚本并执行 dry-run；保留失败阶段与错误码即可，不要粘贴代理密码、完整环境变量或签名下载 URL。详情见 [下载诊断](maintenance-issue-52.md)。

## 1.6.41：更新状态核对

运行版本与当前 profile 磁盘版本分开核对；旧 pendingVersion 不代表当前安装。未知版本或读取失败继续告警，安装失败不会被成功检查掩盖。旧版已卡住时先手动安装新版，由用户手动退出重开一次；不要删除设置、改更新开关或自动重启。详见 [状态迁移与测试说明](maintenance-update-state.md)。
