"""server/app.py の API テスト [FastAPI TestClient + 一時 DB]。

実行 [この repo の .venv には pytest が無いので、pytest のある python に .venv の site-packages を足す]:
  cd <repo> && PYTHONPATH=$PWD/.venv/lib/python3.12/site-packages \
    /home/m-catlab/secretary-v2-prod/.venv/bin/python -m pytest server/test_api.py -q

[2026-10-09 遊真] A3 内部記録 / A4 cleanup / B1 login next / B2 my_seat。
本番 DB に触らないよう、import 前に ANMIKA_DB_PATH を一時 dir に固定し、各 test は DB_PATH を
tmp_path に差し替える。外向き httpx [ws purge / authority 照会 / Discord] は全部 fake。
"""
from __future__ import annotations

import json
import os
import sqlite3
import sys
import tempfile
from pathlib import Path
from types import SimpleNamespace
from urllib.parse import parse_qs, urlsplit

import pytest

_REPO = Path(__file__).resolve().parent.parent
_IMPORT_DB_DIR = tempfile.mkdtemp(prefix="anmika-api-test-import-")
os.environ["ANMIKA_DB_PATH"] = str(Path(_IMPORT_DB_DIR) / "import.sqlite3")
os.environ["ANMIKA_SESSION_SECRET"] = "test-session-secret"
os.environ["ANMIKA_INTERNAL_SECRET"] = "test-internal-secret"
os.environ.pop("ANMIKA_REQUIRE_SECRET", None)
sys.path.insert(0, str(_REPO))

import server.app as appmod  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

SECRET = "test-internal-secret"
HDR = {"X-Anmika-Internal-Secret": SECRET}


@pytest.fixture()
def env(tmp_path, monkeypatch):
    """各 test 専用の空 DB + 外向き通信の fake"""
    monkeypatch.setattr(appmod, "DB_PATH", tmp_path / "t.sqlite3")
    monkeypatch.setattr(appmod, "INTERNAL_API_SECRET", SECRET)
    monkeypatch.setenv("ANMIKA_TEST_AUTH", "1")
    purged: list[str] = []

    async def fake_hub_purge(room_id):
        purged.append(("hub", room_id))

    async def fake_notify_purge(room_id):
        purged.append(("ws", room_id))

    monkeypatch.setattr(appmod, "_hub_purge_room", fake_hub_purge)
    monkeypatch.setattr(appmod, "_notify_ws_purge", fake_notify_purge)
    appmod.init_db()
    appmod.hub.start_payloads.clear()
    return SimpleNamespace(purged=purged, client=TestClient(appmod.app))


def add_user(uid, name=None):
    with appmod.db_conn() as c:
        c.execute("INSERT OR IGNORE INTO users(user_id, username) VALUES(?,?)", (uid, name or uid))
        c.commit()


def add_room(room_id, host, status="playing", members=(), rotation=0, age_hours=0):
    """members = [(user_id, seat)]。age_hours 前に作られた部屋にする"""
    add_user(host)
    for uid, _seat in members:
        add_user(uid)  # 書き込み tx を持つ接続を開く前に済ませる [別接続だと database is locked]
    with appmod.db_conn() as c:
        c.execute(
            "INSERT INTO rooms(room_id, instance_id, host_user_id, status, created_at, rotation_enabled)"
            " VALUES(?,?,?,?, datetime('now', ?), ?)",
            (room_id, f"inst-{room_id}", host, status, f"-{age_hours} hours", rotation),
        )
        for uid, seat in members:
            c.execute("INSERT INTO room_members(room_id, user_id, seat) VALUES(?,?,?)", (room_id, uid, seat))
        c.commit()


def room_exists(room_id):
    with appmod.db_conn() as c:
        r = c.execute("SELECT status FROM rooms WHERE room_id=?", (room_id,)).fetchone()
        return r["status"] if r else None


def login(client, uid):
    r = client.post("/auth/test/login", json={"user_id": uid, "username": uid})
    assert r.status_code == 200, r.text


def chip_row(uid):
    with appmod.db_conn() as c:
        r = c.execute("SELECT chip_total, games_played FROM users WHERE user_id=?", (uid,)).fetchone()
        return (r["chip_total"], r["games_played"]) if r else None


def matches_of(room_id):
    with appmod.db_conn() as c:
        return [dict(r) for r in c.execute("SELECT * FROM matches WHERE room_id=? ORDER BY match_no", (room_id,))]


