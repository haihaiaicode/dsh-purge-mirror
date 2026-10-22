# #52：独立安装器下载失败

## 证据与根因边界

报告者能用 curl 下载 raw 安装脚本，但在 `Downloading Purge Community 1.6.38...` 后仅看到 `fetch failed`。1.6.38 Release、归档和 SHA256 清单均存在；维护端实际下载、核对 SHA256、Electron dry-run 成功。因此没有证据认定发行附件丢失，也不能仅凭这行报错断定报告者是代理、证书或超时。

已确认的代码缺陷是：独立 bootstrap 使用一次性 Node fetch，未提供备用传输；顶层仅显示 error.message，丢弃 cause/聚合连接错误。curl 与 Node/Electron fetch 的代理和证书处理可以不同。插件内 update-http 的修复没有覆盖独立入口。

## 1.6.39 的修复

- 保持 bootstrap 自包含，仅使用 Node 内建模块，不依赖尚未安装的包。
- 每个下载最多两次 fetch，然后一次系统 curl；只对已识别的瞬时网络错误或 HTTP 408/429/500/502/503/504 重试。每次从原始官方地址重新开始，不重用过期的签名重定向。
- metadata/checksum 总预算各 60 秒；archive 默认 180 秒，沿用 `PURGE_DOWNLOAD_TIMEOUT_MS` 的 30000–900000 范围。fetch 每一跳最多 20 秒，所有重试共享总预算。
- 系统 curl 使用固定路径、不经 shell、不读 curlrc、不自动跳转。每一跳检查 HTTPS、443、无 URL 凭证及官方域名白名单；响应头和正文均有大小上限。curl stdout 按 HTTP 头和二进制正文分离，支持 interim 响应；部分失败内容不复用。
- 所有通道保持 TLS 校验。显式 `CURL_CA_BUNDLE` 作为 `--cacert` 传给 curl，兼容 Windows Schannel；不会安装证书或更改系统信任库。fetch 明确报告证书错误时直接停止，不以备用通道绕过该错误。
- 来源、证书、大小、永久 HTTP 错误及 SHA256 不符都保持失败。下载完成仍需检查 SHA256、归档路径、包名/版本/仓库身份，才进入原迁移器。
- 日志输出 stage/host/transport/attempt/code，递归展开 cause 和 AggregateError 的错误码。原始 error/stderr、代理 URL、签名 URL、令牌不输出。

## 网络与设置边界

本修复不修改系统代理、Clash、DSH 设置、profile、用户提示词、预设或原有功能；不自动 apply/restart。curl 只继承进程环境和系统默认信任库，不保证读取 Windows/macOS GUI 代理、PAC 或插件专用 `PURGE_HTTPS_PROXY`，也不添加镜像。若当前环境两条通道都不可达，明确报错，不自动改网络。

系统 curl 缺失会报告 CURL_UNAVAILABLE。下载或校验失败尚未进入迁移，无须安装回滚、清锁文件或删配置。`--dry-run`/`-DryRun` 仍只校验下载，不安装。

## 复测与需要报告者补充的内容

1. 重新下载 master 的 install.sh/install.ps1，避免沿用旧入口；运行 dry-run。
2. 若成功，去掉 dry-run 再按自己的意愿安装；需要加载新版时手动重开 DSH。
3. 若失败，提供 OS/DSH 版本、失败的 `[download]` / `Release download failed` 行，说明是否能在浏览器下载同一发行附件，以及终端是否继承代理（只回答是/否，不贴地址或凭证）。
4. 关注 `stage=metadata`（API）、`archive`（GitHub/CDN）、`checksum`（校验清单）；403/404不应泛化成超时。新版日志用于确认报告者具体网络根因，不声称已经在他的机器复现。

## 测试

- `test/bootstrap-download.test.mjs`：重试次数、备用通道、来源/端口/凭证拒绝、错误分层和脱敏、截断与限额、预算、SHA256 失败不安装和设置不变。
- `test/bootstrap-curl.test.mjs`：本地真实 TLS + CONNECT 代理，真实系统 curl 的二进制下载、interim 响应、逐跳来源拦截、curlrc 不加载、超大响应、超时、无效证书拒绝。测试代理仅注入测试子进程，不写系统代理或证书库。
- `scripts/check-bootstrap-download-runtime.mjs [版本]`：在选定 Node/Electron 中下载真实官方 Release 并核对摘要；分别跑默认路径和只对 fetch 注入网络错误、由真实 curl 完成归档与清单下载。使用一次性 profile，禁止进入安装。
- 其余安装、权限、备份、回滚与宿主功能回归保留。下载实测不能替代完整 DSH 图形界面或模型能力测试。

本地验收（2026-10-21）：macOS 全量 269 项，257 通过、12 项环境/平台跳过；Windows 11 实机全量 269 项，246 通过、23 项环境/平台跳过。新增真实 curl/TLS 用例在两端均执行通过，没有跳过。两端使用 Electron 44.7.0 实际下载 1.6.38 官方归档与清单，默认路径和注入 fetch 失败后的 curl 路径均通过 SHA256；隔离 profile 设置保持原字节。既有 Electron 诊断通过，macOS 在一次性 Electron 副本完成手动退出换包/回滚回归，未重启用户 DSH。完整三平台官方 npm 宿主安装/回滚由 PR CI 另行执行，不与以上下载验收混为一项。
