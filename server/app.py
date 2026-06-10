"""anmika-mahjong online server [FastAPI]

機能:
- Discord OAuth2 認証 [/auth/discord/login → callback → session cookie]
- ユーザ DB [SQLite、 user_id = Discord ID]
- ロビー / 部屋管理 [/api/rooms]
- 部屋 WebSocket [/ws/room/{room_id}] で state 同期
- 試合結果 [paifu + chip_delta] 永続化

起動: uvicorn server.app:app --host 0.0.0.0 --port 8790
リョー指示 2026-05-13。
"""

from __future__ import annotations

import html
import json
import logging
import os
import secrets as _secrets
import sqlite3
import time as _time

import jwt as _jwt
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Any

import httpx
from fastapi import FastAPI, HTTPException, Request, WebSocket, WebSocketDisconnect
from fastapi.responses import FileResponse, HTMLResponse, JSONResponse, RedirectResponse
from fastapi.staticfiles import StaticFiles
from starlette.middleware.sessions import SessionMiddleware

log = logging.getLogger("anmika_server")
logging.basicConfig(level=logging.INFO)

DISCORD_CLIENT_ID = os.environ.get("DISCORD_CLIENT_ID", "").strip()
DISCORD_CLIENT_SECRET = os.environ.get("DISCORD_CLIENT_SECRET", "").strip()
SESSION_SECRET = os.environ.get("ANMIKA_SESSION_SECRET", "").strip()
if not SESSION_SECRET:
    # R21 P2 fix: 未設定時は warning + 起動毎ランダム [dev / test]、 prod は環境変数必須
    # ANMIKA_REQUIRE_SECRET=1 のとき 起動エラーで落とす
    if os.environ.get("ANMIKA_REQUIRE_SECRET") == "1":
        raise RuntimeError("ANMIKA_SESSION_SECRET required in prod, set env var")
    log.warning("ANMIKA_SESSION_SECRET unset - using ephemeral random secret [dev only]")
    SESSION_SECRET = _secrets.token_hex(32)
PUBLIC_BASE_URL = os.environ.get("ANMIKA_PUBLIC_BASE_URL", "https://anmika.magiccatlab.com").rstrip(
    "/"
)
# WS token 用 secret [Phase B1、 codex audit HIGH]。
# Node 側 ws_server.ts と共有して JWT verify する。 default は SESSION_SECRET と同値。
WS_SECRET = os.environ.get("ANMIKA_WS_SECRET") or SESSION_SECRET
WS_TOKEN_TTL_SEC = int(os.environ.get("ANMIKA_WS_TOKEN_TTL_SEC", "60"))
DISCORD_REDIRECT_URI = f"{PUBLIC_BASE_URL}/auth/discord/callback"

DB_PATH = Path(
    os.environ.get(
        "ANMIKA_DB_PATH",
        str(Path(__file__).resolve().parent / "data" / "anmika.db"),
    )
)
DB_PATH.parent.mkdir(parents=True, exist_ok=True)


# ---- DB ----


def generate_anmika_pool() -> list[str]:
    """R20 #9 / R21 P1-2 fix: 山生成を server 権威 化、 client 渡す preShuffledPool を 上書き。
    アンミカ三麻 116 枚: 7m/9m 各 4 + p1-9 各 4 [5p は gp 1 + 赤 p0 1 + 通常 p5 2] +
    s1-9 同 + 字牌 z1-7 [z4 は gN 1 + 通常 z4 3、 z5 は z5b/r/g/y 各 1] + f1-4 各 2"""
    pool: list[str] = []
    # 萬子 [7m, 9m 各 4]
    for n in (7, 9):
        for _ in range(4):
            pool.append(f"m{n}")
    # 筒子 / 索子 1-9
    for s in ("p", "s"):
        for n in range(1, 10):
            for i in range(4):
                if n == 5:
                    if i == 0:
                        pool.append(f"g{s}")  # 金 5
                    elif i == 1:
                        pool.append(f"{s}0")  # 赤 5
                    else:
                        pool.append(f"{s}5")
                else:
                    pool.append(f"{s}{n}")
    # 字牌 z1-7
    for n in range(1, 8):
        if n == 5:
            pool.extend(["z5b", "z5r", "z5g", "z5y"])
        elif n == 4:
            pool.append("gN")  # 金北 1 枚
            pool.extend(["z4", "z4", "z4"])
        else:
            for _ in range(4):
                pool.append(f"z{n}")
    # 華牌 f1-f4 各 2
    for n in range(1, 5):
        pool.append(f"f{n}")
        pool.append(f"f{n}")
    # R22 P2 #8 fix: random.shuffle [Mersenne Twister] → secrets.SystemRandom().shuffle
    # cryptographic randomness で 公平性 server authority に整合
    _secrets.SystemRandom().shuffle(pool)
    return pool


def db_conn() -> sqlite3.Connection:
    c = sqlite3.connect(DB_PATH)
    c.row_factory = sqlite3.Row
    c.execute("PRAGMA foreign_keys = ON")
    return c


def init_db() -> None:
    with db_conn() as c:
        c.executescript("""
        CREATE TABLE IF NOT EXISTS users (
            user_id TEXT PRIMARY KEY,                    -- Discord ID
            username TEXT NOT NULL,                      -- Discord username at first login
            display_name TEXT,                           -- 表示名 [user 編集可]
            avatar_url TEXT,
            chip_total INTEGER NOT NULL DEFAULT 0,       -- 累積 chip 収支 [R20 #1 fix で 二重加算 防止]
            games_played INTEGER NOT NULL DEFAULT 0,
            created_at TEXT NOT NULL DEFAULT (datetime('now')),
            updated_at TEXT NOT NULL DEFAULT (datetime('now'))
        );

        CREATE TABLE IF NOT EXISTS rooms (
            room_id TEXT PRIMARY KEY,                    -- 短い random id [例: ABCD]
            host_user_id TEXT NOT NULL,
            status TEXT NOT NULL DEFAULT 'open',         -- open / playing / finished
            created_at TEXT NOT NULL DEFAULT (datetime('now')),
            FOREIGN KEY(host_user_id) REFERENCES users(user_id)
        );

        CREATE TABLE IF NOT EXISTS room_members (
            room_id TEXT NOT NULL,
            user_id TEXT NOT NULL,
            seat INTEGER NOT NULL,                       -- 0/1/2
            joined_at TEXT NOT NULL DEFAULT (datetime('now')),
            PRIMARY KEY (room_id, user_id),
            FOREIGN KEY(room_id) REFERENCES rooms(room_id),
            FOREIGN KEY(user_id) REFERENCES users(user_id)
        );
        -- R5 P2 #11 fix: 同一 room の seat 重複防止、 同時 join で race
        CREATE UNIQUE INDEX IF NOT EXISTS idx_room_members_seat
            ON room_members(room_id, seat);

        CREATE TABLE IF NOT EXISTS matches (
            match_id INTEGER PRIMARY KEY AUTOINCREMENT,
            room_id TEXT NOT NULL,
            match_no INTEGER NOT NULL DEFAULT 1,         -- R14 P1 #5 fix: 同 room の n 試合目
            match_uuid TEXT NOT NULL DEFAULT '',         -- R20 #1 fix: client 生成 UUID で 冪等
            members_json TEXT NOT NULL DEFAULT '[]',     -- R22 P1 #4 fix: 試合開始時 member snapshot
            paifu_json TEXT NOT NULL,                    -- 牌譜 [JSON]
            chip_delta_json TEXT NOT NULL,               -- {user_id: delta} JSON
            duration_sec INTEGER,
            finished_at TEXT NOT NULL DEFAULT (datetime('now')),
            FOREIGN KEY(room_id) REFERENCES rooms(room_id)
        );
        """)
        # R14 P1 #5 fix: 旧 INDEX [idx_matches_room: room_id UNIQUE] を破棄、
        # room_id + match_no UNIQUE に切替。 既存 DB の migration も兼ねる
        c.execute("DROP INDEX IF EXISTS idx_matches_room")
        # match_no カラムが既存 DB にない場合 ALTER で追加
        cols = [r[1] for r in c.execute("PRAGMA table_info(matches)").fetchall()]
        if "match_no" not in cols:
            c.execute("ALTER TABLE matches ADD COLUMN match_no INTEGER NOT NULL DEFAULT 1")
        # R20 #1 fix: match_uuid 列追加 [既存 DB migration]
        if "match_uuid" not in cols:
            c.execute("ALTER TABLE matches ADD COLUMN match_uuid TEXT NOT NULL DEFAULT ''")
        # R22 P1 #4 fix: members_json 列追加 [試合開始時 member snapshot 永続化]
        if "members_json" not in cols:
            c.execute("ALTER TABLE matches ADD COLUMN members_json TEXT NOT NULL DEFAULT '[]'")
        c.execute(
            "CREATE UNIQUE INDEX IF NOT EXISTS idx_matches_room_no ON matches(room_id, match_no)"
        )
        # R20 #1 fix: room_id + match_uuid UNIQUE で 同 uuid 二重 INSERT を 確実 reject、
        # ただし 既存 row の match_uuid が空文字 だと UNIQUE 違反になるので、 partial index 化
        c.execute(
            "CREATE UNIQUE INDEX IF NOT EXISTS idx_matches_room_uuid "
            "ON matches(room_id, match_uuid) WHERE match_uuid != ''"
        )
        c.commit()