EVENTS = [
    {"type": "qipai", "player": 0, "count": 13},
    {"type": "qipai", "player": 1, "count": 13},
    {"type": "qipai", "player": 2, "count": 13},
    {
        "type": "hule", "player": 0, "isRon": False, "loser": None, "defen": 2000, "qijia": 0,
        "delta": {"0": 3000, "1": -1500, "2": -1500},
        "defenAfter": {"0": 28000, "1": 23500, "2": 23500},
    },
]


def record_body(**over):
    body = {
        "room_id": "ROOM",
        "match_uuid": "srv:inst-ROOM:1",
        "rule_version": "r1",
        "finished": True,
        "ledger": {"u1": 5, "u2": -3, "CPU_1": -2},
        "rotationEnabled": False,
        "roomLedgerDelta": {"u1": 5, "u2": -3, "CPU_1": -2, "u9": 0},
        "activeMembers": [
            {"user_id": "u1", "seat": 0},
            {"user_id": "u2", "seat": 1},
            {"user_id": "CPU_1", "seat": 2},
        ],
        "events": EVENTS,
    }
    body.update(over)
    return body


def record(env, body=None, headers=HDR):
    return env.client.post("/api/internal/matches/record", json=body or record_body(), headers=headers)


@pytest.fixture()
def room(env):
    add_room("ROOM", "u1", "playing", [("u1", 0), ("u2", 1)])
    return "ROOM"


# ---------------- A3: POST /api/internal/matches/record ----------------


def test_record_happy_path(env, room):
    r = record(env)
    assert r.status_code == 200, r.text
    assert r.json() == {"ok": True, "duplicate": False, "match_no": 1}
    rows = matches_of("ROOM")
    assert len(rows) == 1
    m = rows[0]
    assert m["match_uuid"] == "srv:inst-ROOM:1"
    assert m["paifu_source"] == "authority"
    assert m["rule_version"] == "r1"
    assert json.loads(m["paifu_json"]) == EVENTS
    assert json.loads(m["chip_delta_json"]) == {"u1": 5, "u2": -3, "CPU_1": -2}
    assert json.loads(m["members_json"]) == [
        {"user_id": "u1", "seat": 0}, {"user_id": "u2", "seat": 1}, {"user_id": "CPU_1", "seat": 2},
    ]
    assert chip_row("u1") == (5, 1)
    assert chip_row("u2") == (-3, 1)
    assert chip_row("CPU_1") is None  # CPU は users に居ない [UPDATE が 0 行で済む]
    # 戦績 [SAVEPOINT ブロック] も finish_match と同じく書かれる
    with appmod.db_conn() as c:
        n = c.execute("SELECT COUNT(*) AS n FROM match_player_stats WHERE match_id=?", (m["match_id"],)).fetchone()["n"]
    assert n == 3


def test_record_second_match_gets_next_match_no(env, room):
    assert record(env).json()["match_no"] == 1
    r = record(env, record_body(match_uuid="srv:inst-ROOM:2"))
    assert r.json() == {"ok": True, "duplicate": False, "match_no": 2}
    assert chip_row("u1") == (10, 2)


def test_record_duplicate_uuid_is_idempotent_and_does_not_double_add_chips(env, room):
    assert record(env).json()["duplicate"] is False
    r = record(env)
    assert r.status_code == 200
    assert r.json() == {"ok": True, "duplicate": True, "match_no": 1}
    assert len(matches_of("ROOM")) == 1
    assert chip_row("u1") == (5, 1)
    assert chip_row("u2") == (-3, 1)


def test_record_rejects_bad_or_missing_secret(env, room):
    assert record(env, headers={"X-Anmika-Internal-Secret": "nope"}).status_code == 403
    assert record(env, headers={}).status_code == 403
    assert matches_of("ROOM") == []


def test_record_zero_sum_violation_is_400(env, room):
    r = record(env, record_body(ledger={"u1": 5, "u2": -3, "CPU_1": -1}))
    assert r.status_code == 400
    assert "sum" in r.text
    assert matches_of("ROOM") == []
    assert chip_row("u1") == (0, 0)


