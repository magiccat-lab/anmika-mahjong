"""server/stats.py の導出テスト。

実行: /home/m-catlab/secretary-v2-prod/.venv/bin/pytest server/test_stats.py -q
[pure stdlib module なので fastapi 依存なし]

[2026-07-23 Sol総点検の罠] をそのままテストケース化:
  罠2 ダブロン = hule 連続複数件 → 和了は各件 / 放銃局は 1 回
  罠3 chip は chipTransfer 焼き込み牌譜のみ
  罠4 5000 events 到達 = incomplete
  罠5 seat→user は開始 snapshot 固定
"""
from stats import (
    PAIFU_TRUNCATE_LEN,
    STATS_VERSION,
    build_stat_rows,
    derive_match_stats,
    seat_map_from_members,
)


def qipai3():
    return [{"type": "qipai", "player": p, "count": 13} for p in (0, 1, 2)]


def sample_paifu():
    ev = []
    # 局1: p0 フィーバーリーチ→ツモ、p1 ポン
    ev += qipai3()
    ev += [
        {"type": "zimo", "player": 0, "pai": "p4"},
        {"type": "dapai", "player": 0, "pai": "p4"},
        {"type": "fulou", "player": 1, "from": 0, "mianzi": "p444-", "pai": "p4"},
        {"type": "lizhi", "player": 0, "open": False, "fever": True, "shuvari": False},
        {
            "type": "hule", "player": 0, "isRon": False, "loser": None, "defen": 2000,
            "qijia": 0, "changbang": 0, "jushu": 0, "benbang": 0,
            "delta": {"0": 3000, "1": -1500, "2": -1500},
            "defenBefore": {"0": 25000, "1": 25000, "2": 25000},
            "defenAfter": {"0": 28000, "1": 23500, "2": 23500},
            "chipTransfer": {"v": 1, "before": {"0": 0, "1": 0, "2": 0},
                             "after": {"0": 2, "1": -1, "2": -1},
                             "delta": {"0": 2, "1": -1, "2": -1}},
        },
    ]
    # 局2: p2 リーチ、p1 明槓 [furo]、p2 暗槓、p2 がダブロン放銃 [p1 → p0 の順で 2 件]
    ev += qipai3()
    ev += [
        {"type": "lizhi", "player": 2, "open": False, "fever": False, "shuvari": False},
        {"type": "gang", "player": 1, "mianzi": "m111+1"},
        {"type": "gang", "player": 2, "mianzi": "z1111"},
        {
            "type": "hule", "player": 1, "isRon": True, "loser": 2, "defen": 5800,
            "qijia": 0, "delta": {"0": 0, "1": 5800, "2": -5800},
            "defenBefore": {"0": 28000, "1": 23500, "2": 23500},
            "defenAfter": {"0": 28000, "1": 29300, "2": 17700},
        },
        {
            "type": "hule", "player": 0, "isRon": True, "loser": 2, "defen": 8000,
            "qijia": 0, "delta": {"0": 8000, "1": 0, "2": -8000},
            "defenBefore": {"0": 28000, "1": 29300, "2": 17700},
            "defenAfter": {"0": 36000, "1": 29300, "2": 9700},
        },
    ]
    return ev


def test_round_and_action_counters():
    d = derive_match_stats(sample_paifu())
    rows = d["seats"]
    assert not d["incomplete"]
    for s in (0, 1, 2):
        assert rows[s]["rounds"] == 2
    assert rows[0]["riichi"] == 1 and rows[0]["fever_riichi"] == 1
    assert rows[2]["riichi"] == 1 and rows[2]["fever_riichi"] == 0
    # p1: 局1 ポン + 局2 明槓 = furo 2 局。暗槓は furo に数えない
    assert rows[1]["furo_rounds"] == 2
    assert rows[2]["furo_rounds"] == 0
    assert rows[2]["ankan"] == 1


def test_double_ron_wins_each_deal_in_once():
    d = derive_match_stats(sample_paifu())
    rows = d["seats"]
    assert rows[0]["wins"] == 2 and rows[0]["tsumo_wins"] == 1 and rows[0]["ron_wins"] == 1
    assert rows[1]["wins"] == 1 and rows[1]["ron_wins"] == 1
    # 罠2: ダブロンの放銃局は 1 回、失点は両方積む
    assert rows[2]["deal_ins"] == 1
    assert rows[2]["points_dealt_in"] == 5800 + 8000
    # 打点は defen 優先
    assert rows[0]["points_won"] == 2000 + 8000
    assert rows[1]["points_won"] == 5800


def test_chip_transfer_only_from_dto_paifu():
    d = derive_match_stats(sample_paifu())
    rows = d["seats"]
    # 罠3: chipTransfer が付いてる hule [局1] のみ集計
    assert rows[0]["hule_chips"] == 2
    assert rows[1]["hule_chips"] == -1
    assert rows[2]["hule_chips"] == -1


def test_placement_from_final_defen():
    d = derive_match_stats(sample_paifu())
    rows = d["seats"]
    assert rows[0]["placement"] == 1 and rows[0]["final_defen"] == 36000
    assert rows[1]["placement"] == 2
    assert rows[2]["placement"] == 3


