#!/usr/bin/env bash
# 別に build した dist (worktree の dist_next など) を本番の dist/ に入れ替える。
# worktree には git 管理外の public/sounds/bgm ・ voice が無く、そのまま
# rsync --delete すると本番から声と BGM が消える (11-17 isg. 通報
# 「なんか古いバージョンに戻ってない？」、11-16 の ccc8ded の入れ替えで 13 本消えた)。
# ここでは本番 tree の public/ にあって新しい dist に無い物を足し、
# それでも欠けがあれば入れ替えずに止める。
#   使い方: tools/swap_dist.sh <新しい dist の dir>
set -euo pipefail
src="${1:?usage: tools/swap_dist.sh <new dist dir>}"
src="${src%/}"
# 欠けの確かめは public に cd した中で回すので、相対パスだと public/<src> を見て全部欠けに見える
src="$(cd "$src" && pwd)"
repo="$(cd "$(dirname "$0")/.." && pwd)"
pub="$repo/public"
dist="$repo/dist"
[ -f "$src/index.html" ] || { echo "swap_dist: $src/index.html が無い" >&2; exit 2; }
[ -f "$src/version.json" ] || { echo "swap_dist: $src/version.json が無い (tools/write_version.mjs)" >&2; exit 2; }

# git 管理外の素材 (bgm ・ voice など) を本番 tree の public から足す
(cd "$pub" && find . -type f) | while IFS= read -r f; do
  if [ ! -e "$src/$f" ]; then
    mkdir -p "$src/$(dirname "$f")"
    cp -p "$pub/$f" "$src/$f"
    echo "swap_dist: 足した $f"
  fi
done

missing="$(cd "$pub" && find . -type f | while IFS= read -r f; do [ -e "$src/$f" ] || echo "$f"; done)"
if [ -n "$missing" ]; then
  echo "swap_dist: public にあって新しい dist に無い物があるので止める:" >&2
  echo "$missing" >&2
  exit 1
fi

rsync -a --delay-updates --delete "$src/" "$dist/"
echo "swap_dist: 入れ替えた $(cat "$dist/version.json")"