@pytest.mark.parametrize(
    "ledger",
    [
        {"u1": 1_000_000, "u2": -1_000_000, "CPU_1": 0},  # 範囲外
        {"u1": 1.5, "u2": -1.5, "CPU_1": 0},  # int でない
        {"u1": "5", "u2": -5, "CPU_1": 0},
        {"u1": True, "u2": -1, "CPU_1": 0},  # bool は int 扱いしない
        {},
        None,
    ],
)
def test_record_rejects_bad_ledger_values(env, room, ledger):
    assert record(env, record_body(ledger=ledger)).status_code == 400
    assert matches_of("ROOM") == []


def test_record_rotation_uses_room_ledger_delta(env):
    # 4 人回し: 抜け番 u4 にも dice 分の delta がある。ledger [3 人分] ではなく roomLedgerDelta が SSoT
    add_room("ROT", "u1", "playing", [("u1", 0), ("u2", 1), ("u3", 2), ("u4", 3)], rotation=1)
    body = record_body(
        room_id="ROT",
        match_uuid="srv:inst-ROT:1",
        rotationEnabled=True,
        ledger={"u1": 4, "u2": -2, "u3": -2},
        roomLedgerDelta={"u1": 4, "u2": -2, "u3": -3, "u4": 1},
        activeMembers=[{"user_id": "u1", "seat": 0}, {"user_id": "u2", "seat": 1}, {"user_id": "u3", "seat": 2}],
    )
    r = record(env, body)
    assert r.status_code == 200, r.text
    m = matches_of("ROT")[0]
    assert json.loads(m["chip_delta_json"]) == {"u1": 4, "u2": -2, "u3": -3, "u4": 1}
    # chip_total は 4 人全員、games_played は打った trio だけ
    assert chip_row("u4") == (1, 0)
    assert chip_row("u3") == (-3, 1)
    assert chip_row("u1") == (4, 1)


def test_record_rotation_delta_must_be_zero_sum(env):
    add_room("ROT", "u1", "playing", [("u1", 0), ("u2", 1), ("u3", 2), ("u4", 3)], rotation=1)
    body = record_body(
        room_id="ROT", match_uuid="srv:inst-ROT:1", rotationEnabled=True,
        ledger={"u1": 0, "u2": 0, "u3": 0},  # ledger が 0 和でも rotation は roomLedgerDelta を検証する
        roomLedgerDelta={"u1": 4, "u2": -2, "u3": -3, "u4": 0},
        activeMembers=[{"user_id": "u1", "seat": 0}, {"user_id": "u2", "seat": 1}, {"user_id": "u3", "seat": 2}],
    )
    assert record(env, body).status_code == 400
    assert matches_of("ROT") == []


def test_record_room_missing_open_and_unfinished(env):
    assert record(env, record_body(room_id="NOPE")).status_code == 404
    add_room("OPEN", "u1", "open", [("u1", 0)])
    assert record(env, record_body(room_id="OPEN", match_uuid="x")).status_code == 409
    add_room("PLAY", "u1", "playing", [("u1", 0), ("u2", 1)])
    assert record(env, record_body(room_id="PLAY", match_uuid="x", finished=False)).status_code == 400
    body = record_body(room_id="PLAY", match_uuid="x")
    del body["finished"]
    assert record(env, body).status_code == 400
    assert matches_of("PLAY") == []


@pytest.mark.parametrize(
    "over",
    [
        {"match_uuid": ""},
        {"match_uuid": None},
        {"events": []},
        {"events": "x"},
        {"activeMembers": []},
        {"activeMembers": [{"user_id": "ghost", "seat": 0}]},  # chip delta に居ない
    ],
)
def test_record_rejects_malformed_fields(env, room, over):
    assert record(env, record_body(**over)).status_code == 400
    assert matches_of("ROOM") == []


def test_record_archived_room_still_records(env):
    # 部屋が archive された後の再送でも、同じ uuid なら重複として返す
    add_room("ARC", "u1", "playing", [("u1", 0), ("u2", 1)])
    body = record_body(room_id="ARC", match_uuid="srv:inst-ARC:1")
    assert record(env, body).json()["duplicate"] is False
    with appmod.db_conn() as c:
        c.execute("UPDATE rooms SET status='archived' WHERE room_id='ARC'")
        c.commit()
    assert record(env, body).json() == {"ok": True, "duplicate": True, "match_no": 1}


# ---- A3: 旧 client 経路との二重保存ガード [srv: uuid への置き換え] ----