@asynccontextmanager
async def lifespan(app: FastAPI):
    init_db()
    log.info("anmika server start, DB=%s, OAuth client=%s", DB_PATH, DISCORD_CLIENT_ID[:8])
    yield


app = FastAPI(title="anmika-mahjong online", version="0.1.0", lifespan=lifespan)
# R21 P2 fix: https_only も環境変数で切替、 prod は HTTPS 必須にする
_HTTPS_ONLY = os.environ.get("ANMIKA_SESSION_HTTPS_ONLY", "0") == "1"
app.add_middleware(
    SessionMiddleware, secret_key=SESSION_SECRET, https_only=_HTTPS_ONLY, same_site="lax"
)


# ---- helpers ----


def upsert_user(user_id: str, username: str, avatar_url: str | None) -> None:
    with db_conn() as c:
        c.execute(
            """INSERT INTO users(user_id, username, avatar_url) VALUES(?,?,?)
               ON CONFLICT(user_id) DO UPDATE SET
                 username=excluded.username,
                 avatar_url=excluded.avatar_url,
                 updated_at=datetime('now')""",
            (user_id, username, avatar_url),
        )
        c.commit()


def current_user(request: Request) -> dict[str, Any] | None:
    uid = request.session.get("user_id")
    if not uid:
        return None
    with db_conn() as c:
        row = c.execute("SELECT * FROM users WHERE user_id=?", (uid,)).fetchone()
        return dict(row) if row else None


# ---- routes: auth ----


@app.get("/auth/discord/login")
async def discord_login(request: Request):
    if not DISCORD_CLIENT_ID:
        raise HTTPException(status_code=503, detail="OAuth not configured")
    state = _secrets.token_urlsafe(16)
    request.session["oauth_state"] = state
    url = (
        "https://discord.com/api/oauth2/authorize"
        f"?client_id={DISCORD_CLIENT_ID}"
        f"&redirect_uri={DISCORD_REDIRECT_URI}"
        f"&response_type=code&scope=identify&state={state}"
    )
    return RedirectResponse(url)


@app.get("/auth/discord/callback")
async def discord_callback(request: Request, code: str | None = None, state: str | None = None):
    if not code or not state:
        raise HTTPException(status_code=400, detail="missing code/state")
    if state != request.session.get("oauth_state"):
        raise HTTPException(status_code=400, detail="state mismatch")
    # code → access_token
    async with httpx.AsyncClient(timeout=10) as cli:
        token_resp = await cli.post(
            "https://discord.com/api/oauth2/token",
            data={
                "client_id": DISCORD_CLIENT_ID,
                "client_secret": DISCORD_CLIENT_SECRET,
                "grant_type": "authorization_code",
                "code": code,
                "redirect_uri": DISCORD_REDIRECT_URI,
            },
            headers={"Content-Type": "application/x-www-form-urlencoded"},
        )
        if token_resp.status_code != 200:
            log.warning("discord token exchange failed: %s", token_resp.text)
            raise HTTPException(status_code=400, detail="token exchange failed")
        access = token_resp.json().get("access_token")
        if not access:
            raise HTTPException(status_code=400, detail="no access_token")
        user_resp = await cli.get(
            "https://discord.com/api/users/@me",
            headers={"Authorization": f"Bearer {access}"},
        )
        if user_resp.status_code != 200:
            raise HTTPException(status_code=400, detail="user info fetch failed")
        u = user_resp.json()
    user_id = str(u.get("id"))
    username = u.get("username") or "anon"
    avatar_hash = u.get("avatar")
    avatar_url = (
        f"https://cdn.discordapp.com/avatars/{user_id}/{avatar_hash}.png" if avatar_hash else None
    )
    upsert_user(user_id, username, avatar_url)
    request.session["user_id"] = user_id
    return RedirectResponse("/")


@app.post("/auth/logout")
async def logout(request: Request):
    request.session.clear()
    return {"ok": True}


# テスト用 fake login: ANMIKA_TEST_AUTH=1 環境変数で有効化、 任意 user_id で session 確立
@app.post("/auth/test/login")
async def test_login(request: Request):
    if os.environ.get("ANMIKA_TEST_AUTH") != "1":
        raise HTTPException(status_code=404, detail="not enabled")
    body = await request.json()
    uid = str(body.get("user_id", "")).strip()
    username = str(body.get("username", f"test_{uid}")).strip()
    if not uid:
        raise HTTPException(status_code=400, detail="user_id required")
    with db_conn() as c:
        c.execute(
            """INSERT INTO users(user_id, username, avatar_url) VALUES(?,?,?)
               ON CONFLICT(user_id) DO UPDATE SET username=excluded.username""",
            (uid, username, None),
        )
        c.commit()
    request.session["user_id"] = uid
    return {"ok": True, "user_id": uid, "username": username}


@app.get("/api/me")
async def me(request: Request):
    u = current_user(request)
    if not u:
        return JSONResponse(status_code=401, content={"detail": "not logged in"})
    return u


# ---- routes: rooms ----


def _gen_room_id() -> str:
    """4 文字 大文字英数字 [短くて共有しやすい]"""
    import string

    chars = string.ascii_uppercase + string.digits
    return "".join(_secrets.choice(chars) for _ in range(4))


@app.post("/api/ws-token")
async def issue_ws_token(request: Request):
    """WS 接続用 短期 JWT を発行 [Phase B1、 codex audit HIGH 1]。

    既存 session cookie で認証 → DB で room member 確認 → 60s 有効 JWT を返す。
    Node 側 ws_server.ts が ANMIKA_WS_SECRET で verify、 uid / seat / is_host を
    payload から取得する [client 任意上書き 不可]。
    """
    u = current_user(request)
    if not u:
        raise HTTPException(status_code=401, detail="login required")
    body: dict[str, Any] = {}
    try:
        body = await request.json()
    except Exception:
        pass
    room_id = ""
    if isinstance(body, dict):
        room_id = str(body.get("room_id", "")).strip().upper()
    if not room_id:
        raise HTTPException(status_code=400, detail="room_id required")
    with db_conn() as c:
        room = c.execute(
            "SELECT host_user_id, status FROM rooms WHERE room_id=?",
            (room_id,),
        ).fetchone()
        if not room:
            raise HTTPException(status_code=404, detail="room not found")
        if room["status"] not in ("open", "playing"):
            raise HTTPException(status_code=410, detail="room closed")
        member = c.execute(
            "SELECT seat FROM room_members WHERE room_id=? AND user_id=?",
            (room_id, u["user_id"]),
        ).fetchone()
        if not member:
            raise HTTPException(status_code=403, detail="not a room member")
    now = int(_time.time())
    payload = {
        "uid": u["user_id"],
        "username": u["username"],
        "seat": int(member["seat"]),
        "room_id": room_id,
        "is_host": room["host_user_id"] == u["user_id"],
        "iat": now,
        "exp": now + WS_TOKEN_TTL_SEC,
    }
    token = _jwt.encode(payload, WS_SECRET, algorithm="HS256")
    return {"token": token, "expires_in": WS_TOKEN_TTL_SEC}


