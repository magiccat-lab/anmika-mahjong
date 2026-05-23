
// anmika-mahjong WS relay server [リョー指示 2026-05-13 「single の UI そのまま、 CPU 打牌を他人の打牌に置き換えるだけ」]
//
// 役割: 部屋に接続した client 間で message を中継するだけ。 game logic は client 持ち。
// host が preShuffledPool [生成済 山 array] を broadcast → 全 client が同じ配牌で qipai → 同一 game state。
//
// 起動: tsx server/ws_server.ts (port 8791)
//
// message protocol:
//   client → server:
//     {type:'start', preShuffledPool: string[], qijia: number, members: [{seat, user_id, username, is_cpu}]}
//     {type:'action', action: {...}}  // game action [discard / lizhi / tsumo / ron / pass / ... ]
//   server → client:
//     {type:'lobby', members: [{seat, user_id, username, is_cpu}]}
//     {type:'start', preShuffledPool, qijia, members}  // from host へ、 他 client にも転送
//     {type:'action', from_seat: number, action: {...}}  // 送信元 seat 付き

import { WebSocketServer, WebSocket } from 'ws';
import jwt from 'jsonwebtoken';
import { randomInt as cryptoRandomInt } from 'node:crypto';

const PORT = parseInt(process.env.ANMIKA_WS_PORT ?? '8791');
const API_BASE = process.env.ANMIKA_API_BASE ?? 'http://127.0.0.1:8790';

// WS token 検証用 secret [Phase B1、 codex audit HIGH 1]。
// Python 側 server/app.py の WS_SECRET と同値、 default は ANMIKA_SESSION_SECRET。
// 未設定なら deny only mode で全 WS 接続を 4401 reject する [本番安全側]。
const WS_SECRET =
  process.env.ANMIKA_WS_SECRET ||
  process.env.ANMIKA_SESSION_SECRET ||
  '';

interface WsTokenPayload {
  uid: string;
  username?: string;
  seat: number;
  room_id: string;
  is_host: boolean;
  iat?: number;
  exp?: number;
}

function verifyWsToken(token: string): WsTokenPayload | null {
  if (!WS_SECRET) return null;
  try {
    const decoded = jwt.verify(token, WS_SECRET, { algorithms: ['HS256'] });
    if (typeof decoded !== 'object' || decoded === null) return null;
    const p = decoded as Record<string, unknown>;
    if (typeof p.uid !== 'string' || typeof p.room_id !== 'string' || typeof p.seat !== 'number') {
      return null;
    }
    return {
      uid: p.uid,
      username: typeof p.username === 'string' ? p.username : undefined,
      seat: p.seat,
      room_id: p.room_id,
      is_host: Boolean(p.is_host),
      iat: typeof p.iat === 'number' ? p.iat : undefined,
      exp: typeof p.exp === 'number' ? p.exp : undefined,
    };
  } catch (e) {
    return null;
  }
}

interface Member {
  user_id: string;
  username: string;
  seat: number;
  ws: WebSocket | null;
  is_cpu: boolean;
}

interface Room {
  room_id: string;
  members: Map<string, Member>;
  host_user_id: string;
  started: boolean;
  // host から start 受信時 size<3 で reject された場合、 ここに保留して 3 人揃った瞬間に発火
  // [race fix 2026-05-13: A 先 connect → host start ws.onopen 即送信 → size=2 で破棄 → B 後 connect で永遠に start こない 問題]
  pendingStart: { preShuffledPool: string[]; qijia: number } | null;
}

const rooms = new Map<string, Room>();

async function fetchRoomMembersFromAPI(room_id: string): Promise<Array<{ seat: number; user_id: string; username: string }> | null> {
  try {
    const r = await fetch(`${API_BASE}/api/rooms/${room_id}`);
    if (!r.ok) return null;
    const data = await r.json() as { room: any; members: any[] };
    return data.members ?? [];
  } catch (e) {
    return null;
  }
}

function getOrCreateRoom(room_id: string, host_user_id: string): Room {
  let r = rooms.get(room_id);
  if (!r) {
    r = { room_id, members: new Map(), host_user_id, started: false, pendingStart: null };
    rooms.set(room_id, r);
  }
  return r;
}

function broadcastMembers(room: Room): void {
  const membersList = Array.from(room.members.values()).map((m) => ({
    seat: m.seat, user_id: m.user_id, username: m.username, is_cpu: m.is_cpu,
  }));
  const msg = JSON.stringify({ type: 'lobby', members: membersList });
  for (const m of room.members.values()) {
    if (m.ws && m.ws.readyState === WebSocket.OPEN) {
      try { m.ws.send(msg); } catch (e) {}
    }
  }
}

function fireStart(room: Room, preShuffledPool: string[], qijia: number): void {
  room.started = true;
  room.pendingStart = null;
  // eslint-disable-next-line no-console
  console.log(`[anmika-ws] room=${room.room_id} game started, pool len=${preShuffledPool?.length}`);
  const startMsg = {
    type: 'start',
    preShuffledPool,
    qijia,
    members: Array.from(room.members.values()).map((m) => ({
      seat: m.seat, user_id: m.user_id, username: m.username, is_cpu: m.is_cpu,
    })),
  };
  for (const m of room.members.values()) {
    if (m.ws && m.ws.readyState === WebSocket.OPEN) {
      try { m.ws.send(JSON.stringify(startMsg)); } catch (e) {}
    }
  }
}