def fake_authority(monkeypatch, payload):
    class FakeResp:
        status_code = 200

        def json(self):
            return payload

    class FakeClient:
        def __init__(self, *a, **k):
            pass

        async def __aenter__(self):
            return self

        async def __aexit__(self, *a):
            return False

        async def post(self, url, **kw):
            assert url.endswith("/internal/match-result")
            return FakeResp()

    monkeypatch.setattr(appmod, "httpx", SimpleNamespace(AsyncClient=FakeClient))


def authority_payload(**over):
    p = {
        "ok": True, "finished": True,
        "ledger": {"u1": 5, "u2": -3, "CPU_1": -2},
        "matchId": 1, "roomInstanceId": "inst-ROOM", "rotationEnabled": False,
        "activeMembers": [{"user_id": "u1", "seat": 0}, {"user_id": "u2", "seat": 1}, {"user_id": "CPU_1", "seat": 2}],
        "roomLedgerDelta": {"u1": 5, "u2": -3, "CPU_1": -2},
        "events": EVENTS,
    }
    p.update(over)
    return p


def client_post_body(uuid="client-uuid-1"):
    return {
        "room_id": "ROOM", "paifu": [], "match_uuid": uuid,
        "chip_delta": {"u1": 5, "u2": -3, "CPU_1": -2},
    }


@pytest.fixture()
def host_client(env, room, monkeypatch):
    # finish_match は start_payloads の members を試合参加者の基準にする
    appmod.hub.start_payloads["ROOM"] = {
        "members": [{"user_id": "u1", "seat": 0}, {"user_id": "u2", "seat": 1}, {"user_id": "CPU_1", "seat": 2}]
    }
    login(env.client, "u1")
    return env.client


def test_client_post_after_server_record_hits_idempotency(env, host_client, monkeypatch):
    assert record(env).json()["duplicate"] is False
    fake_authority(monkeypatch, authority_payload())
    r = host_client.post("/api/matches", json=client_post_body())
    assert r.status_code == 409
    detail = r.json()["detail"]
    assert detail["reason"] == "idempotency_hit"
    assert detail["match_uuid"] == "srv:inst-ROOM:1"
    assert len(matches_of("ROOM")) == 1
    assert chip_row("u1") == (5, 1)  # 二重加算なし


def test_server_record_after_client_post_is_duplicate(env, host_client, monkeypatch):
    fake_authority(monkeypatch, authority_payload())
    r = host_client.post("/api/matches", json=client_post_body())
    assert r.status_code == 200, r.text
    assert matches_of("ROOM")[0]["match_uuid"] == "srv:inst-ROOM:1"
    r2 = record(env)
    assert r2.json() == {"ok": True, "duplicate": True, "match_no": 1}
    assert chip_row("u1") == (5, 1)


def test_client_post_keeps_client_uuid_without_authority_ids(env, host_client, monkeypatch):
    fake_authority(monkeypatch, authority_payload(matchId=None, roomInstanceId=None))
    r = host_client.post("/api/matches", json=client_post_body("keep-me"))
    assert r.status_code == 200, r.text
    assert matches_of("ROOM")[0]["match_uuid"] == "keep-me"


def test_client_post_without_uuid_is_still_400(env, host_client, monkeypatch):
    fake_authority(monkeypatch, authority_payload())
    body = client_post_body()
    body["match_uuid"] = ""
    assert host_client.post("/api/matches", json=body).status_code == 400
    assert matches_of("ROOM") == []


# ---------------- A4: cleanup は playing を消さない ----------------


def test_cleanup_never_deletes_playing_rooms(env):
    add_room("P3H", "host", "playing", [("host", 0), ("f1", 1)], age_hours=3)
    add_room("P30H", "host", "playing", [("host", 0), ("f1", 1)], age_hours=30)
    add_room("O25H", "host", "open", [("host", 0)], age_hours=25)
    add_room("O1H", "host", "open", [("host", 0)], age_hours=1)
    add_room("OTHER", "someone", "open", [("someone", 0)], age_hours=40)  # 他人の部屋
    login(env.client, "host")
    r = env.client.post("/api/rooms/cleanup")
    assert r.status_code == 200, r.text
    assert r.json() == {"ok": True, "deleted_count": 1, "deleted_open": 1, "deleted_playing": 0}
    assert room_exists("P3H") == "playing"
    assert room_exists("P30H") == "playing"
    assert room_exists("O25H") is None
    assert room_exists("O1H") == "open"
    assert room_exists("OTHER") == "open"
    assert env.purged == [("hub", "O25H"), ("ws", "O25H")]