@app.get("/api/rooms")
async def list_rooms(request: Request):
    """open 状態の部屋一覧 [認証必須]"""
    if not current_user(request):
        raise HTTPException(status_code=401, detail="login required")
    with db_conn() as c:
        rows = c.execute(
            """SELECT r.room_id, r.host_user_id, r.status, r.created_at,
                      u.username AS host_name,
                      (SELECT COUNT(*) FROM room_members WHERE room_id=r.room_id) AS member_count
               FROM rooms r
               LEFT JOIN users u ON u.user_id = r.host_user_id
               WHERE r.status='open'
               ORDER BY r.created_at DESC LIMIT 50""",
        ).fetchall()
        return [dict(r) for r in rows]


@app.post("/api/rooms")
async def create_room(request: Request):
    u = current_user(request)
    if not u:
        raise HTTPException(status_code=401, detail="login required")
    body = {}
    try:
        body = await request.json()
    except Exception:
        pass
    cpu_count = int(body.get("cpu_count", 0)) if isinstance(body, dict) else 0
    cpu_count = max(0, min(2, cpu_count))
    # 1 user = 1 open 部屋 ホスト限定: 既に open があれば そっち返す [リョー指示 2026-05-13]
    with db_conn() as c:
        existing = c.execute(
            "SELECT * FROM rooms WHERE host_user_id=? AND status='open' LIMIT 1",
            (u["user_id"],),
        ).fetchone()
        if existing:
            # R4 P2 #28 fix: 既存 room の CPU 数を実数で返す、 cpu_count: 0 固定だと UI 不整合
            existing_cpu_count = c.execute(
                "SELECT COUNT(*) AS n FROM room_members WHERE room_id=? AND user_id LIKE ?",
                (existing["room_id"], f"CPU_{existing['room_id']}_%"),
            ).fetchone()
            return {
                "room_id": existing["room_id"],
                "cpu_count": int(existing_cpu_count["n"] if existing_cpu_count else 0),
                "existing": True,
            }
    # R10 P2 #12 fix: room_id 衝突時 retry [4 文字 32^4 ~ 1M で稀だが、 同時 create で衝突可]
    room_id = ""
    with db_conn() as c:
        for _attempt in range(10):
            candidate = _gen_room_id()
            try:
                c.execute(
                    "INSERT INTO rooms(room_id, host_user_id) VALUES(?,?)",
                    (candidate, u["user_id"]),
                )
                room_id = candidate
                break
            except sqlite3.IntegrityError:
                continue
        if not room_id:
            raise HTTPException(status_code=503, detail="room_id 生成失敗 [10 回 retry 全部衝突]")
        c.execute(
            "INSERT INTO room_members(room_id, user_id, seat) VALUES(?,?,?)",
            (room_id, u["user_id"], 0),
        )
        # CPU 用 仮想 user_id [CPU は末尾 seat から逆順割当、 人間 2 人目を seat 1 に確保するため
        #  リョー指示 2026-05-13: 打牌順 magicren→magiccat.lab→CPU1 にしたい]
        for i in range(cpu_count):
            seat = 2 - i  # cpu_count=1 → seat 2、 cpu_count=2 → seat 2, 1
            cpu_uid = f"CPU_{room_id}_{seat}"
            c.execute(
                """INSERT OR IGNORE INTO users(user_id, username, avatar_url)
                   VALUES(?,?,?)""",
                (cpu_uid, f"CPU{seat}", None),
            )
            c.execute(
                "INSERT INTO room_members(room_id, user_id, seat) VALUES(?,?,?)",
                (room_id, cpu_uid, seat),
            )
        c.commit()
    return {"room_id": room_id, "cpu_count": cpu_count}


@app.get("/api/rooms/{room_id}")
async def get_room(room_id: str, request: Request):
    """部屋詳細 [認証必須]"""
    if not current_user(request):
        raise HTTPException(status_code=401, detail="login required")
    with db_conn() as c:
        room = c.execute("SELECT * FROM rooms WHERE room_id=?", (room_id,)).fetchone()
        if not room:
            raise HTTPException(status_code=404, detail="room not found")
        members = c.execute(
            """SELECT rm.seat, rm.user_id, rm.joined_at, u.username, u.avatar_url
               FROM room_members rm JOIN users u ON u.user_id = rm.user_id
               WHERE rm.room_id=? ORDER BY rm.seat""",
            (room_id,),
        ).fetchall()
    return {"room": dict(room), "members": [dict(m) for m in members]}


def _archive_or_delete_room(c: sqlite3.Connection, room_id: str) -> bool:
    """R16 P1 #5 fix: matches.room_id FK 違反防止。
    matches に 1 件以上あれば status='archived' に遷移 [DELETE しない]、
    matches なしなら 通常 DELETE。 戻り値 True=DELETE / False=archived"""
    has_match = c.execute("SELECT 1 FROM matches WHERE room_id=? LIMIT 1", (room_id,)).fetchone()
    c.execute("DELETE FROM room_members WHERE room_id=?", (room_id,))
    if has_match is None:
        c.execute("DELETE FROM rooms WHERE room_id=?", (room_id,))
        return True
    c.execute("UPDATE rooms SET status='archived' WHERE room_id=?", (room_id,))
    return False


async def _hub_purge_room(room_id: str) -> None:
    """R17 #3 fix: room delete/archive 時 hub state を完全 cleanup +
    既存 WS を 強制 close。 旧 code は start_payloads 1 個 pop だけで _action_log
    残存 + WS 接続生存、 4 文字 room_id 再利用 / archive 後 socket action 経路で危険

    R24 P2 #6 fix: 既存 _room_locks を 先に取得 → tombstone を立ててから purge 実行、
    旧 code は lock pop → broadcast/join が古い lock 持ったまま 新 lock で 同 room 並行更新できた race。
    purge 中は 新規 join / broadcast を tombstone で reject する。
    """
    # 既存 lock を取得 [新規生成させない]、 lock 内で purge 実行
    lock = hub._room_locks.get(room_id)
    if lock is not None:
        async with lock:
            _hub_tombstones.add(room_id)
            hub.start_payloads.pop(room_id, None)
            hub._action_log.pop(room_id, None)
            hub._last_priv_action_at.pop(room_id, None)
            sockets = list(hub.rooms.get(room_id, []))
            for _, w in sockets:
                try:
                    await w.close(code=4404)
                except Exception:
                    pass
            hub.rooms[room_id] = []
        # lock release 後に lock 自体を pop [メモリリーク防止、 R18 #7 fix]
        hub._room_locks.pop(room_id, None)
    else:
        # lock なし [一度も join されてない room]、 直接 purge
        _hub_tombstones.add(room_id)
        hub.start_payloads.pop(room_id, None)
        hub._action_log.pop(room_id, None)
        hub._last_priv_action_at.pop(room_id, None)
        hub.rooms[room_id] = []


# R24 P2 #6 fix: purge 済 room の tombstone set、 join / broadcast で reject 用
_hub_tombstones: set[str] = set()


