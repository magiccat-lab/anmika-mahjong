// [2026-10-13 リョー「部屋を閉じるときに、その部屋でのチップ推移とか最高打点とかハイライトみたいなところとかまとめるようにしてほしい」
//  →「個人スタッツも出せば？放銃時平均チップとか。何サイコロを何回振って何回当ててるとかそういう分析」]
// stats DB に無い物を部屋の記録 [room_accepted_commands] から出す。DB は読むだけ [readOnly]。
//  - サイコロ: 誰が [部屋の席] 何回振って何回当てたか、そのサイコロで動いたチップ。記録の command だけで数える
//    [当たり = ゾロ目でなく出目が選んだ組 / チップ = その間の command に焼いた _roomChipDelta の和]
//  - サイコロの種類とアガリの手牌: 東風ごとに区切りから今のコードで読み直して付ける。夜の途中で裁定が変わると
//    [例: 10-13 の本待ち 2p のサイコロ無し] 読み直しが途中で合わなくなるので、合わなくなった東風の残りは付けない
// 使い方: node_modules/.bin/tsx tools/room_summary_replay.mts GFIO [db]
import { DatabaseSync } from 'node:sqlite';
import { resolve } from 'node:path';

import { createRoomAuthority, type RoomAuthority } from '../server/authority';
import { parseCanonicalRoomSnapshot, type AcceptedRoomCommand } from '../server/protocol';

const roomId = process.argv[2];
const dbPath = process.argv[3] ?? resolve('data', 'anmika.sqlite3');
if (!roomId) {
  console.error('usage: room_summary_replay.mts <room_id> [db]');
  process.exit(2);
}
const db = new DatabaseSync(dbPath, { readOnly: true });
const snapRow = db.prepare('SELECT snapshot_json FROM room_state_snapshots WHERE room_id=?').get(roomId) as { snapshot_json: string } | undefined;
const rows = db.prepare('SELECT command_id, revision, actor_seat, action_json, accepted_at FROM room_accepted_commands WHERE room_id=? ORDER BY revision ASC').all(roomId) as Array<{
  command_id: string; revision: number; actor_seat: number; action_json: string; accepted_at: string;
}>;
db.close();
if (!snapRow) {
  console.log(JSON.stringify({ room: roomId, error: 'no snapshot' }));
  process.exit(0);
}
const snapshot = parseCanonicalRoomSnapshot(snapRow.snapshot_json);
if (!snapshot.started || !snapshot.start) {
  console.log(JSON.stringify({ room: roomId, error: 'not started' }));
  process.exit(0);
}
const start = snapshot.start;
const commands: AcceptedRoomCommand[] = rows.map((row) => ({
  commandId: row.command_id, revision: row.revision, actorSeat: row.actor_seat, fromUserId: '',
  action: JSON.parse(row.action_json), matchId: 0, roundId: 0, acceptedAt: row.accepted_at,
}));
const roomSeatUser: Record<number, string> = {};
for (const member of start.members as Array<{ seat: number; user_id?: string }>) roomSeatUser[member.seat] = String(member.user_id ?? '');

// 東風ごとの区切り [nextMatch の手前まで]
const segments: AcceptedRoomCommand[][] = [[]];
for (const command of commands) {
  if (command.action.type === 'nextMatch') segments.push([command]);
  else segments[segments.length - 1].push(command);
}

type Dice = { match: number; seat: number; user: string; name: string; rolls: number; hits: number; chip: number; revision: number };
type Hule = { match: number; seat: number | null; ron: boolean; defen: number; hand: string; revision: number };
// 1 局で動いた祝儀 (アガリ ・ サイコロ ・ 華 ・ 流局のテンパイ料も全部)。局の切れ目は nextRound。
// 10-14 先輩「局で100枚以上動いた部分とかサイコロとかハイライトで3枚目以降の画像として」
type Hand = { match: number; ordinal: number; delta: Record<string, number>; hules: number; firstRevision: number; lastRevision: number };
const dice: Dice[] = [];
const hules: Hule[] = [];
const diverged: Array<{ match: number; revision: number; reason: string }> = [];
const hands: Hand[] = [];

