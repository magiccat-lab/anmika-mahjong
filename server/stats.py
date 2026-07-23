"""戦績集計: matches.paifu_json [game.events] から per-user per-match の統計行を導出する。

呼び出しは 2 経路:
  - app.py finish_match [POST /api/matches] が INSERT 直後に同 transaction で導出
  - recompute_stats.py が保存済み matches を一括再導出 [ロジック更新時 / 過去分 backfill]

[2026-07-23 Sol総点検の罠対応]
  1. event 型を信用しない: 全て runtime で .get / isinstance 検査、未知 type は無視
  2. ダブロンは hule が winner ごとに連続複数件。局は qipai 境界でグループ化し、
     放銃局のカウントは局ごと最大 1 回 [同一打牌への複数ロン]。和了は各件カウント
  3. 点数は hule event の defen [winnerGain 焼き込み、2026-07-23 以降] を優先、
     旧牌譜は delta[winner] に fallback。祝儀は hule.chipTransfer.delta がある牌譜のみ
  4. events 長 >= PAIFU_TRUNCATE_LEN [client slice 上限] は incomplete=1 で保存
  5. seat→user は試合開始時 snapshot 固定 [回り親 qijia は風計算用で seat は回らない]
"""
from __future__ import annotations

from typing import Any

STATS_VERSION = 1
PAIFU_TRUNCATE_LEN = 5000
SEATS = (0, 1, 2)

# 明槓/加槓/大明槓は majiang-core 表記で方向マーカー [+-=] を含む。暗槓は含まない
_OPEN_MARKERS = ("+", "-", "=")


def _is_open_mianzi(mianzi: Any) -> bool:
    return isinstance(mianzi, str) and any(m in mianzi for m in _OPEN_MARKERS)


def _seat(v: Any) -> int | None:
    return v if isinstance(v, int) and v in SEATS else None


def _num(v: Any) -> int:
    try:
        if isinstance(v, bool):
            return 0
        return int(v)
    except Exception:
        return 0


def _delta_map(v: Any) -> dict[int, int]:
    out = {s: 0 for s in SEATS}
    if isinstance(v, dict):
        for s in SEATS:
            out[s] = _num(v.get(s, v.get(str(s), 0)))
    return out


def _new_seat_row() -> dict[str, Any]:
    return {
        "rounds": 0,
        "riichi": 0,
        "fever_riichi": 0,
        "furo_rounds": 0,
        "ankan": 0,
        "nuki": 0,
        "wins": 0,
        "tsumo_wins": 0,
        "ron_wins": 0,
        "deal_ins": 0,
        "points_won": 0,
        "points_dealt_in": 0,
        "hule_chips": 0,
        "placement": None,
        "final_defen": None,
    }