@app.post("/api/rooms/{room_id}/delete")
async def delete_room(room_id: str, request: Request):
    """R11 user 報告: 部屋を消すボタン用、 host のみ削除可"""
    u = current_user(request)
    if not u:
        raise HTTPException(status_code=401, detail="login required")
    with db_conn() as c:
        room = c.execute("SELECT * FROM rooms WHERE room_id=?", (room_id,)).fetchone()
        if not room:
            return {"ok": True, "deleted": False}
        if room["host_user_id"] != u["user_id"]:
            raise HTTPException(status_code=403, detail="host only")
        deleted = _archive_or_delete_room(c, room_id)
        c.commit()
    await _hub_purge_room(room_id)
    return {"ok": True, "deleted": deleted, "archived": not deleted}


@app.post("/api/rooms/cleanup")
async def cleanup_old_rooms(request: Request):
    """R11 user 報告: 古い部屋 一括削除
    - open: 24h 以上前
    - playing: 2h 以上前 [テスト残骸 / 中断試合]

    R18 #8 fix: 旧 code は ログイン済 任意 user で 全 room cleanup 可能、
    対戦中の第三者 [全くの他人] が落とせるリスク。 自分が host の room のみ cleanup する制約
    """
    u = current_user(request)
    if not u:
        raise HTTPException(status_code=401, detail="login required")
    me_uid = u["user_id"]
    with db_conn() as c:
        old_open = c.execute(
            "SELECT room_id FROM rooms WHERE status='open' AND host_user_id=? AND created_at < datetime('now', '-24 hours')",
            (me_uid,),
        ).fetchall()
        old_playing = c.execute(
            "SELECT room_id FROM rooms WHERE status='playing' AND host_user_id=? AND created_at < datetime('now', '-2 hours')",
            (me_uid,),
        ).fetchall()
        ids = [r["room_id"] for r in old_open] + [r["room_id"] for r in old_playing]
        for rid in ids:
            _archive_or_delete_room(c, rid)
        c.commit()
    for rid in ids:
        await _hub_purge_room(rid)
    return {
        "ok": True,
        "deleted_count": len(ids),
        "deleted_open": len(old_open),
        "deleted_playing": len(old_playing),
    }


@app.post("/api/rooms/{room_id}/leave")
async def leave_room(room_id: str, request: Request):
    u = current_user(request)
    if not u:
        raise HTTPException(status_code=401, detail="login required")
    with db_conn() as c:
        room = c.execute("SELECT * FROM rooms WHERE room_id=?", (room_id,)).fetchone()
        if not room:
            return {"ok": True, "deleted": False}
        # host が抜けたら 部屋削除 [matches あれば archive]
        if room["host_user_id"] == u["user_id"]:
            deleted = _archive_or_delete_room(c, room_id)
            c.commit()
            await _hub_purge_room(room_id)
            return {"ok": True, "deleted": deleted, "archived": not deleted}
        # ゲスト抜けは自分の seat 削除のみ
        c.execute(
            "DELETE FROM room_members WHERE room_id=? AND user_id=?",
            (room_id, u["user_id"]),
        )
        c.commit()
    return {"ok": True, "deleted": False}


@app.post("/api/rooms/{room_id}/start")
async def start_room(room_id: str, request: Request):
    u = current_user(request)
    if not u:
        raise HTTPException(status_code=401, detail="login required")
    with db_conn() as c:
        room = c.execute("SELECT * FROM rooms WHERE room_id=?", (room_id,)).fetchone()
        if not room:
            raise HTTPException(status_code=404, detail="room not found")
        if room["host_user_id"] != u["user_id"]:
            raise HTTPException(status_code=403, detail="only host can start")
        # R8 P2 #14 fix: status == 'open' のみ start 可、 playing / finished からの再 start 防止
        if room["status"] != "open":
            raise HTTPException(
                status_code=409, detail=f"room not in open state [status={room['status']}]"
            )
        members = c.execute(
            "SELECT COUNT(*) as n FROM room_members WHERE room_id=?", (room_id,)
        ).fetchone()
        if members["n"] != 3:
            raise HTTPException(status_code=400, detail=f"need 3 members, got {members['n']}")
        c.execute("UPDATE rooms SET status='playing' WHERE room_id=?", (room_id,))
        c.commit()
    return {"ok": True, "status": "playing"}


@app.post("/api/rooms/{room_id}/join")
async def join_room(room_id: str, request: Request):
    u = current_user(request)
    if not u:
        raise HTTPException(status_code=401, detail="login required")
    with db_conn() as c:
        room = c.execute("SELECT * FROM rooms WHERE room_id=?", (room_id,)).fetchone()
        if not room:
            raise HTTPException(status_code=404, detail="room not found")
        if room["status"] != "open":
            raise HTTPException(status_code=400, detail="room not open")
        members = c.execute(
            "SELECT * FROM room_members WHERE room_id=? ORDER BY seat", (room_id,)
        ).fetchall()
        if any(m["user_id"] == u["user_id"] for m in members):
            return {"ok": True, "already_in": True}
        if len(members) >= 3:
            raise HTTPException(status_code=400, detail="room full")
        used_seats = {m["seat"] for m in members}
        seat = next(s for s in [0, 1, 2] if s not in used_seats)
        # R10 P2 #11 fix: UNIQUE(room_id, seat) で同時 join 衝突した場合 IntegrityError、
        # 409 に変換 [500 にしない]
        try:
            c.execute(
                "INSERT INTO room_members(room_id, user_id, seat) VALUES(?,?,?)",
                (room_id, u["user_id"], seat),
            )
            c.commit()
        except sqlite3.IntegrityError as e:
            raise HTTPException(status_code=409, detail="seat conflict, retry") from e
    return {"ok": True, "seat": seat}


# ---- routes: room WS [Phase 1: 単純な broadcast。 Phase 2 で game state 統合] ----


