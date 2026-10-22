#!/usr/bin/env bash
# 为本镜像仓库发布新版本（打包 → 校验 → 建 release → 上传）
#
# 用法：
#   ./scripts/release-mirror.sh --dry-run
#   ./scripts/release-mirror.sh
#   ./scripts/release-mirror.sh --version 1.6.42
#
# 依赖：node/npm、git、curl、sha256sum（或 shasum）
# 可选：GITHUB_TOKEN 环境变量；缺省时尝试用 gh CLI 的 token

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

VERSION=""
DRY_RUN=0
SKIP_PACK=0

while [[ $# -gt 0 ]]; do
  case "$1" in
    --version) VERSION="$2"; shift 2 ;;
    --dry-run) DRY_RUN=1; shift ;;
    --skip-pack) SKIP_PACK=1; shift ;;
    -h|--help) sed -n '2,10p' "$0"; exit 0 ;;
    *) echo "未知参数: $1"; exit 1 ;;
  esac
done

# ---------- 1. 版本 ----------
NAME="$(node -p "require('./package.json').name")"
[[ -z "$VERSION" ]] && VERSION="$(node -p "require('./package.json').version")"
TAG="v$VERSION"
TGZ="$NAME-$VERSION.tgz"
echo "[1/6] 包: $NAME  版本: $VERSION  tag: $TAG"

# ---------- 2. 仓库 ----------
REPO_URL="$(node -p "require('./package.json').repository.url")"
REPO_URL="${REPO_URL#git+}"; REPO_URL="${REPO_URL%.git}"
SLUG="$(echo "$REPO_URL" | sed -E 's#https://github.com/([^/]+/[^/]+)$#\1#')"
[[ "$SLUG" == "$REPO_URL" ]] && { echo "无法解析仓库地址: $REPO_URL"; exit 1; }
echo "[2/6] 目标仓库: $SLUG"

# ---------- 3. 工作区 ----------
if [[ -n "$(git status --porcelain)" && $DRY_RUN -eq 0 ]]; then
  echo "[!] 工作区有未提交改动："; git status --short; exit 1
fi
echo "[3/6] 工作区检查完成"

# ---------- 4. 打包 ----------
if [[ $SKIP_PACK -eq 0 ]]; then
  rm -f ./*.tgz
  echo "[4/6] 打包中..."
  npm pack --ignore-scripts >/dev/null
else
  echo "[4/6] 跳过打包"
fi
[[ -f "$TGZ" ]] || { echo "找不到 $TGZ"; exit 1; }
echo "    $TGZ  ($(du -h "$TGZ" | cut -f1))"

# ---------- 5. 校验 ----------
if command -v sha256sum >/dev/null 2>&1; then
  HASH="$(sha256sum "$TGZ" | cut -d' ' -f1)"
else
  HASH="$(shasum -a 256 "$TGZ" | cut -d' ' -f1)"
fi
echo "$HASH  $TGZ" > SHA256SUMS.txt
echo "[5/6] SHA256: $HASH"

if [[ $DRY_RUN -eq 1 ]]; then
  echo
  echo "[DryRun] 将执行："
  echo "  - 创建/复用 release $TAG ($SLUG)"
  echo "  - 上传 $TGZ"
  echo "  - 上传 SHA256SUMS.txt"
  exit 0
fi

# ---------- 6. 发布 ----------
TOKEN="${GITHUB_TOKEN:-${GH_TOKEN:-}}"
if [[ -z "$TOKEN" ]] && command -v gh >/dev/null 2>&1; then
  TOKEN="$(gh auth token 2>/dev/null || true)"
fi
[[ -z "$TOKEN" ]] && { echo "需要 GITHUB_TOKEN 或 gh 登录"; exit 1; }

API="https://api.github.com/repos/$SLUG"
AUTH=(-H "Authorization: Bearer $TOKEN" -H "Accept: application/vnd.github+json" -H "User-Agent: $NAME-release")

REL_ID="$(curl -s "${AUTH[@]}" "$API/releases/tags/$TAG" | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{try{const j=JSON.parse(s);console.log(j.id||'')}catch{console.log('')}})")"

if [[ -z "$REL_ID" ]]; then
  BODY="$(node -e "console.log(JSON.stringify({tag_name:'$TAG',target_commitish:'main',name:'$TAG',body:'镜像发布：$NAME $VERSION\n\n- 安装包：$TGZ\n- 校验：SHA256SUMS.txt\n- 许可证：MIT（原作者署名保留于 LICENSE / NOTICE.md）',draft:false,prerelease:false}))")"
  REL_ID="$(curl -s "${AUTH[@]}" -X POST "$API/releases" -d "$BODY" | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{try{const j=JSON.parse(s);console.log(j.id||'')}catch{console.log('')}})")"
  echo "[6/6] release 已创建 (id=$REL_ID)"
else
  echo "[6/6] release 已存在 (id=$REL_ID)"
fi

# 删除同名旧附件
for f in "$TGZ" SHA256SUMS.txt; do
  AID="$(curl -s "${AUTH[@]}" "$API/releases/$REL_ID/assets" | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{try{const j=JSON.parse(s);const a=j.find(x=>x.name==='$f');console.log(a?a.id:'')}catch{console.log('')}})")"
  if [[ -n "$AID" ]]; then
    curl -s "${AUTH[@]}" -X DELETE "$API/releases/assets/$AID" >/dev/null
    echo "    删除旧附件: $f"
  fi
done

for f in "$TGZ" SHA256SUMS.txt; do
  curl -s "${AUTH[@]}" -H "Content-Type: application/octet-stream" \
    --data-binary "@$f" \
    "https://uploads.github.com/repos/$SLUG/releases/$REL_ID/assets?name=$f" >/dev/null
  echo "    已上传: $f"
done

echo
echo "完成：https://github.com/$SLUG/releases/tag/$TAG"
