# dsh-purge（镜像 / fork）

本仓库是 **dsh-purge-community 1.6.41** 的完整副本，用于备份与分发，代码与原版**完全一致**，未做任何功能改动。

## 来源与署名

- 上游项目：**dsh-purge**，作者 **小杨 / YuJunZhiXue**
  <https://github.com/YuJunZhiXue/dsh-purge>
- 本副本的直接来源：**dsh-purge-community**（该项目的独立维护分支）
  <https://github.com/kingcharleslzy-ai/dsh-purge>
- 原始版权与 MIT 许可证保留在 [LICENSE](LICENSE)，归属说明见 [NOTICE.md](NOTICE.md)，贡献者名单见 [CONTRIBUTORS.md](CONTRIBUTORS.md)

## 许可证

MIT。你可以自由使用、修改、再分发，包括商业用途，条件是**保留版权声明和许可证文本**（见 LICENSE）。

## 安装

```bash
dsh plugin install https://github.com/<your-account>/<this-repo>.git
```

或使用 npm 发布包（若已发布）：

```bash
dsh plugin install dsh-purge-community
```

## 功能

与原版一致：状态自检、提示词与规则管理、本机备份与回滚、预设管理、面板 UI 等。详见 [README.zh-CN.md](README.zh-CN.md)。

## 说明

- 本仓库不是上游官方发布，不代表原作者立场。
- 本仓库免费提供，不用于付费转售。
- 若上游更新，可自行同步：把新版本覆盖进来后提交即可。

## 发布新版本

本仓库自带发版脚本，一条命令完成「打包 → 校验 → 建 release → 上传附件」。

Windows：
``powershell
pwsh scripts/release-mirror.ps1 -DryRun    # 先看会发生什么
pwsh scripts/release-mirror.ps1            # 正式发布
``

Linux / macOS / Git Bash：
``bash
./scripts/release-mirror.sh --dry-run
./scripts/release-mirror.sh
``

流程：
1. 改 package.json 的 ersion
2. 提交并 push
3. 运行上面的脚本
4. 脚本会自动：
pm pack → 生成 SHA256SUMS.txt → 读取 package.json 的 epository.url 定位仓库 → 从 git credential 取 GitHub 凭据 → 创建 X.Y.Z release → 上传 tgz 与校验清单

可选参数：
- --version X.Y.Z / -Version X.Y.Z：不依赖 package.json 指定版本
- --skip-pack / -SkipPack：复用已有 tgz
- --dry-run / -DryRun：只打包和打印，不改远程

前提：本地至少 git push 过一次，让 Windows 凭据管理器 / git credential 保存 GitHub 凭据；Linux 下可用 GITHUB_TOKEN 环境变量或 gh auth login。
