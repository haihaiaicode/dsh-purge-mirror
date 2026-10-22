// 文档跟着版本走：版本号、发行说明首行、英文 README 的版本行必须一致。
// 放在 CI 里跑，避免"代码发版了、README 还停在上一个版本"。
import fs from "node:fs";

const read = (file) => fs.readFileSync(file, "utf8");
const pkg = JSON.parse(read("package.json"));
const version = pkg.version;
const notesFirst = read("release-notes.md").split("\n")[0].trim();
const readme = read("README.md");
const readmeEn = read("docs/README.en.md");
const agents = read("AGENTS.md");

const problems = [];
if (read("README.zh-CN.md") !== readme) problems.push("README.zh-CN.md 必须与 README.md 保持一致");
for (const file of ["docs/MAINTENANCE.md", "docs/INSTALLATION.md"]) {
  if (!read(file).includes(`当前版本 **${version}**`)) problems.push(`${file} 当前版本未同步到 ${version}`);
}
for (const [file, needles] of [
  ["README.md", ["scripts/install.ps1", "issue #7", "插件加载前", "不修改全局 npm 源"]],
  ["AGENTS.md", ["scripts/install.ps1", "minimumReleaseAge=0", "不要安装后自动 apply/restart"]],
]) {
  for (const needle of needles) if (!read(file).includes(needle)) problems.push(`${file} 缺少安装边界：${needle}`);
}
if (notesFirst !== `# ${version}`) {
  problems.push(`release-notes.md 首行应为 "# ${version}"，实际是 "${notesFirst}"`);
}
if (!readme.includes(`**${version}**`)) {
  problems.push(`README.md 首屏缺少版本号 **${version}**`);
}
if (!readme.includes("raw.githubusercontent.com/kingcharleslzy-ai/dsh-purge/master/scripts/install.sh")) {
  problems.push("README.md 缺少一行安装命令");
}
if (!readmeEn.includes(`Current version ${version}`)) {
  problems.push(`docs/README.en.md 缺少 "Current version ${version}"`);
}
if (!agents.includes(`当前版本：**${version}**`)) {
  problems.push(`AGENTS.md 缺少 "当前版本：**${version}**"`);
}
if (!agents.includes(`\`dsh-purge-community\` ${version}`)) {
  problems.push(`AGENTS.md §9 版本表未同步到 ${version}`);
}
const hostLine = readme.match(/适配 \*\*DSH Desktop ([0-9a-z.\-]+)\*\*/i);
if (!hostLine) problems.push("README.md 缺少「适配 DSH Desktop …」的版本行");

if (problems.length) {
  console.error("✗ 文档与版本不一致：");
  for (const p of problems) console.error("  - " + p);
  process.exit(1);
}
console.log(`✓ 文档版本一致：${version}（README / release-notes / README.en 均指向该版本）`);
