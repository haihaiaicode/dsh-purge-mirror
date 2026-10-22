# PR #33：嵌套宿主定位与自检统计

支持两种布局：组件直接位于 `@deepseek-ai/`，或位于 `@deepseek-ai/dsh/node_modules/@deepseek-ai/`。用户可指定外层 scope、`dsh` 包目录或组件根。

## 入口与组件分开解析

- `currentHost()` 保留安装实例根的历史语义；不能为了读组件版本而改变安装器用来找 CLI 的根。
- `normalizeHostBase()` 只探测选定目录及两种固定的子路径，不扫描 PATH、全局 npm、其他 Desktop 或用户目录。
- 自检对显式路径、`DSH_BASE`、`PURGE_DSH_CLI` 和运行 argv 使用同一组件解析。
- 安装 CLI 支持外层 scope、包目录和该包的嵌套组件根；检查包名和 bin 路径，不能任意向上搜索。
- 裸 CLI 未提供实例信息时保留未知。请指定 `DSH_BASE` 或 `PURGE_DSH_CLI`，不能将别的安装的结果算到当前实例。

## 统计口径

自检按原始补丁条目计数；面板有合并显示组，因此两者的数字不保证相同。不能为了让数字相同而隐藏故障。

- `applied` / `already`：已确认完成。
- `na`、`off`：明确不适用或已关闭；不进入适用条目分母。
- `skipped`：仅 `settleWhenAbsent` 明确表示不需要迁移时排除；其余跳过仍保留诊断。
- `missing_file`：只有元数据标记为可选时才排除；必需目标缺失仍占分母并告警，包括未归入已有命名层的条目。
- 未知状态和读取失败不能折算成成功。

所有判读只影响诊断。宿主补丁表、提示词策略、工具注册、用户权限及更新偏好不改动。

## 验证

新增回归先在原 PR 上复现 CLI 定位失败、必需文件缺失却显示全部完成，再验证修复。覆盖三种路径、argv/CLI 入口、多安装共存、错误路径、限定探测范围、真实自检计数、未知和跳过状态。

Windows 实机使用新的隔离目录与 profile，通过真实 DSH CLI 执行发行版安装、候选升级、备份回滚、重新升级，以及安装后验证失败的恢复。使用真实 Electron/Cordis 验证插件入口、命令、工具、提示词 section 与路由注册和释放。隔离测试不启动或重启用户 DSH，不修改代理。

候选测试包使用 `1.6.30-pr33.1` 标识，仅用于隔离验收，不是正式发行。正式修复随 1.6.30 发布，PR #33 已合并。


实测结果：macOS 全量测试 205 项（200 通过、5 项平台跳过），Windows 11 / Node 22.23.2 全量测试 205 项（201 通过、4 项平台跳过）；Electron 44.7.0 通过。官方 npm `@deepseek-ai/dsh@0.2.1-rc.2` 的真实嵌套安装完成三种根目录下的安装、回滚及失败恢复。npm 版 DSH 需要可执行的 pnpm；测试仅向测试进程 PATH 添加隔离工具目录，不修改系统 PATH。

可复现的真实 CLI 测试入口为 `scripts/verify-rollback-runtime.mjs <baseline.tgz> <candidate.tgz>`。先用目标 DSH CLI 初始化一个新的空 profile，然后提供 `PURGE_TEST_HOME` / `PURGE_TEST_PROFILE` 和 `PURGE_DSH_CLI`。验证嵌套布局时，以 `PURGE_TEST_HOST_BASE` 指向隔离 npm 安装的外层 `@deepseek-ai` 目录，并取消 `PURGE_DSH_CLI`，脚本会分别用外层、包根及组件根执行维护。不要指定日常使用的 home/profile。