// 1. 記録だけで数えるサイコロと、局ごとの祝儀の動き
segments.forEach((segment, index) => {
  const match = index + 1;
  let hand: Hand | null = null;
  for (const command of segment) {
    const action = command.action as Record<string, any>;
    if (action.type === 'nextMatch' || action.type === 'nextRound') {
      if (hand) hands.push(hand);
      hand = null;
      if (action.type === 'nextMatch') continue;
    }
    if (!hand) hand = { match, ordinal: hands.filter((h) => h.match === match).length + 1, delta: {}, hules: 0, firstRevision: command.revision, lastRevision: command.revision };
    hand.lastRevision = command.revision;
    if (action.type === 'tsumo' || action.type === 'ron') hand.hules += 1;
    for (const [seat, v] of Object.entries((action._roomChipDelta ?? {}) as Record<string, number>)) {
      hand.delta[seat] = (hand.delta[seat] ?? 0) + Number(v || 0);
    }
  }
  if (hand) hands.push(hand);
  let current: Dice | null = null;
  let combo: [number, number] | null = null;
  for (const command of segment) {
    const action = command.action as Record<string, any>;
    const delta = (action._roomChipDelta ?? {}) as Record<string, number>;
    if (action.type === 'selectSaiKoroCombo') {
      if (!current) {
        current = { match, seat: command.actorSeat, user: roomSeatUser[command.actorSeat] ?? '', name: '', rolls: 0, hits: 0, chip: 0, revision: command.revision };
      }
      combo = [Math.min(action.small, action.large), Math.max(action.small, action.large)];
    }
    if (current) current.chip += Number(delta[String(current.seat)] ?? 0);
    if (current && action.type === 'rollSaiKoroDice' && Array.isArray(action.override) && combo) {
      const [d1, d2] = action.override as [number, number];
      current.rolls += 1;
      if (d1 !== d2 && Math.min(d1, d2) === combo[0] && Math.max(d1, d2) === combo[1]) current.hits += 1;
    }
    if (current && action.type === 'advanceSaiKoro') {
      dice.push(current);
      current = null;
      combo = null;
    }
  }
});

// 2. 種類と手牌は東風ごとに読み直して付ける
const members = start.members.map((member) => ({ seat: member.seat, is_cpu: member.is_cpu }));
segments.forEach((segment, index) => {
  const match = index + 1;
  let authority: RoomAuthority;
  let body = segment;
  if (index === 0) {
    authority = createRoomAuthority({ preShuffledPool: start.preShuffledPool, qijia: start.qijia, changshu: start.changshu });
  } else {
    const next = segment[0].action as Record<string, any>;
    if (!next._startChipLedger) return;
    authority = createRoomAuthority({ preShuffledPool: next.preShuffledPool, qijia: next.qijia, changshu: start.changshu });
    authority.seedMatchStart(next._startChipLedger, members);
    body = segment.slice(1);
  }
  const mine = dice.filter((d) => d.match === match);
  for (const command of body) {
    const type = String(command.action.type);
    if (type === 'stamp') continue;
    const before: any = authority.canonicalState();
    if (type === 'selectSaiKoroCombo' && before.pendingSaiKoro) {
      const ps = before.pendingSaiKoro;
      const chance = ps.chances[ps.currentIdx] ?? {};
      const target = mine.find((d) => d.revision === command.revision);
      if (target) target.name = String(chance.name ?? chance.awardKey ?? '');
    }
    const eventsBefore = (before.game.events ?? []).length;
    const reason = authority.validateAndApply(command.actorSeat, structuredClone(command.action), members);
    if (reason) {
      diverged.push({ match, revision: command.revision, reason });
      return;
    }
    authority.takeCanonicalChipEffects();
    authority.takePendingCutins();
    const after: any = authority.canonicalState();
    // アガリは game の hule event で拾う [華や金北を選ぶ和了は tsumo の command の後で確定する]
    for (const event of (after.game.events ?? []).slice(eventsBefore)) {
      if (event?.type !== 'hule') continue;
      hules.push({ match, seat: event.player, ron: !!event.isRon, defen: Number(event.defen ?? 0), hand: String(after.game.shoupai.get(event.player)?.toString?.() ?? ''), revision: command.revision });
    }
  }
});

console.log(JSON.stringify({ room: roomId, matches_started: segments.length, room_seat_user: roomSeatUser, dice, hules, hands, diverged }));