def derive_match_stats(paifu: Any) -> dict[str, Any]:
    """events list から seat 別統計を導出する。

    戻り値: {
      "seats": {0: row, 1: row, 2: row},
      "incomplete": bool,
      "qijia": int,
    }
    """
    rows: dict[int, dict[str, Any]] = {s: _new_seat_row() for s in SEATS}
    if not isinstance(paifu, list):
        return {"seats": rows, "incomplete": True, "qijia": 0}

    incomplete = len(paifu) >= PAIFU_TRUNCATE_LEN
    qijia = 0
    qijia_found = False
    last_defen_after: dict[int, int] | None = None

    rounds = 0
    prev_was_qipai = False
    # 局スコープの集合 [Sol罠2: 局単位カウントはここで dedupe]
    r_riichi: set[int] = set()
    r_fever: set[int] = set()
    r_furo: set[int] = set()
    r_deal_in_counted = False

    def close_round() -> None:
        nonlocal r_riichi, r_fever, r_furo, r_deal_in_counted
        for s in r_riichi:
            rows[s]["riichi"] += 1
        for s in r_fever:
            rows[s]["fever_riichi"] += 1
        for s in r_furo:
            rows[s]["furo_rounds"] += 1
        r_riichi = set()
        r_fever = set()
        r_furo = set()
        r_deal_in_counted = False

    for ev in paifu:
        if not isinstance(ev, dict):
            continue
        etype = ev.get("type")
        if etype == "qipai":
            if not prev_was_qipai:
                # 新しい局の開始 [qipai は 3 席分連続で来る]
                if rounds > 0:
                    close_round()
                rounds += 1
            prev_was_qipai = True
            continue
        prev_was_qipai = False

        if etype == "lizhi":
            s = _seat(ev.get("player"))
            if s is None:
                continue
            r_riichi.add(s)
            if ev.get("fever") is True:
                r_fever.add(s)
        elif etype == "fulou":
            s = _seat(ev.get("player"))
            if s is not None:
                r_furo.add(s)
        elif etype == "gang":
            s = _seat(ev.get("player"))
            if s is None:
                continue
            if _is_open_mianzi(ev.get("mianzi")):
                r_furo.add(s)
            else:
                rows[s]["ankan"] += 1
        elif etype == "nukiBei":
            # nukiBei event は action log 用で player が _draw 側にある形も許容
            s = _seat(ev.get("player"))
            if s is None and isinstance(ev.get("_draw"), dict):
                s = _seat(ev["_draw"].get("player"))
            if s is not None:
                rows[s]["nuki"] += 1
        elif etype == "hule":
            s = _seat(ev.get("player"))
            if s is None:
                continue
            if not qijia_found:
                q = _seat(ev.get("qijia"))
                if q is not None:
                    qijia = q
                    qijia_found = True
            delta = _delta_map(ev.get("delta"))
            rows[s]["wins"] += 1
            is_ron = ev.get("isRon") is True
            if is_ron:
                rows[s]["ron_wins"] += 1
            else:
                rows[s]["tsumo_wins"] += 1
            # 打点: defen [2026-07-23 以降焼き込み] 優先、旧牌譜は winner delta fallback
            defen = ev.get("defen")
            rows[s]["points_won"] += _num(defen) if defen is not None else max(delta[s], 0)
            # 放銃: loser field [2026-07-23 以降] 優先。旧牌譜はロン時の負 delta 席で推定
            if is_ron:
                loser = _seat(ev.get("loser"))
                if loser is None:
                    negs = [p for p in SEATS if delta[p] < 0]
                    loser = negs[0] if len(negs) == 1 else None
                if loser is not None:
                    rows[loser]["points_dealt_in"] += max(-delta[loser], 0)
                    if not r_deal_in_counted:
                        rows[loser]["deal_ins"] += 1
                        r_deal_in_counted = True
            # 祝儀確定値 [chipTransfer DTO 焼き込み牌譜のみ]
            ct = ev.get("chipTransfer")
            if isinstance(ct, dict):
                ct_delta = _delta_map(ct.get("delta"))
                for p in SEATS:
                    rows[p]["hule_chips"] += ct_delta[p]
            da = ev.get("defenAfter")
            if isinstance(da, dict):
                last_defen_after = _delta_map(da)

    if rounds > 0:
        close_round()
    for s in SEATS:
        rows[s]["rounds"] = rounds

    # 順位: 最終 defen 降順、同点は起家に近い順 [qijia からの席順]
    if last_defen_after is not None:
        for s in SEATS:
            rows[s]["final_defen"] = last_defen_after[s]
        order = sorted(SEATS, key=lambda s: (-last_defen_after[s], (s - qijia) % 3))
        for rank, s in enumerate(order, start=1):
            rows[s]["placement"] = rank

    return {"seats": rows, "incomplete": incomplete, "qijia": qijia}