def test_cleanup_requires_login(env):
    assert env.client.post("/api/rooms/cleanup").status_code == 401


# ---------------- B1: login の next ----------------


@pytest.mark.parametrize(
    "raw,expected",
    [
        ("/?room=ABCD", "/?room=ABCD"),
        ("/lobby", "/lobby"),
        ("/", "/"),
        ("//evil.com", None),
        ("//evil.com/x", None),
        ("https://x", None),
        ("http://x/y", None),
        ("javascript:alert(1)", None),
        ("evil.com", None),
        ("", None),
        (None, None),
        ("\\x", None),
        ("/\\evil.com", None),
        ("/a\nb", None),
        ("/a\tb", None),
        ("/a\x00b", None),
        ("/" + "a" * 199, "/" + "a" * 199),
        ("/" + "a" * 200, None),
    ],
)
def test_safe_next_path(raw, expected):
    assert appmod._safe_next_path(raw) == expected


def fake_discord(monkeypatch):
    class FakeResp:
        def __init__(self, status_code, data):
            self.status_code = status_code
            self._data = data
            self.text = ""

        def json(self):
            return self._data

    class FakeClient:
        def __init__(self, *a, **k):
            pass

        async def __aenter__(self):
            return self

        async def __aexit__(self, *a):
            return False

        async def post(self, url, **kw):
            return FakeResp(200, {"access_token": "tok"})

        async def get(self, url, **kw):
            return FakeResp(200, {"id": "77", "username": "friend", "avatar": None})

    monkeypatch.setattr(appmod, "httpx", SimpleNamespace(AsyncClient=FakeClient))
    monkeypatch.setattr(appmod, "DISCORD_CLIENT_ID", "cid")


def login_flow(client, next_value=None):
    """login → callback まで通し、callback の redirect 先 [Location] を返す"""
    params = {} if next_value is None else {"next": next_value}
    r = client.get("/auth/discord/login", params=params, follow_redirects=False)
    assert r.status_code in (302, 307), r.text
    state = parse_qs(urlsplit(r.headers["location"]).query)["state"][0]
    r2 = client.get("/auth/discord/callback", params={"code": "c", "state": state}, follow_redirects=False)
    assert r2.status_code in (302, 307), r2.text
    return r2.headers["location"]


def test_login_next_good_path_is_used_after_callback(env, monkeypatch):
    fake_discord(monkeypatch)
    assert login_flow(env.client, "/?room=ABCD") == "/?room=ABCD"
    with appmod.db_conn() as c:
        assert c.execute("SELECT username FROM users WHERE user_id='77'").fetchone()["username"] == "friend"


def test_login_without_next_goes_home(env, monkeypatch):
    fake_discord(monkeypatch)
    assert login_flow(env.client) == "/"


@pytest.mark.parametrize(
    "bad", ["//evil.com", "https://x", "\\x", "/\\evil.com", "javascript:alert(1)", "/a\tb", "/" + "a" * 200]
)
def test_login_next_unsafe_values_are_ignored(env, monkeypatch, bad):
    fake_discord(monkeypatch)
    assert login_flow(env.client, bad) == "/"


def test_login_next_does_not_linger_after_bad_retry(env, monkeypatch):
    fake_discord(monkeypatch)
    env.client.get("/auth/discord/login", params={"next": "/?room=OLD"}, follow_redirects=False)
    # 同じ session でやり直し、2 回目は不正な next → 前の next を引きずらない
    assert login_flow(env.client, "//evil.com") == "/"


def test_login_next_is_consumed_once(env, monkeypatch):
    fake_discord(monkeypatch)
    assert login_flow(env.client, "/?room=ABCD") == "/?room=ABCD"
    assert login_flow(env.client) == "/"


# ---------------- B2: list_rooms の my_seat ----------------


def test_list_rooms_my_seat(env):
    add_room("MINE", "host", "playing", [("host", 0), ("me", 2)])
    add_room("NOTME", "host", "open", [("host", 0)])
    add_room("SEAT0", "me", "open", [("me", 0)])
    add_user("me")
    login(env.client, "me")
    r = env.client.get("/api/rooms")
    assert r.status_code == 200, r.text
    by_id = {row["room_id"]: row for row in r.json()}
    assert by_id["MINE"]["my_seat"] == 2
    assert by_id["NOTME"]["my_seat"] is None
    assert by_id["SEAT0"]["my_seat"] == 0  # 席 0 を「非メンバー」と取り違えない
    assert by_id["MINE"]["member_count"] == 2  # 既存キーは変えない