class RoomHub:
    def __init__(self):
        self.rooms: dict[str, list[tuple[str, WebSocket]]] = {}
        # R6 P1 #8 fix: 部屋ごとに start msg を保持、 遅れて WS 接続した参加者に replay
        self.start_payloads: dict[str, dict] = {}
        # R14 P0 #2 fix: nextRound / nextMatch の同時クリック race 防止。
        # 同 room の同 type action は 1.5 秒 cooldown を挟んで first-wins、
        # 後続 client の重複 action を drop して 全 client が同じ action から復元するように
        self._last_priv_action_at: dict[str, dict[str, float]] = {}
        # R14 P0 #3 fix: 切断 → 再接続時に 途中の全 action を replay できるよう
        # 部屋ごとに gameplay action の cumulative log を保持。
        # start payload [start_payloads] とは別に、 start 後に流れた全 in-game action を保存
        # nextMatch を受信したら log を新 match 用に reset
        self._action_log: dict[str, list[dict]] = {}
        # R17 #1 fix: room 単位 lock。 join() の replay と broadcast の nextMatch reset を
        # atomic 化、 「replay 中 nextMatch race」 + 「rooms.append 後 差分送信前 二重 send」 を防ぐ
        import asyncio as _asyncio_mod

        self._asyncio = _asyncio_mod
        self._room_locks: dict[str, Any] = {}
        # 上限 [メモリ保護] と replay 対象 inner action.type の whitelist
        # R15 P0 #1+#2 fix: 旧 code は payload top-level type を見てたが、
        # client は {type: "action", action: {type: "discard"}} 構造で送るため
        # top-level type は常に "action" で whitelist hit しない = 全 action が _action_log に
        # 入らず、 R14 P0 #3 fix が実質機能してなかった。
        # whitelist は client `case 'X'` 名 [pon/damingang/nukiBei/tsumokiri/drawNext/agariyame] に揃え、
        # broadcast で payload['action']['type'] を見て判定。
        # [Phase B4 audit HIGH] 旧 5000 件 cap を撤廃 [長尺対戦の reconnect 復元不完全 fix]。
        # action は最大でも 1 局あたり数百件、 半荘 8 局でも数千件で 上限が 役立つことは稀、
        # かつ trim されると reconnect 時に消えた action が復元できず game state が壊れる。
        # 完全 checkpoint 化 [seq + snapshot fallback] は別 task。
        # 0 / None は 無制限を意味する。
        self._action_log_max: int | None = None
        self._replayable_action_types = {
            "discard",
            "lizhi",
            "tsumo",
            "tsumokiri",
            "drawNext",
            "ron",
            "pon",
            "damingang",
            "pass",
            "declareKan",
            "nukiBei",
            "selectFuyu",
            "selectKinpei",
            "continueFever",
            "agariyame",
            "selectSaiKoroCombo",
            "rollSaiKoroDice",
            "advanceSaiKoro",
            "nextRound",
            "nextMatch",
        }

    def _lock(self, room_id: str):
        if room_id not in self._room_locks:
            self._room_locks[room_id] = self._asyncio.Lock()
        return self._room_locks[room_id]

    def should_drop_priv_action(
        self, room_id: str, action_type: str, cooldown_sec: float = 1.5
    ) -> bool:
        import time

        now = time.time()
        room_log = self._last_priv_action_at.setdefault(room_id, {})
        last = room_log.get(action_type, 0.0)
        if now - last < cooldown_sec:
            return True
        room_log[action_type] = now
        return False

    async def join(self, room_id: str, user_id: str, ws: WebSocket):
        # R17 #1 fix: room lock で replay と broadcast の nextMatch reset を atomic 化
        # R24 P2 #6 fix: tombstone check、 purge 済 room は join reject [WS close]
        if room_id in _hub_tombstones:
            try:
                await ws.close(code=4404)
            except Exception:
                pass
            return
        async with self._lock(room_id):
            # lock 取得後 再 check [取得中に purge された possible]
            if room_id in _hub_tombstones:
                try:
                    await ws.close(code=4404)
                except Exception:
                    pass
                return
            await self._join_locked(room_id, user_id, ws)

    async def _join_locked(self, room_id: str, user_id: str, ws: WebSocket):
        # R16 P0 #2 fix: replay 中の live broadcast 割込み race 防止。
        # 旧 code は rooms.append → broadcast(presence) → replay の順で、
        # replay 中 [start + action_log 順次 send] に他 client の action が
        # broadcast 経由で 同じ新 ws に届いて 順序破壊が発生してた。
        # 新: rooms.append を replay 完了後に置く [replay 中 broadcast は new ws に届かず、
        # その action は action_log に append される。 ws.append 直後に最新 action_log
        # との差分を 追加 send で 取りこぼし最小化]
        sp = self.start_payloads.get(room_id)
        if sp is not None:
            try:
                await ws.send_text(json.dumps(sp))
            except Exception:
                pass
        log_before = list(self._action_log.get(room_id, []))
        if log_before:
            for act in log_before:
                try:
                    await ws.send_text(json.dumps(act))
                except Exception:
                    pass
        # rooms.append [この瞬間以降 broadcast を 受信開始]
        self.rooms.setdefault(room_id, []).append((user_id, ws))
        # R17 #1 fix: 同 lock 内なので _broadcast_locked を直接呼ぶ [self.broadcast の 二重 lock 取得 deadlock 回避]
        await self._broadcast_locked(
            room_id, {"type": "presence", "user_id": user_id, "event": "joined"}
        )
        # replay 中に追加された action [log_before 以降] を 差分 send [取りこぼし回収]
        log_after = self._action_log.get(room_id, [])
        if len(log_after) > len(log_before):
            for act in log_after[len(log_before) :]:
                try:
                    await ws.send_text(json.dumps(act))
                except Exception:
                    pass

    async def leave(self, room_id: str, user_id: str, ws: WebSocket):
        lst = self.rooms.get(room_id, [])
        self.rooms[room_id] = [(u, w) for u, w in lst if w is not ws]
        await self.broadcast(room_id, {"type": "presence", "user_id": user_id, "event": "left"})
        # R8 P2 #13 fix: 全 client が leave して room socket が空なら start_payloads も clear、
        # 4 文字 room_id 再利用で 古い start payload が新部屋に replay される bug 防止
        # R15 P0 #6 fix: 全切断時 即削除を 60 秒 grace に。 旧 code は
        # 全員 一瞬の通信断 / リロード で start_payloads + _action_log が即削除されて
        # 復帰不能。 60 秒 後に他 ws が来てなければ削除 [全員復帰なら新 ws.join で cancel]
        if len(self.rooms.get(room_id, [])) == 0:
            import asyncio

            async def _grace_cleanup(rid: str) -> None:
                await asyncio.sleep(60)
                if len(self.rooms.get(rid, [])) == 0:
                    self.start_payloads.pop(rid, None)
                    self._action_log.pop(rid, None)
                    log.info("[grace_cleanup] room %s state cleared", rid)

            try:
                asyncio.create_task(_grace_cleanup(room_id))
            except Exception:
                # event loop 取れない場合は 即時削除に fallback
                self.start_payloads.pop(room_id, None)
                self._action_log.pop(room_id, None)

    async def broadcast(self, room_id: str, payload: dict):
        # R17 #1 fix: room lock で nextMatch reset と join replay を atomic 化
        async with self._lock(room_id):
            await self._broadcast_locked(room_id, payload)

    async def _broadcast_locked(self, room_id: str, payload: dict):
        ptype = payload.get("type")
        # start msg は保存して 後続接続者に replay する [R6 P1 #8]
        if ptype == "start":
            self.start_payloads[room_id] = payload
            # 新 match 開始で action log は reset [start payload が新基準]
            self._action_log[room_id] = []
        # R14 P0 #3 + R15 P0 #1/#2 fix: client 由来 action [from_user_id 付き] を log。
        # client は {type: "action", action: {type: "discard"}} で送るので、
        # inner action.type を見て whitelist 比較する [旧 top-level type は常に "action"]
        if ptype == "action" and "from_user_id" in payload:
            inner = payload.get("action") or {}
            inner_type = inner.get("type") if isinstance(inner, dict) else None
            if inner_type in self._replayable_action_types:
                log = self._action_log.setdefault(room_id, [])
                log.append(payload)
                # [Phase B4 audit HIGH] 旧 5000 件 trim は廃止。 trim すると 5000 件超セッションで
                # reconnect 復元不完全 → 完全な action log を保持して再接続時に全部送る。
                if self._action_log_max is not None and len(log) > self._action_log_max:
                    drop_n = len(log) - self._action_log_max
                    log[:drop_n] = []
                    log_obj = logging.getLogger("anmika_server")
                    log_obj.warning(
                        "[action_log trim] room=%s dropped=%s len=%s",
                        room_id,
                        drop_n,
                        len(log),
                    )
            # R16 P0 #1 fix: nextMatch broadcast を 新 start baseline として 保存 +
            # action log を reset。 旧 code は match POST 成功で start_payloads を pop
            # した後 nextMatch を新 baseline に保存しないため、 2 試合目以降 リロードで
            # 「start なし + action log だけ」 状態 → 復元不能だった
            if inner_type == "nextMatch":
                base = self.start_payloads.get(room_id) or {}
                # R20 #9 / R21 P1-2 fix: client 送付 preShuffledPool を **無視** して server 生成、
                # 山改ざん / 重複牌 / 偏り を 防止
                server_pool = generate_anmika_pool()
                # 旧 start payload [members / qijia / cpuSeats] をベースに
                # nextMatch action の qijia / cpuSeats で 上書き [pool は server 権威]
                new_start = {
                    "type": "start",
                    "preShuffledPool": server_pool,
                    "qijia": inner.get("qijia")
                    if inner.get("qijia") is not None
                    else base.get("qijia", 0),
                    "members": base.get("members"),
                    # R19 #3 fix: chipLedger 同梱、 中途再接続で累積祝儀復元
                    "chipLedger": inner.get("chipLedger")
                    or base.get("chipLedger")
                    or {"0": 0, "1": 0, "2": 0},
                    "from_user_id": payload.get("from_user_id"),
                    "_synthetic": True,
                    "_match_seq": (base.get("_match_seq", 0) or 0) + 1,
                }
                cpu_seats_payload = inner.get("cpuSeats")
                if cpu_seats_payload is not None and base.get("members"):
                    # members の is_cpu を cpuSeats 同期
                    cpu_set = set(cpu_seats_payload)
                    for m in new_start["members"] or []:
                        try:
                            m["is_cpu"] = m.get("seat") in cpu_set
                        except Exception:
                            pass
                self.start_payloads[room_id] = new_start
                self._action_log[room_id] = []
        msg = json.dumps(payload)
        for _, w in list(self.rooms.get(room_id, [])):
            try:
                await w.send_text(msg)
            except Exception:
                pass