def seat_map_from_members(members: Any, fallback: dict[str, int] | None = None) -> dict[str, int]:
    """members snapshot [{user_id, seat?}...] から user_id→seat を作る。

    seat 欠落 entry は fallback [room_members 等] で補完。どこにも無ければ載せない。
    """
    out: dict[str, int] = {}
    if isinstance(members, list):
        for m in members:
            if not isinstance(m, dict):
                continue
            uid = m.get("user_id")
            if not isinstance(uid, str) or not uid:
                continue
            seat = _seat(m.get("seat"))
            if seat is None and fallback:
                seat = _seat(fallback.get(uid))
            if seat is not None:
                out[uid] = seat
    return out


STAT_COLUMNS = (
    "seat", "stats_version", "incomplete", "rounds", "riichi", "fever_riichi",
    "furo_rounds", "ankan", "nuki", "wins", "tsumo_wins", "ron_wins", "deal_ins",
    "points_won", "points_dealt_in", "hule_chips", "placement", "final_defen", "chip_delta",
)

# DDL は app.py init_db と recompute_stats.py の両方から呼ぶ [SSoT はここ]
STATS_DDL = """
CREATE TABLE IF NOT EXISTS match_player_stats (
    match_id INTEGER NOT NULL,
    user_id TEXT NOT NULL,
    seat INTEGER NOT NULL,
    stats_version INTEGER NOT NULL,
    incomplete INTEGER NOT NULL DEFAULT 0,
    rounds INTEGER NOT NULL DEFAULT 0,
    riichi INTEGER NOT NULL DEFAULT 0,
    fever_riichi INTEGER NOT NULL DEFAULT 0,
    furo_rounds INTEGER NOT NULL DEFAULT 0,
    ankan INTEGER NOT NULL DEFAULT 0,
    nuki INTEGER NOT NULL DEFAULT 0,
    wins INTEGER NOT NULL DEFAULT 0,
    tsumo_wins INTEGER NOT NULL DEFAULT 0,
    ron_wins INTEGER NOT NULL DEFAULT 0,
    deal_ins INTEGER NOT NULL DEFAULT 0,
    points_won INTEGER NOT NULL DEFAULT 0,
    points_dealt_in INTEGER NOT NULL DEFAULT 0,
    hule_chips INTEGER NOT NULL DEFAULT 0,
    placement INTEGER,
    final_defen INTEGER,
    chip_delta INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (match_id, user_id),
    FOREIGN KEY(match_id) REFERENCES matches(match_id)
);
CREATE TABLE IF NOT EXISTS app_settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
"""


def ensure_tables(conn: Any) -> None:
    conn.executescript(STATS_DDL)


def upsert_stat_row(conn: Any, match_id: int, row: dict[str, Any]) -> None:
    """match_player_stats へ idempotent upsert [PK: match_id + user_id]。

    再計算 [recompute_stats.py] で stats_version ごと置き換える。
    """
    cols = ["match_id", "user_id", *STAT_COLUMNS]
    values = [match_id, row["user_id"], *[row.get(c) for c in STAT_COLUMNS]]
    placeholders = ",".join("?" for _ in cols)
    conn.execute(
        f"INSERT OR REPLACE INTO match_player_stats({','.join(cols)}) VALUES({placeholders})",
        values,
    )


def build_stat_rows(
    paifu: Any,
    seat_by_user: dict[str, int],
    chip_delta: dict[str, Any] | None = None,
) -> list[dict[str, Any]]:
    """user_id → seat mapping を掛けて DB 行 [dict] のリストにする。

    seat が未知の user は行を作らない [座席統計が捏造になるため]。
    """
    derived = derive_match_stats(paifu)
    out: list[dict[str, Any]] = []
    for user_id, seat in seat_by_user.items():
        if _seat(seat) is None:
            continue
        row = dict(derived["seats"][seat])
        row["user_id"] = user_id
        row["seat"] = seat
        row["stats_version"] = STATS_VERSION
        row["incomplete"] = 1 if derived["incomplete"] else 0
        row["chip_delta"] = _num((chip_delta or {}).get(user_id, 0))
        out.append(row)
    return out