def test_list_rooms_my_seat_single_select(env, monkeypatch):
    for i in range(5):
        add_room(f"R{i}", "host", "open", [("host", 0), ("me", 1)])
    add_user("me")
    login(env.client, "me")
    seen: list[str] = []
    real = appmod.db_conn

    def counting_conn():
        c = real()
        c.set_trace_callback(lambda sql: seen.append(sql))
        return c

    monkeypatch.setattr(appmod, "db_conn", counting_conn)
    r = env.client.get("/api/rooms")
    assert r.status_code == 200
    room_selects = [s for s in seen if "FROM rooms" in s]
    assert len(room_selects) == 1  # 部屋ごとの追加 query が無い [N+1 でない]


def test_list_rooms_requires_login(env):
    assert env.client.get("/api/rooms").status_code == 401


# ---------------- R3: 事故復帰 [rewind] の入口 ----------------


class _FakeRewindResponse:
    status_code = 200

    def json(self):
        return {"ok": True, "dropped": 3}


@pytest.fixture()
def rewind_env(env, monkeypatch):
    monkeypatch.setattr(appmod, "RECOVERY_PASSWORD", "s3cret-パス")
    monkeypatch.setattr(appmod, "REWIND_REQUIRE_MEMBER", True)
    appmod._REWIND_FAILS.clear()
    relayed: list[str] = []

    class FakeClient:
        def __init__(self, *a, **k):
            pass

        async def __aenter__(self):
            return self

        async def __aexit__(self, *a):
            return False

        async def post(self, url, **kw):
            relayed.append(url)
            return _FakeRewindResponse()

    monkeypatch.setattr(appmod.httpx, "AsyncClient", FakeClient)
    add_room("RWROOM", "u1", "playing", [("u1", 0), ("u2", 1)])
    add_user("outsider")
    return SimpleNamespace(client=env.client, relayed=relayed)


def _rewind(client, password, room_id="RWROOM"):
    return client.post(f"/api/rooms/{room_id}/rewind", json={"password": password})


def test_rewind_needs_login(rewind_env):
    assert _rewind(rewind_env.client, "s3cret-パス").status_code == 401
    assert rewind_env.relayed == []


def test_rewind_needs_a_seat_in_the_room(rewind_env):
    login(rewind_env.client, "outsider")
    r = _rewind(rewind_env.client, "s3cret-パス")
    assert r.status_code == 403 and r.json()["detail"] == "not a room member"
    assert rewind_env.relayed == []


def test_rewind_member_with_right_password_goes_through_even_with_non_ascii_password(rewind_env):
    login(rewind_env.client, "u2")  # host でなくても席があれば通る
    r = _rewind(rewind_env.client, "s3cret-パス")
    assert r.status_code == 200 and r.json() == {"ok": True, "dropped": 3}
    assert len(rewind_env.relayed) == 1


def test_rewind_wrong_password_is_403_and_non_ascii_wrong_password_is_not_a_500(rewind_env):
    login(rewind_env.client, "u1")
    assert _rewind(rewind_env.client, "nope").status_code == 403
    assert _rewind(rewind_env.client, "ぱすわーど").status_code == 403
    assert rewind_env.relayed == []


def test_rewind_locks_out_after_repeated_failures_even_for_the_right_password(rewind_env):
    login(rewind_env.client, "u1")
    for _ in range(appmod._REWIND_FAIL_LIMIT_PER_USER):
        assert _rewind(rewind_env.client, "bad").status_code == 403
    assert _rewind(rewind_env.client, "s3cret-パス").status_code == 429
    assert rewind_env.relayed == []
    # 別のユーザーの枠は別 [全体の上限に届くまで]
    login(rewind_env.client, "u2")
    assert _rewind(rewind_env.client, "s3cret-パス").status_code == 200


def test_rewind_member_check_can_be_switched_off(rewind_env, monkeypatch):
    monkeypatch.setattr(appmod, "REWIND_REQUIRE_MEMBER", False)
    assert _rewind(rewind_env.client, "s3cret-パス").status_code == 200  # 未ログインでも PW だけで通る [従来]
