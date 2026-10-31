#!/usr/bin/env bash
# 把安卓工程里的网页资源同步到 iOS 工程的 Resources/www。
#
# 网页只有一份（android/app/assets/www），不复制进版本库——1.3MB 的 data.js
# 存两份迟早会改一边忘一边。构建前跑一次这个脚本即可。
#
#   bash ios/scripts/prepare.sh
#
# CI 里每次构建都跑，所以 iOS 侧永远是安卓侧的最新版。
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
SRC="$HERE/../../android/app/assets/www"
DST="$HERE/../Resources/www"

if [ ! -f "$SRC/index.html" ]; then
  echo "找不到网页资源：$SRC" >&2
  exit 1
fi

rm -rf "$DST"
mkdir -p "$DST"
cp -R "$SRC/." "$DST/"

COUNT=$(find "$DST" -type f | wc -l | tr -d ' ')
SIZE=$(du -sh "$DST" | cut -f1 | tr -d ' ')
echo "已同步网页资源 → ios/Resources/www"
echo "  $COUNT 个文件，$SIZE"

# 关键文件在不在，缺了会白屏
for f in index.html app.js app.css data.js sound.js; do
  if [ ! -f "$DST/$f" ]; then
    echo "缺少 $f，构建会白屏" >&2
    exit 1
  fi
done