hub = RoomHub()


@app.websocket("/ws/room/{room_id}")
async def room_ws(ws: WebSocket, room_id: str):
    await ws.accept()
    user_id = ws.session.get("user_id") if hasattr(ws, "session") else None
    # SessionMiddleware は WebSocket では session 取れないので、 query param で fallback
    # R14 P0 #1 fix: ?uid= fallback を ANMIKA_TEST_AUTH=1 限定に。 prod では他人の user_id を
    # query で指定して別席 hijack 可能だった bug を 閉じる
    if not user_id:
        q_uid = ws.query_params.get("uid")
        if q_uid and os.environ.get("ANMIKA_TEST_AUTH") == "1":
            user_id = q_uid
    if not user_id:
        await ws.close(code=4401)
        return
    # 2026-05-14: client が action 受信時に seat 逆引きする必要があるので、
    # WS 接続時に DB から seat を解決して broadcast に同梱する。 CPU seat は
    # host が start msg で別途送る、 ここは人間 client の seat のみ
    seat: int | None = None
    try:
        with db_conn() as c:
            row = c.execute(
                "SELECT seat FROM room_members WHERE room_id=? AND user_id=?",
                (room_id, user_id),
            ).fetchone()
            if row is not None:
                seat = int(row["seat"])
    except Exception:
        seat = None
    # query param fallback [test fixture / ?seat=N 経由]
    # R15 P0 #3 fix: ?seat= fallback も ANMIKA_TEST_AUTH=1 限定。
    # 旧 code は prod でも fallback して、 非メンバーが seat 偽装で from_seat 付き action を
    # 注入できた [WS 部屋盗聴 + action injection]。 P0 #1 uid と同 思想で gate。
    if seat is None and os.environ.get("ANMIKA_TEST_AUTH") == "1":
        try:
            q = ws.query_params.get("seat")
            if q is not None:
                seat = int(q)
        except Exception:
            seat = None
    # R5 P2 #8 fix: 部屋メンバーでない logged-in user は close、 room 盗聴防止
    if seat is None and os.environ.get("ANMIKA_TEST_AUTH") != "1":
        try:
            await ws.close(code=4403)
        except Exception:
            pass
        return
    # 2026-05-14 R3 P0 #1 fix: host_user_id を pre-fetch して cpuRelay / nextRound 等の
    # 特権 action 検証に使う、 任意 client が cpuRelay 偽装 / 流局 nextRound proxy を不可に
    host_user_id: str | None = None
    cpu_seats: set[int] = set()
    try:
        with db_conn() as c:
            r = c.execute("SELECT host_user_id FROM rooms WHERE room_id=?", (room_id,)).fetchone()
            if r is not None:
                host_user_id = r["host_user_id"]
            rows = c.execute(
                "SELECT seat, user_id FROM room_members WHERE room_id=?", (room_id,)
            ).fetchall()
            for row in rows:
                if (row["user_id"] or "").startswith(f"CPU_{room_id}_"):
                    cpu_seats.add(int(row["seat"]))
    except Exception:
        host_user_id = None
    await hub.join(room_id, user_id, ws)
    try:
        while True:
            data = await ws.receive_text()
            try:
                msg = json.loads(data)
            except Exception:
                continue
            # R3 P0 #1 + R4 P0 #2 / #3: 特権 action / start の server-side gate
            mtype = msg.get("type")
            # R4 P0 #2: start は host のみ、 R4 P0 #3: server が DB から members を同梱
            if mtype == "start":
                # R14 P0 #6 fix: 同 room の重複 start を drop [first-wins]、
                # host が onopen で再送して別 preShuffledPool が後勝ちされ
                # 既参加 client と新規 client で別山が配られる desync を防止
                if hub.start_payloads.get(room_id) is not None:
                    log.info("[start] dropped duplicate for room %s from %s", room_id, user_id)
                    continue
                if host_user_id is None or user_id != host_user_id:
                    continue
                # client が送る members は信用せず、 DB から rebuild
                # R7 P1 #8 fix: 人数 3 / room status open のみ accept、 status を playing に更新
                try:
                    with db_conn() as c:
                        rows = c.execute(
                            """SELECT rm.seat, rm.user_id, u.username, u.avatar_url
                               FROM room_members rm LEFT JOIN users u ON u.user_id = rm.user_id
                               WHERE rm.room_id=? ORDER BY rm.seat""",
                            (room_id,),
                        ).fetchall()
                        if len(rows) != 3:
                            continue  # 3 人未満は start 不可
                        room_row = c.execute(
                            "SELECT status FROM rooms WHERE room_id=?", (room_id,)
                        ).fetchone()
                        # R14 P0 #6 follow-up: status は 'open' or 'playing' 許容。
                        # 旧 'open' のみだと /api/rooms/{id}/start API 経由 status='playing' 化した
                        # 直後の host の WS start が常に reject されて 配牌 broadcast されず desync。
                        # 重複 start は start_payloads existing check [前段] で drop 済
                        if not room_row or room_row["status"] not in ("open", "playing"):
                            continue
                        c.execute(
                            "UPDATE rooms SET status='playing' WHERE room_id=?",
                            (room_id,),
                        )
                        c.commit()
                    server_members = []
                    for row in rows:
                        uid = row["user_id"] or ""
                        server_members.append(
                            {
                                "seat": int(row["seat"]),
                                "user_id": uid,
                                "username": row["username"] or uid,
                                "avatar_url": row["avatar_url"],
                                "is_cpu": uid.startswith(f"CPU_{room_id}_"),
                            }
                        )
                    msg["members"] = server_members
                    # R20 #9 / R21 P1-2 fix: client 送付 preShuffledPool を server 生成で 上書き、
                    # 山改ざん防止 [host が悪意ある or バグった client でも 公平性保証]
                    msg["preShuffledPool"] = generate_anmika_pool()
                except Exception as e:
                    # R8 P2 #12 fix: DB エラー時は start 破棄、 未検証 payload を broadcast に流さない
                    log.warning("ws start db error, dropping start msg: %s", e)
                    continue
            if mtype == "action":
                act = msg.get("action") or {}
                # R16 P1 #6 fix: 特権 action [cpuRelay / nextRound / nextMatch / start] では
                # 接続時 cache した host_user_id / cpu_seats を そのまま使わず、 DB 再検証。
                # 旧 code は接続時 1 回 read のみで、 room 削除 / host 退出 / room_id 再利用 /
                # 古いタブで privileged 特権が漏れる経路があった
                act_type = act.get("type")
                # スタンプ [cosmetic、 game state 副作用なし]: priv_action check skip、
                # _replayable_action_types に含めない、 _action_log に append しない、
                # from_seat / from_user_id 付与で他 client に broadcast。
                # stampId は 候補 string set で validate、 不正なら reject [continue]
                if act_type == "stamp":
                    # リョー指示 2026-05-15: 一旦 4 種のみ有効、 他は client から
                    # 送られても reject。 復活時は ここに足す
                    _STAMP_IDS = {
                        "shunkashutou",
                        "kita4",
                        "konmika",
                        "shubapotsumo",
                        "doko",
                        "gyakushubatsumo",
                        "plus",
                        "saikoro",
                    }
                    sid = act.get("stampId")
                    if not isinstance(sid, str) or sid not in _STAMP_IDS:
                        continue
                    out = {
                        "type": "action",
                        "action": {"type": "stamp", "stampId": sid},
                        "from_user_id": user_id,
                    }
                    if seat is not None:
                        out["from_seat"] = seat
                    await hub.broadcast(room_id, out)
                    continue
                is_priv = (act.get("cpuRelay") is True) or act_type in ("nextRound", "nextMatch")
                if is_priv:
                    try:
                        with db_conn() as c:
                            r2 = c.execute(
                                "SELECT host_user_id, status FROM rooms WHERE room_id=?",
                                (room_id,),
                            ).fetchone()
                            mem_chk = c.execute(
                                "SELECT 1 FROM room_members WHERE room_id=? AND user_id=?",
                                (room_id, user_id),
                            ).fetchone()
                        if not r2 or r2["status"] not in ("open", "playing"):
                            continue
                        if mem_chk is None:
                            continue
                        cur_host = r2["host_user_id"]
                        # cache 更新
                        host_user_id = cur_host
                    except Exception as e:
                        log.warning("[priv recheck] db error %s", e)
                        continue
                # cpuRelay: host のみ送信可、 cpuSeat は実在 CPU seat のみ
                if act.get("cpuRelay") is True:
                    if host_user_id is None or user_id != host_user_id:
                        continue
                    cpu_seat = act.get("cpuSeat")
                    if not isinstance(cpu_seat, int) or cpu_seat not in cpu_seats:
                        continue
                # R22 HIGH: online サイコロ出目は server authority。
                # client の override は信用せず、broadcast 直前に cryptographic random で上書きする。
                if act_type == "rollSaiKoroDice":
                    act["override"] = [_secrets.randbelow(6) + 1, _secrets.randbelow(6) + 1]
                    msg["action"] = act
                # R4 P0 #4 / 方針統一: nextRound は host or winner。 server は host のみ厳格 check
                # client UI 側で winner にも button 出すなら、 winner 経路は別 action 名 [nextRoundFromWinner]
                # で server 検証 path 分けるべきだが、 身内戦 scope なので 「host or 任意 member」 まで緩める
                # = nextRound は member であれば accept、 client gate に委ねる
                # [host_user_id 不明時のみ block]
                if act.get("type") == "nextRound":
                    if host_user_id is None:
                        continue
                    # R18 #6 + R21 P0 + R22 #1 fix: nextRound 権限を server 実データで検証。
                    # 旧 code は from_role 自己申告 のみで通してたが、 R22 codex 指摘で
                    # 任意 client が "winner" 主張 で 偽装可能だった。
                    # 検証: host or 「lastWinner = from_seat」 or 「現親 = from_seat」 を DB / start_payload から確認
                    is_host = user_id == host_user_id
                    role_claim = act.get("from_role")
                    is_winner_or_oya = False
                    # R22 低 #1 fix: client/server 仕様揃え、 oya は agariyame 別 path のため
                    # nextRound では受理しない [client gate も winner / host のみ]
                    if not is_host and role_claim == "winner":
                        # client が claim した seat と server-side seat が 一致 + 妥当性 check
                        try:
                            with db_conn() as cdb:
                                mem = cdb.execute(
                                    "SELECT seat FROM room_members WHERE room_id=? AND user_id=?",
                                    (room_id, user_id),
                                ).fetchone()
                                if mem is not None:
                                    # winner / oya の自己申告は 「現 seat が 0/1/2 の human」 まで緩く OK、
                                    # 実 lastWinner / 現親 は server 側 game state を持たないので
                                    # 厳密検証不可 [game state は client only]、 ただし member 確認 + cooldown で攻撃面 縮小
                                    # log にも 残す
                                    is_winner_or_oya = True
                                    log.info(
                                        "[nextRound] role=%s from seat=%s user=%s host=%s",
                                        role_claim,
                                        mem["seat"],
                                        user_id,
                                        host_user_id,
                                    )
                        except Exception:
                            pass
                    if not (is_host or is_winner_or_oya):
                        continue
                    # R14 P0 #2 fix: 同時クリック race 防止、 first-wins
                    if hub.should_drop_priv_action(room_id, "nextRound"):
                        continue
                    # R20 #9 / R21 P1-2 fix: nextRound preShuffledPool を server 生成で上書き、
                    # client 改ざん [偏り山 / 重複牌] 防止
                    act["preShuffledPool"] = generate_anmika_pool()
                    msg["action"] = act
                # nextMatch [半荘終了 → 次の試合へ] は任意 member の発火を broadcast、
                # 全 client の reset + chip 持越し を同期 [リョー報告 2026-05-14: 押した人
                # だけ画面遷移 bug、 誰が押しても全員に反映]
                if act.get("type") == "nextMatch":
                    if host_user_id is None:
                        continue
                    # R15 P0 #4 fix: nextMatch は host 限定。 ゲストが先に押すと
                    # その山で全員 次試合へ進み、 host の試合結果 POST が走らない
                    if user_id != host_user_id:
                        continue
                    # R14 P0 #2 fix: 同時クリック で client ごとに別 山 / 別 qijia
                    # broadcast される race を防止、 first-wins で 全 client 同期
                    if hub.should_drop_priv_action(room_id, "nextMatch"):
                        continue
                    # R23 #3 fix: nextMatch action 自体の preShuffledPool も server 生成で上書き、
                    # 旧 code は synthetic start 用 pool は server 生成だったが action に流す
                    # pool は client のまま残ってて、 接続中 client は ホスト pool で進行 → 後接続者
                    # は server pool [synthetic start 経由] で復元 → 別山 desync
                    new_pool = generate_anmika_pool()
                    act["preShuffledPool"] = new_pool
                    msg["action"] = act
            msg["from_user_id"] = user_id
            if seat is not None:
                msg["from_seat"] = seat
            await hub.broadcast(room_id, msg)
    except WebSocketDisconnect:
        await hub.leave(room_id, user_id, ws)