def test_placement_tiebreak_prefers_qijia_side():
    ev = qipai3() + [{
        "type": "hule", "player": 1, "isRon": False, "loser": None, "defen": 0,
        "qijia": 1, "delta": {"0": 0, "1": 0, "2": 0},
        "defenAfter": {"0": 25000, "1": 25000, "2": 25000},
    }]
    d = derive_match_stats(ev)
    rows = d["seats"]
    # 同点は起家 [qijia=1] に近い順: 1 → 2 → 0
    assert rows[1]["placement"] == 1
    assert rows[2]["placement"] == 2
    assert rows[0]["placement"] == 3


def test_old_paifu_fallbacks():
    # loser / defen の無い旧牌譜: ロンの放銃者は負 delta 席、打点は winner delta
    ev = qipai3() + [{
        "type": "hule", "player": 0, "isRon": True,
        "delta": {"0": 7700, "1": 0, "2": -7700},
        "defenAfter": {"0": 32700, "1": 25000, "2": 17300},
    }]
    d = derive_match_stats(ev)
    rows = d["seats"]
    assert rows[0]["points_won"] == 7700
    assert rows[2]["deal_ins"] == 1
    assert rows[2]["points_dealt_in"] == 7700


def test_truncated_paifu_marked_incomplete():
    ev = sample_paifu()
    pad = [{"type": "zimo", "player": 0, "pai": "p1"}] * (PAIFU_TRUNCATE_LEN - len(ev))
    d = derive_match_stats(ev + pad)
    assert d["incomplete"] is True


def test_garbage_events_ignored():
    ev = qipai3() + [
        None, 42, "x", {"type": "unknownThing", "player": 9},
        {"type": "hule"},  # player 欠落
        {"type": "lizhi", "player": 7},  # 席範囲外
    ]
    d = derive_match_stats(ev)
    assert d["seats"][0]["rounds"] == 1
    assert d["seats"][0]["wins"] == 0


def test_seat_map_and_stat_rows():
    members = [
        {"user_id": "u0", "seat": 0},
        {"user_id": "u1"},              # seat 欠落 → fallback
        {"user_id": "CPU_x", "seat": 2},
        {"user_id": "ghost"},           # どこにも無い → 除外
    ]
    m = seat_map_from_members(members, {"u1": 1})
    assert m == {"u0": 0, "u1": 1, "CPU_x": 2}
    rows = build_stat_rows(sample_paifu(), m, {"u0": 10, "u1": -4, "CPU_x": -6, "ghost": 0})
    by_uid = {r["user_id"]: r for r in rows}
    assert set(by_uid.keys()) == {"u0", "u1", "CPU_x"}
    assert by_uid["u0"]["chip_delta"] == 10
    assert by_uid["u0"]["stats_version"] == STATS_VERSION
    assert by_uid["u0"]["placement"] == 1
    assert by_uid["CPU_x"]["seat"] == 2


def test_savepoint_rolls_back_partial_stat_rows():
    """[2026-07-23 Sol指摘 P1] 途中席の例外で部分行が残らない [全席 or 0行] の故障注入。"""
    import sqlite3

    from stats import ensure_tables, upsert_stat_row, build_stat_rows

    c = sqlite3.connect(":memory:")
    c.row_factory = sqlite3.Row
    c.execute("CREATE TABLE matches (match_id INTEGER PRIMARY KEY)")
    c.execute("INSERT INTO matches(match_id) VALUES (1)")
    ensure_tables(c)
    rows = build_stat_rows(sample_paifu(), {"u0": 0, "u1": 1, "u2": 2}, {"u0": 0, "u1": 0, "u2": 0})
    assert len(rows) == 3
    try:
        c.execute("SAVEPOINT match_stats")
        try:
            for i, row in enumerate(rows):
                if i == 2:
                    raise RuntimeError("故障注入 [3席目で死ぬ]")
                upsert_stat_row(c, 1, row)
            c.execute("RELEASE SAVEPOINT match_stats")
        except Exception:
            c.execute("ROLLBACK TO SAVEPOINT match_stats")
            c.execute("RELEASE SAVEPOINT match_stats")
            raise
    except RuntimeError:
        pass
    c.commit()
    n = c.execute("SELECT COUNT(*) FROM match_player_stats").fetchone()[0]
    assert n == 0  # 部分 [2席分] が commit されない

    # 正常系: 全席書けたら 3 行
    c.execute("SAVEPOINT match_stats")
    for row in rows:
        upsert_stat_row(c, 1, row)
    c.execute("RELEASE SAVEPOINT match_stats")
    c.commit()
    assert c.execute("SELECT COUNT(*) FROM match_player_stats").fetchone()[0] == 3


def test_nagashi_hule_counts_as_tsumo_win():
    ev = qipai3() + [{
        "type": "hule", "player": 2, "isRon": False, "nagashi": True, "loser": None,
        "defen": 16000, "qijia": 0, "delta": {"0": -8000, "1": -8000, "2": 16000},
        "defenAfter": {"0": 17000, "1": 17000, "2": 41000},
    }]
    d = derive_match_stats(ev)
    rows = d["seats"]
    assert rows[2]["wins"] == 1 and rows[2]["tsumo_wins"] == 1
    assert rows[2]["points_won"] == 16000
    assert rows[0]["deal_ins"] == 0 and rows[1]["deal_ins"] == 0
