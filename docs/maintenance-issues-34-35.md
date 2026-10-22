# 面板回滚与更新网络维护（1.6.29）

## #34：面板回滚缺依赖

`Maintenance.rollback()` 过去把快照展开后直接交给 DSH 安装目录，包管理器写入 `link:`，但快照不含 `node_modules`。因此安装命令成功不代表插件可加载。1.6.28 修的是另一条旧更新器目录恢复路径，未覆盖面板回滚；其发布说明不能视为此入口已通过验证。

现在把经过快照校验的完整文件树打成 `.tgz`，通过当前实例的 DSH CLI 安装。安装后在新进程验证包名、版本、声明依赖解析和入口导入，避免宿主模块缓存掩盖缺依赖。只导入模块，不调用插件 apply、不修改宿主、不启动或重启 DSH。

安装前保留本轮 profile 的依赖图、package.json 和锁文件；失败时恢复本轮开始前的安装，并保留故障目录与备份。若检测到其他依赖或 profile 元数据并发变更，停止自动覆盖并明确报告恢复未完成。成功后清理临时依赖副本；回滚期间需要容纳一份当前依赖图的额外空间。不会用旧快照覆盖当前提示词、规则或其他插件设置。

支持旧 schema 1/2 快照。不能用“把 yaml 从别处链接过来”替代依赖解析，否则不同旧版本的依赖仍可能不匹配。Windows Node 22 的递归 `fs.cpSync` 在实机链接树上发生原生退出，临时图复制改为显式遍历、不递归跟随链接。

## #35：两套更新请求统一

社区发行包和旧更新通道共用 `lib/update-http.js`。统一 TLS、重定向白名单、体积限制、整体超时、认证及代理选择。正式包 SHA256 和旧 ZIP Git tree 校验仍必需。

- Token：读取**宿主进程已有环境** `GITHUB_TOKEN`，其次 `GH_TOKEN`。只发给 HTTPS `api.github.com`，每次跳转重新计算；不发给下载 CDN、Atom 页面或代理 CONNECT。没有 token 仍支持匿名请求。
- 代理：`PURGE_HTTPS_PROXY` → `https_proxy` / `HTTPS_PROXY` → `http_proxy` / `HTTP_PROXY` → Windows 当前用户静态系统代理。尊重 `no_proxy` / `NO_PROXY`。显式空 `PURGE_HTTPS_PROXY` 表示此更新请求直连。支持 HTTP/HTTPS CONNECT（含代理认证），保持证书校验。
- 仅**读取** Windows `Internet Settings`；不修改注册表、Clash、系统代理、全局 Node Agent、SSH、用户提示词或权限。macOS/Linux 使用显式环境代理；本版未新增 Linux 安装入口。
- PAC/WPAD 不执行；只设置 PAC 且没有静态代理时明确提示使用环境代理。SOCKS 尚未支持，配置时明确报错，不悄悄直连。
- 环境变量必须存在于启动 DSH 的进程环境；在另一个终端设置不会改变已运行的桌面进程。由用户决定何时手动重开，不自动重启。不要把 token 写入 issue、截图、日志或公开配置。
- 403 不一律等于限流：结合 rate-limit 响应头区分额度耗尽、认证/权限、404、连接错误、超时。额度耗尽时显示重置时间。Atom 降级失败及使用旧列表都有可见说明，不把旧列表称为“已确认最新”。
- 独立 bootstrap 安装脚本在插件加载前运行，仍是自包含下载器；本节的环境代理兼容层适用于插件内更新请求，不能把旧宿主或所有下载工具都声称已改造。

## 验收要求

1. 在临时 DSH_HOME/profile，使用真实 DSH CLI 安装公开 1.6.28；旧面板回滚生成 link 并复现缺依赖。
2. 新版安装器恢复损坏链接；新版面板回滚旧快照、重新升级；每步在新进程导入入口。
3. 在真实安装完成后注入一次验证失败，确认 package.json、锁文件、原版本依赖及入口恢复。
4. Windows 4090 实机运行以上流程和自动测试；比较原有设置文件及代理注册表摘要，不操作正在运行的 DSH。
5. 本地临时 HTTPS 服务和 CONNECT 代理验证真实 TLS、代理认证、跨域 token 隔离、响应限额和整体超时。测试 CA 仅通过测试子进程环境加载，不进入系统证书库。
6. 发布前保存真实产物、测试结果和校验记录。Node/Electron 导入与服务注册验证不等于用户桌面 GUI 全量验收。

可复用实测入口：`scripts/verify-rollback-runtime.mjs`。仅使用新建隔离 profile，显式设置 `PURGE_TEST_HOME`、`PURGE_TEST_PROFILE`、`PURGE_DSH_CLI`，传入旧版和候选版 tgz；禁止把日常用户 profile 当测试夹具。