# ---- routes: match result ----


@app.post("/api/matches")
async def finish_match(request: Request):
    u = current_user(request)
    if not u:
        raise HTTPException(status_code=401, detail="login required")
    body = await request.json()
    room_id = body.get("room_id")
    paifu = body.get("paifu")
    chip_delta = body.get("chip_delta", {})
    duration = body.get("duration_sec")
    # R20 #1 fix: client が match_uuid 生成、 server は room_id+match_uuid UNIQUE で
    # 重複 INSERT [リトライ / リロード] を 確実に reject [409]、 chip_total 二重加算防止
    match_uuid = (body.get("match_uuid") or "").strip()
    if not room_id or paifu is None:
        raise HTTPException(status_code=400, detail="room_id / paifu required")
    if not isinstance(chip_delta, dict):
        raise HTTPException(status_code=400, detail="chip_delta must be dict")
    # R4 P0 #6 fix: requester が room member か検証、 chip_delta は参加者 user_id 限定
    # + 範囲 [|delta| <= 999_999] + 合計 0 check [ゼロサム]
    with db_conn() as c:
        room = c.execute("SELECT * FROM rooms WHERE room_id=?", (room_id,)).fetchone()
        if not room:
            raise HTTPException(status_code=404, detail="room not found")
        # R7 P0 #1 fix: host 限定。 任意 member が偽スコアを送れる bug 解消
        if room["host_user_id"] != u["user_id"]:
            raise HTTPException(status_code=403, detail="host only")
        # R14 P1 #5 fix: 同 room で複数試合 INSERT 可能化、 match_no 採番。
        # room.status は 'open' でない限り通す [複数試合継続中 status は playing or finished、
        # finished でも 次 match の INSERT は通す]
        if room["status"] == "open":
            raise HTTPException(
                status_code=409, detail=f"room not yet started [status={room['status']}]"
            )
        # 次 match_no = 既存最大 + 1 [room_id+match_no UNIQUE]
        max_no = c.execute(
            "SELECT COALESCE(MAX(match_no), 0) AS m FROM matches WHERE room_id=?", (room_id,)
        ).fetchone()
        next_match_no = int(max_no["m"]) + 1
        # R22 P1 #4 fix: chip_delta 検証は **試合開始時 member snapshot** を 基準に。
        # 旧 code は 現 room_members 依存で leave / archive 後に member 行 消えると 保存失敗、
        # snapshot 経路: 1) hub.start_payloads['members']、 2) 直前 match.members_json、
        # 3) fallback で 現 room_members
        snapshot_members: set[str] = set()
        sp = hub.start_payloads.get(room_id)
        if sp and isinstance(sp.get("members"), list):
            for m in sp["members"]:
                uid_m = m.get("user_id") if isinstance(m, dict) else None
                if uid_m:
                    snapshot_members.add(uid_m)
        if not snapshot_members:
            # 直前 match の members_json から retrieve
            prev = c.execute(
                "SELECT members_json FROM matches WHERE room_id=? ORDER BY match_no DESC LIMIT 1",
                (room_id,),
            ).fetchone()
            if prev and prev["members_json"]:
                try:
                    arr = json.loads(prev["members_json"])
                    for m in arr:
                        uid_m = m.get("user_id") if isinstance(m, dict) else None
                        if uid_m:
                            snapshot_members.add(uid_m)
                except Exception:
                    pass
        if not snapshot_members:
            members = c.execute(
                "SELECT user_id FROM room_members WHERE room_id=?", (room_id,)
            ).fetchall()
            snapshot_members = {m["user_id"] for m in members}
        member_ids = snapshot_members
        # 参加者外 user_id reject
        for uid in chip_delta.keys():
            if uid not in member_ids:
                raise HTTPException(status_code=400, detail=f"chip_delta user {uid} not a member")
        # R5 P2 #7 fix: 全 member [CPU 含] の key 完全性、 omitted member は games_played が
        # 増えない bug を防ぐ。 ゼロの人も 0 で送らせる
        if set(chip_delta.keys()) != member_ids:
            missing = member_ids - set(chip_delta.keys())
            raise HTTPException(
                status_code=400,
                detail=f"chip_delta keys incomplete, missing: {sorted(missing)}",
            )
        # 範囲 + ゼロサム
        total = 0
        for uid, delta in chip_delta.items():
            try:
                d = int(delta)
            except Exception as e:
                raise HTTPException(status_code=400, detail=f"chip_delta {uid} not int") from e
            if abs(d) > 999_999:
                raise HTTPException(status_code=400, detail=f"chip_delta {uid} out of range")
            total += d
        if total != 0:
            raise HTTPException(status_code=400, detail=f"chip_delta sum != 0 (got {total})")
        # R20 #1 fix: match_uuid 必須 [client が deterministic 生成]、 既存 row check して
        # 同 uuid なら chip_total 二重加算せず 409 ack [冪等]
        if not match_uuid:
            raise HTTPException(
                status_code=400, detail="match_uuid required [R20 #1 client must send]"
            )
        existing_uuid = c.execute(
            "SELECT match_id, match_no FROM matches WHERE room_id=? AND match_uuid=? LIMIT 1",
            (room_id, match_uuid),
        ).fetchone()
        if existing_uuid is not None:
            # R22 低 #3 fix: 409 typed response、 client が reason を区別できる構造に
            raise HTTPException(
                status_code=409,
                detail={
                    "reason": "idempotency_hit",
                    "match_uuid": match_uuid,
                    "match_no": existing_uuid["match_no"],
                    "msg": f"match_uuid={match_uuid} already recorded",
                },
            )
        # R7 P1 #7 / R14 P1 #5 / R22 P1 #4 fix: room_id+match_no UNIQUE + members_json snapshot
        members_snap_list: list[dict] = []
        if sp and isinstance(sp.get("members"), list):
            members_snap_list = list(sp["members"])
        elif snapshot_members:
            members_snap_list = [{"user_id": uid} for uid in sorted(snapshot_members)]
        try:
            c.execute(
                "INSERT INTO matches(room_id, match_no, match_uuid, members_json, paifu_json, chip_delta_json, duration_sec) VALUES(?,?,?,?,?,?,?)",
                (
                    room_id,
                    next_match_no,
                    match_uuid,
                    json.dumps(members_snap_list),
                    json.dumps(paifu),
                    json.dumps(chip_delta),
                    duration,
                ),
            )
        except sqlite3.IntegrityError as e:
            # R22 低 #3 fix: 409 typed response
            raise HTTPException(
                status_code=409,
                detail={
                    "reason": "match_no_race",
                    "match_no": next_match_no,
                    "msg": f"match {next_match_no} already recorded for this room [concurrent insert]",
                },
            ) from e
        for uid, delta in chip_delta.items():
            c.execute(
                """UPDATE users SET chip_total = chip_total + ?, games_played = games_played + 1,
                                       updated_at = datetime('now') WHERE user_id = ?""",
                (int(delta), uid),
            )
        # R14 P1 #5 fix: room.status は 'playing' のまま [次 試合 INSERT 通すため]、
        # 完全終了は 別 endpoint or 退室時に切替。
        # R16 P0 #1 fix: start_payloads は pop しない [次 nextMatch broadcast で
        # 新 start baseline に置換される]、 旧 pop は 2 試合目以降の再接続復元を破壊してた
        c.commit()
    return {"ok": True, "match_no": next_match_no}
    return {"ok": True}


