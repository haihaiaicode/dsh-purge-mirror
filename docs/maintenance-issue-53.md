# #53：按预设隔离提示词注入

1.6.40 添加 `excludePresets`。默认 `[]`，不改变旧配置行为。

## 配置

备份当前 profile 的 `cordis.patch.yml`，在已有 `id: dsh-purge`（`name: dsh-purge-community`）条目的 `config` 中合并：

```yaml
excludePresets: [roleplay, minimal]
```

不要新增重复插件条目，不要覆盖其他字段。使用预设 ID，忽略大小写与首尾空格，精确匹配（`roleplay-extra` 不匹配 `roleplay`）。设回 `[]` 即恢复旧注入行为。

运行时优先读取当前挂载的预设，其次最新选择事件、投影和会话头。子 Agent 使用自己的有效预设；不会通过共享“最近预设”变量继承其他会话的状态。已配置排除列表、但宿主没有提供可解析预设时，暂停注入并记录 `assemble.excluded unknown=true`；应检查宿主上下文/重载，而不是无条件注入。

## 覆盖范围

- 主提示、head/tail/both、能力协议、boost、probe、postPrompt；
- assembly 重写和宿主兜底；可选 refusalRetry 按请求 sessionId 查询实际 Agent；无法识别会话时不追加提示；
- 清理带 Purge 命名空间的段落；本版本产生的改写附带内存来源记录，用于恢复自身改写/删除/添加的原生段落；
- 不改用户文本，不猜测删除历史纯文本中的内容。来源记录不持久化、不发送给模型；从旧版遗留的、已失去来源信息的纯文本应重新装配，不能承诺从历史聊天中抹掉。

被排除的会话保留装配服务提供的人设、工作区规则、工具和变量，不再由 Purge 执行提示词身份改写。已安装的全局宿主补丁、部署配置（例如 `includeHarnessIdentity`）、网络/权限设置和历史聊天仍保持原样。此选项不是逐会话撤销权限补丁，也不关闭插件命令、面板或工具。

## 升级与回滚

安装包只更新插件。旧宿主 #87 无参兜底调用需在用户选择的时间应用新版补丁，再手动完整退出并重开；本修复会把现有调用迁移为传入当前 Agent，重复应用不重复插入。未迁移时，非空排除列表下的无参兜底返回空，正常具备上下文的 section/assembly 仍按预设处理。

修改前备份 profile；撤销配置可恢复 `excludePresets: []`。如需回退代码，使用现有备份/回滚命令，再安排手动重载。新宿主传入的额外参数会被旧 JS 函数忽略，回滚不会改提示词原文、图库或代理。不要自动重启用户正在使用的 DSH。

## 测试

`test/preset-injection.test.mjs` 覆盖默认兼容、当前预设解析、所有注入段、残留清理、下游内容保留、100 路交错会话、子 Agent，以及旧无参调用的 LF/CRLF 迁移与幂等运行。

`scripts/check-preset-runtime.mjs` 对明确指定的真实宿主进行只读验收，在临时 profile 中调用其 Cordis、SystemPrompt 和迁移后的 step 请求构建代码：standard/minimal/roleplay 切换、60 路并行与子 Agent、complete 预设。请求构建止于模型调用前，不涉及实际付费模型、账号或用户聊天。该脚本也加入三平台官方 npm 宿主安装/回滚 CI。

```sh
PURGE_TEST_HOST=/path/to/isolated/node_modules/@deepseek-ai node scripts/check-preset-runtime.mjs
```

被排除的会话不会返回 Purge 探针，不能据此认定插件故障；检查全局注入链路时使用未排除的预设。

这验证的是确定性的注入边界和实际宿主服务，不将它描述为真实模型回答质量测试。
