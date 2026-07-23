#!/usr/bin/env python3
"""保存済み matches から match_player_stats を一括再導出する [idempotent upsert]。

用途:
  - 戦績機能導入前の過去 matches の backfill
  - stats.py の導出ロジック更新後の再計算 [stats_version ごと置換]

使い方:
  python3 server/recompute_stats.py            # server/data/anmika.db
  python3 server/recompute_stats.py --db PATH  # DB 指定
  python3 server/recompute_stats.py --dry-run  # 書き込まず件数だけ
"""
from __future__ import annotations

import argparse
import json
import sqlite3
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import stats  # noqa: E402


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--db", default=str(Path(__file__).resolve().parent / "data" / "anmika.db"))
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args()

    c = sqlite3.connect(args.db)
    c.row_factory = sqlite3.Row
    stats.ensure_tables(c)
    matches = c.execute(
        "SELECT match_id, room_id, members_json, paifu_json, chip_delta_json FROM matches ORDER BY match_id"
    ).fetchall()
    written = 0
    skipped_users = 0
    for m in matches:
        try:
            members = json.loads(m["members_json"] or "[]")
            paifu = json.loads(m["paifu_json"] or "[]")
            chip_delta = json.loads(m["chip_delta_json"] or "{}")
        except Exception as e:
            print(f"match {m['match_id']}: JSON parse failed: {e}", file=sys.stderr)
            continue
        seat_fb_rows = c.execute(
            "SELECT user_id, seat FROM room_members WHERE room_id=?", (m["room_id"],)
        ).fetchall()
        seat_fb = {r["user_id"]: r["seat"] for r in seat_fb_rows}
        # members_json に seat が無い旧 row は chip_delta の key 全員を対象に fallback を引く
        if not isinstance(members, list) or not members:
            members = [{"user_id": uid} for uid in chip_delta.keys()]
        seat_by_user = stats.seat_map_from_members(members, seat_fb)
        mapped = set(seat_by_user.keys())
        all_users = {u for u in chip_delta.keys()}
        skipped_users += len(all_users - mapped)
        rows = stats.build_stat_rows(paifu, seat_by_user, chip_delta)
        if args.dry_run:
            written += len(rows)
            continue
        for row in rows:
            stats.upsert_stat_row(c, m["match_id"], row)
        written += len(rows)
    if not args.dry_run:
        c.commit()
    print(
        f"matches={len(matches)} stat_rows={'(dry) ' if args.dry_run else ''}{written} "
        f"seat_unknown_users={skipped_users} stats_version={stats.STATS_VERSION}"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