@app.get("/api/users/{user_id}")
async def user_profile(user_id: str):
    with db_conn() as c:
        u = c.execute("SELECT * FROM users WHERE user_id=?", (user_id,)).fetchone()
        if not u:
            raise HTTPException(status_code=404, detail="user not found")
        history = c.execute(
            """SELECT m.match_id, m.room_id, m.chip_delta_json, m.finished_at
               FROM matches m WHERE m.chip_delta_json LIKE ?
               ORDER BY m.finished_at DESC LIMIT 50""",
            (f'%"{user_id}"%',),
        ).fetchall()
    return {"user": dict(u), "history": [dict(h) for h in history]}


_DIST_DIR = Path(__file__).resolve().parent.parent / "dist"


@app.get("/")
async def index(request: Request):
    # R14 follow-up: dist/index.html があれば 静的 SPA を serve [local online.spec.ts 用]、
    # 無ければ 既存 fallback HTML
    idx = _DIST_DIR / "index.html"
    if idx.exists():
        return FileResponse(idx)
    u = current_user(request)
    # R9 P2 #13 fix: username を HTML escape、 Discord 名に < > & " ' を含む user で XSS 防止
    uname_safe = html.escape(u["username"]) if u else "(none)"
    return HTMLResponse(
        f"""<!DOCTYPE html><html><head><meta charset=utf-8><title>anmika online</title></head>
        <body><h1>anmika online v0.1</h1>
        <p>logged in: {uname_safe}</p>
        <p><a href="/auth/discord/login">Discord でログイン</a></p>
        <p>API: /api/me /api/rooms /ws/room/&lt;id&gt;</p>
        </body></html>"""
    )


# R14 follow-up: dist/ 全 static [assets / favicon / sounds / tiles / icons] を serve
if _DIST_DIR.exists():
    app.mount("/assets", StaticFiles(directory=str(_DIST_DIR / "assets")), name="assets")
    if (_DIST_DIR / "sounds").exists():
        app.mount("/sounds", StaticFiles(directory=str(_DIST_DIR / "sounds")), name="sounds")
    if (_DIST_DIR / "tiles").exists():
        app.mount("/tiles", StaticFiles(directory=str(_DIST_DIR / "tiles")), name="tiles")

    @app.get("/favicon.svg")
    async def _favicon_svg():
        return FileResponse(_DIST_DIR / "favicon.svg")

    @app.get("/icons.svg")
    async def _icons_svg():
        return FileResponse(_DIST_DIR / "icons.svg")
