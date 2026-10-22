# #38：默认预设的诊断状态

## 根因

1.6.30 的统计收紧是为了避免必需文件缺失却显示成功，但漏测了自带默认预设的实际状态。#76 没有匹配目标时，核心状态仍是 skipped；旧统计忽略可选项，新统计将其判为 broken。

## 修复边界

不向 #76 添加宽泛的 settleWhenAbsent，不改变 core 的检查或写入逻辑。只在 selfCheck 内细化 #76 的 skipped：读取明确 DSH_HOME 下的 .agent-presets/unrestricted/agent.cordis.yml，通过 YAML AST 检查单一 persona 的字面 prefix。不执行 !!js，不解析别名或从其他 home 补读。

- 正文不含该项目标句：not_needed，仅从自检必需分母排除，保留说明。
- 正文仍有目标句但当前锚点不匹配：保持 skipped/broken。
- 无法读取、结构异常、动态或继承配置：unknown，不声称已完成，不建议通过反复应用或修改权限来消除。
- pending/applied/na 与其他补丁状态不变。不要推广为所有 optional/skipped 都算成功。

因此核心 status/diagnose 与 selfcheck 的原始状态可能不同；selfcheck 多了只读静态证据，not_needed 不是一次成功应用。

## 测试与维护

node --test test/selfcheck.test.mjs 覆盖真实默认预设、实际 patchStatus、selfCheck 汇总及异常边界。源码与发行包均测试。安装路径和备份/回滚实现未变，本版无用户配置迁移；回滚旧版本会恢复旧误报，但不需要恢复或覆盖用户预设文件。

实机验证：macOS 207/212 通过、5 项平台跳过；Windows 209/212 通过、3 项平台跳过（实际 TLS 与 Electron 交接均运行）。两端 Electron 44.7.0 与发行包 smoke 通过。测试脚本的 ASAR 文件需在 Electron 测试子进程退出后删除，Windows 的 npm.cmd 通过固定命令启动；这些均不修改实际安装器或宿主。三平台 CI 新增打包检查作为后续发布门禁。