function broadcastToAll(room: Room, payload: any, exceptUid?: string): void {
  const msg = JSON.stringify(payload);
  for (const m of room.members.values()) {
    if (m.user_id === exceptUid) continue;
    if (m.ws && m.ws.readyState === WebSocket.OPEN) {
      try { m.ws.send(msg); } catch (e) {}
    }
  }
}

const wss = new WebSocketServer({ port: PORT });
// eslint-disable-next-line no-console
console.log(`[anmika-ws] relay-mode listening on :${PORT}`);

wss.on('connection', async (ws, req) => {
  const url = new URL(req.url ?? '/', 'http://localhost');
  const match = url.pathname.match(/^\/ws\/room\/([A-Z0-9]+)$/);
  if (!match) { ws.close(4404, 'invalid path'); return; }
  const room_id = match[1];

  // [Phase B1] JWT token 検証 — uid / seat / host / room_id を 全部 token 由来で決める。
  // クエリパラメータ uid/host/seat は無視 [client 偽装防止]。
  const token = url.searchParams.get('token') ?? '';
  const payload = token ? verifyWsToken(token) : null;
  if (!payload) {
    ws.close(4401, 'invalid or missing ws token');
    return;
  }
  if (payload.room_id !== room_id) {
    ws.close(4403, 'token room_id mismatch');
    return;
  }
  const uid = payload.uid;
  const name = payload.username ?? url.searchParams.get('name') ?? 'anon';
  const seat = payload.seat;
  // host_user_id は room の最初の member [is_host=true] が決定する、 後続 join は無視。
  // クライアントクエリ ?host= は信頼しない。
  const initialHost = payload.is_host ? uid : '';

  const room = getOrCreateRoom(room_id, initialHost);
  // host_user_id 未確定で is_host=true の token が来たら設定する [先に non-host が join した場合の保険]
  if (!room.host_user_id && payload.is_host) {
    room.host_user_id = uid;
  }
  const member: Member = {
    user_id: uid, username: name, seat, ws, is_cpu: uid.startsWith('CPU_'),
  };
  room.members.set(uid, member);
  // 初回 connect 時 CPU を DB から auto-register
  if (room.members.size === 1) {
    const dbMembers = await fetchRoomMembersFromAPI(room_id);
    if (dbMembers) {
      for (const m of dbMembers) {
        if (m.user_id.startsWith('CPU_') && !room.members.has(m.user_id)) {
          room.members.set(m.user_id, {
            user_id: m.user_id, username: m.username, seat: m.seat, ws: null, is_cpu: true,
          });
        }
      }
    }
  }
  // eslint-disable-next-line no-console
  console.log(`[anmika-ws] join room=${room_id} uid=${uid} seat=${seat} (total=${room.members.size})`);
  broadcastMembers(room);
  // pending start があり 3 人揃ったら発火 [race fix]
  if (!room.started && room.pendingStart && room.members.size >= 3) {
    fireStart(room, room.pendingStart.preShuffledPool, room.pendingStart.qijia);
  }

  ws.on('message', (data) => {
    let msg: any;
    try { msg = JSON.parse(data.toString()); } catch (e) { return; }
    if (msg.type === 'start') {
      // host のみ
      if (uid !== room.host_user_id) return;
      if (room.started) return;
      if (room.members.size < 3) {
        // pending に積んで 3 人揃った瞬間に発火する [race fix]
        room.pendingStart = { preShuffledPool: msg.preShuffledPool, qijia: msg.qijia ?? 0 };
        // eslint-disable-next-line no-console
        console.log(`[anmika-ws] room=${room_id} start pending [size=${room.members.size}, waiting for 3]`);
        return;
      }
      fireStart(room, msg.preShuffledPool, msg.qijia ?? 0);
    } else if (msg.type === 'action') {
      // [Phase B3 audit HIGH] サイコロは server で乱数生成し client override を信頼しない。
      // client が `rollSaiKoroDice` を送ってきたら、 server side で crypto.randomInt(1,7) × 2 を
      // 生成し action.override を上書きしてから broadcast する [既存 client validation 経路も
      // 通せるよう、 action 構造はそのまま維持]。
      const action = msg.action ?? {};
      if (action && action.type === 'rollSaiKoroDice') {
        const d1 = cryptoRandomInt(1, 7);
        const d2 = cryptoRandomInt(1, 7);
        action.override = [d1, d2];
      }
      const relay = { type: 'action', from_seat: seat, from_user_id: uid, action };
      // eslint-disable-next-line no-console
      console.log(`[anmika-ws] action room=${room.room_id} from_seat=${seat} action=${JSON.stringify(action).slice(0,100)}`);
      broadcastToAll(room, relay);
    }
  });

  ws.on('close', (code, reason) => {
    room.members.delete(uid);
    // eslint-disable-next-line no-console
    console.log(`[anmika-ws] leave room=${room_id} uid=${uid} code=${code} reason=${reason?.toString?.() ?? ''} (remain=${room.members.size})`);
    if (room.members.size === 0) {
      rooms.delete(room_id);
    } else {
      broadcastMembers(room);
    }
  });
});
