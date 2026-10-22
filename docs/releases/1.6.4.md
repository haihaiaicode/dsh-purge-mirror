# 1.6.4

Web / Headless 维护修复版本，合并 [PR #4](https://github.com/kingcharleslzy-ai/dsh-purge/pull/4)，解决 [issue #3](https://github.com/kingcharleslzy-ai/dsh-purge/issues/3)。

## 修复了什么

- **备份列表刷新后为空**：进入或重新打开维护页会自动读取备份，增加刷新入口，区分加载中、读取失败和暂无备份；不自动选择回滚目标。
- **失败被误报成功**：正确识别 HTTP 200 中的 `ok:false`，分别显示备份、更新、回滚的结果及部分更新状态，不再出现“备份已创建：undefined”。维护失败后重新读取可能已创建的恢复快照，不自动重试写操作。
- **更新后的加载提示不清楚**：安装成功展示版本，并明确需要重启服务端 DSH 进程；仅刷新浏览器不会加载新版后端。
- **npm CLI / profile 定位不完整**：维护、安装和只读自检共用当前实例解析逻辑；npm CLI 从当前包声明的 bin 定位，保留 `PURGE_DSH_CLI` 显式覆盖。支持符号链接，传递准确的 DSH_HOME/profile，不猜测其他全局安装；冲突或无法确定时明确报错。
- **Web 自检误查另一份 Desktop**：Web 的 app.asar 检查标为“不适用”，不计入布局失败；Desktop 只检查目标自身的资源目录，无法读取或目标未知时不会误报成功。

本次不改变权限选择、提示词、补丁表及备份清理策略。发布不会替用户安装或重启本机 DSH。

## 安装包与升级

附件提供 `dsh-purge-community-1.6.4.tgz` 和 `SHA256SUMS.txt`，请校验后安装。现有用户可通过插件维护页选择本版本更新；安装完成后手动重启 DSH 进程。维护定位与环境变量说明见 [Web / Headless 文档](https://github.com/kingcharleslzy-ai/dsh-purge/blob/v1.6.4/docs/WEB-MAINTENANCE.md)。

## 验证范围

- 52 项后端测试通过，包含 15 项实例解析、CLI 参数和隔离测试。
- 面板既有测试及 6 项新增维护交互测试通过；发行客户端资源已重新构建。
- 构建一致性、文档版本、模块导入和发行包 smoke 检查通过。
- npm CLI 执行测试使用临时目录中的可控入口，未宣称完成真实 Linux Web 服务或全部宿主补丁的端到端验收。

## 感谢贡献者

感谢 [@heigit](https://github.com/heigit) 提交详尽的复现、源码分析与验证反馈；同时补录此前 [PR #1](https://github.com/kingcharleslzy-ai/dsh-purge/pull/1) 的代码贡献者 [@luowang-ui](https://github.com/luowang-ui)。两位已加入 README、包元数据和 [贡献者名单](https://github.com/kingcharleslzy-ai/dsh-purge/blob/v1.6.4/CONTRIBUTORS.md)，原作者署名保留。

[1.6.3 发布记录](https://github.com/kingcharleslzy-ai/dsh-purge/releases/tag/v1.6.3) · [历史说明存档](https://github.com/kingcharleslzy-ai/dsh-purge/blob/v1.6.4/docs/releases/1.6.3.md)
