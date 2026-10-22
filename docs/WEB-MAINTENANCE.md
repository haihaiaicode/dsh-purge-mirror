# Web / Headless 维护定位（issue #3）

此修复限于维护界面、CLI 与只读自检的实例识别，不改变权限选择、补丁表、提示词或现有清理策略。

## 备份列表与操作结果

- 进入或重新挂载维护面板时读取列表；可以手动刷新。
- 分别显示读取中、读取失败和暂无备份，失败不伪装成空列表。
- 不自动选中回滚目标；选中的备份不再存在时清空选择。
- 更新、回滚或备份失败后只重新读取列表，不自动重试写操作。失败过程已经生成的恢复快照也能看到。
- HTTP 200 不等于操作成功：JSON 的 `ok:false`、错误数组和部分成功都会显示真实结果。
- 更新成功会显示版本和重启提示；需要重启的是服务端 DSH 进程，仅刷新浏览器不会重新加载后端。插件不会代替用户停止或重启服务。

## 当前 profile

维护、备份与权限自检共用解析器，按以下顺序使用信息：

1. 调用方显式指定的 profile / `PURGE_PROFILE_DIR`。
2. 宿主启动参数中的当前 `DSH_HOME/profiles/<name>` 目录。
3. `--profile <name>` 或 `--profile=<name>`。
4. `DSH_PROFILE`。
5. 唯一已初始化的 profile（目录有 package.json）。

多个 profile 且无明确线索时直接报错，不默认选 desktop。显式指定的目录不存在、启动参数与 DSH_HOME 冲突，也不会静默改选另一个目录。

例如，服务实际使用 web profile 时，可在**该服务的启动环境**设置 `DSH_PROFILE=web`；自定义目录使用 `PURGE_PROFILE_DIR`。这些变量只说明当前目标，不设置沙箱或审批权限。

## 安装 CLI

显式 `PURGE_DSH_CLI` 仍然优先，可以指向当前服务使用的可执行启动器或 npm CLI 的 `.js/.mjs/.cjs` 文件。

未指定时，安装器只在当前启动路径/目标宿主中定位：npm 部署读取 `@deepseek-ai/dsh` 的 package.json 中声明的 `bin.dsh`；Desktop 使用该实例自身的 Resources。不会从 PATH、其他全局 npm 安装或另一份桌面应用猜一个 CLI。

子进程使用当前服务的 Node 执行 JS CLI，并传入当前 `DSH_HOME` 与选定的 profile。独立运行 `purge-community` 时，如无法从启动信息确定目标，请明确设置 `DSH_BASE` 或 `PURGE_DSH_CLI`；不要让它猜另一份安装。

## Web 与 Desktop 共存

只读自检的“宿主运行方式”针对当前被检查的宿主路径：

- Web：桌面 app.asar 检查为“不适用”，应用数和总数均为 0，不计入布局失败。
- Desktop：只检查该目标自身的 app.asar，不扫描其他桌面安装。
- 目标不明确或无法读取：报告无法确定，不当成成功。

权限项仍只读取实际 profile。用户有意选择需要审批的权限，会保持原配置及真实状态，不会为了让自检全绿自动调整。

## 验证范围

回归覆盖 React 面板挂载/重新进入、业务失败、部分更新、失败后的快照、当前/冲突 profile、npm CLI 子进程参数、Web/Desktop 共存及未知状态。

CLI 执行测试使用临时目录里的可控 npm CLI 测试入口，未安装到用户 DSH，也未宣称完成真实 Linux Web 服务或所有补丁的端到端验收。
