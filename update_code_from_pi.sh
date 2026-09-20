#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$ROOT"

UPSTREAM_URL="https://github.com/earendil-works/pi.git"
UPSTREAM_REMOTE="upstream"
BRANCH="main"

echo "=== [1/6] 配置 Git 环境与 Remote ==="
git config rerere.enabled true
git config rerere.autoupdate true
git config merge.conflictStyle zdiff3

# 检查/更新 remote
if ! git remote | grep -q "^${UPSTREAM_REMOTE}$"; then
  echo "添加 upstream remote: ${UPSTREAM_URL}..."
  git remote add "$UPSTREAM_REMOTE" "$UPSTREAM_URL"
else
  git remote set-url "$UPSTREAM_REMOTE" "$UPSTREAM_URL"
fi

echo "=== [2/6] 从官方 upstream 拉取最新代码 ==="
git fetch "$UPSTREAM_REMOTE"

# 防静默不同步：校验本地 tracking ref 与远端 main 是否一致
LOCAL_REF=$(git rev-parse "refs/remotes/$UPSTREAM_REMOTE/$BRANCH" 2>/dev/null || echo "")
REMOTE_REF=$(git ls-remote "$UPSTREAM_REMOTE" "$BRANCH" 2>/dev/null | awk '{print $1}' | head -1)

if [ -n "$REMOTE_REF" ] && [ -n "$LOCAL_REF" ]; then
  if [ "$LOCAL_REF" != "$REMOTE_REF" ]; then
    echo "⚠️ 本地 tracking ref ($LOCAL_REF) 与远端 ($REMOTE_REF) 不一致，强制更新..."
    git update-ref "refs/remotes/$UPSTREAM_REMOTE/$BRANCH" "$REMOTE_REF"
  fi
fi

UPSTREAM_SHA=$(git rev-parse --short "refs/remotes/$UPSTREAM_REMOTE/$BRANCH")
echo "Upstream 最新版本: $UPSTREAM_SHA"

CURRENT_BRANCH=$(git branch --show-current)
if [ "$CURRENT_BRANCH" != "$BRANCH" ]; then
  echo "警告: 当前分支不是 $BRANCH (当前: $CURRENT_BRANCH)"
fi

BEHIND_COUNT=$(git rev-list --count "HEAD..${UPSTREAM_REMOTE}/${BRANCH}")
AHEAD_COUNT=$(git rev-list --count "${UPSTREAM_REMOTE}/${BRANCH}..HEAD")
echo "状态: 领先 upstream $AHEAD_COUNT 个提交，落后 upstream $BEHIND_COUNT 个提交"

if [ "$BEHIND_COUNT" -eq 0 ]; then
  echo "✅ 当前分支已包含 ${UPSTREAM_REMOTE}/${BRANCH} 最新代码，无需合并。"
else
  echo "=== [3/6] 合并 ${UPSTREAM_REMOTE}/${BRANCH} 到当前分支 ==="
  GEN_FILES=(
    "package-lock.json"
    "packages/coding-agent/npm-shrinkwrap.json"
    "packages/coding-agent/install-lock/package-lock.json"
  )

  if git merge --no-edit "${UPSTREAM_REMOTE}/${BRANCH}"; then
    echo "✅ 合并成功（无冲突）"
  else
    echo "检测到合并冲突，尝试自动处理生成物冲突..."
    for f in "${GEN_FILES[@]}"; do
      if git diff --name-only --diff-filter=U -- "$f" | grep -q .; then
        echo "  - $f: 采用上游版本并标记解决（后续脚本自动重新生成）"
        git checkout --theirs -- "$f"
        git add "$f"
      fi
    done

    REMAINING_CONFLICTS=$(git diff --name-only --diff-filter=U)
    if [ -n "$REMAINING_CONFLICTS" ]; then
      echo "❌ 存在源码或配置文件冲突，需人工/AI根据 pi-enhance.md 解决："
      echo "$REMAINING_CONFLICTS"
      echo ""
      echo "解决冲突后请执行: git add <files> && git commit --no-edit"
      exit 1
    else
      echo "✅ 生成物冲突已自动解决，完成合并 commit..."
      git commit --no-edit
    fi
  fi
fi

echo "=== [4/6] 安装依赖、水合模型数据并重新生成锁文件 ==="
npm install --ignore-scripts
if ! npm run check:model-data >/dev/null 2>&1; then
  echo "水合模型数据..."
  npm run hydrate:model-data
fi
echo "重新生成 coding-agent shrinkwrap..."
node scripts/generate-coding-agent-shrinkwrap.mjs
echo "重新生成 coding-agent install-lock..."
node scripts/generate-coding-agent-install-lock.mjs

echo "=== [5/6] 运行上游依赖完整性不变量与静态检查 ==="
node scripts/check-pinned-deps.mjs
node scripts/check-runtime-deps.mjs
node scripts/generate-coding-agent-install-lock.mjs --check
node scripts/generate-coding-agent-shrinkwrap.mjs --check
npm run check
echo "✅ 所有不变量检查与 npm run check 全部通过！"

echo "=== [6/6] 差异统计（当前分支 vs ${UPSTREAM_REMOTE}/${BRANCH}）==="
echo "基准: ${UPSTREAM_REMOTE}/${BRANCH} @ $(git rev-parse --short "refs/remotes/${UPSTREAM_REMOTE}/${BRANCH}")"
git diff --shortstat "${UPSTREAM_REMOTE}/${BRANCH}...HEAD"
echo "修改的官方文件清单："
git diff --name-status "${UPSTREAM_REMOTE}/${BRANCH}...HEAD" | awk '$1=="M"{print "  M "$2}'

echo ""
echo "🎉 上游同步完成！请按需更新 pi-enhance.md 中的基准说明与差异记录。"
