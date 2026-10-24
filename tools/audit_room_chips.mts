// tools/audit_room_chips.mts [2026-10-24 shun]
// [リョー「現ハンチャンまでの全部のアガリとかチップとか再計算してズレないかみといてね」]
// 部屋の記録を今のコードで頭から 1 command ずつ読み直し、精算 effect から部屋チップの delta を作り直して
// command に焼いた _roomChipDelta と突き合わせる。試合の終わりは順位チップ [finalize] も作り直す。
// あわせて 点の合計 [供託込み] ・ 部屋チップの合計 0 ・ snapshot の部屋チップ ・ API の試合ごとの chip を見る。
//
//   node_modules/.bin/tsx tools/audit_room_chips.mts --db <ws copy> --room ZOGE [--api <api copy>] [--hands]
import { parseArgs } from 'node:util';
import { DatabaseSync } from 'node:sqlite';
import { createRoomAuthority } from '../server/authority.ts';
import {
  computeRoomChipDelta,
  finalizeRoomChipDelta,
  gameToRoomSeat,
  initialRoomChipLedger,
  mergeRoomChipDelta,
} from '../server/rotation.ts';
import { applyRoomChipCommand, type RoomSeatMapping } from '../server/protocol.ts';
import { loadRoom, membersForReplay, openStoreReadOnly, routeConsoleLogToStderr } from './lib/replay_common.mts';

const { values } = parseArgs({
  options: {
    db: { type: 'string' }, room: { type: 'string' }, api: { type: 'string' },
    hands: { type: 'boolean' }, 'allow-live': { type: 'boolean' },
  },
});
routeConsoleLogToStderr();
const db = openStoreReadOnly(values.db, { allowLive: values['allow-live'] });
const loaded = loadRoom(db, values.room ?? '');
if (!loaded || !loaded.snapshot.start) throw new Error('room not found / not started');
const { snapshot, commands } = loaded;
const start = snapshot.start!;
const members = membersForReplay(snapshot);

type Delta = Record<string, number>;
const fmt = (d: Delta | null | undefined) => JSON.stringify(d ?? {});
const same = (a: Delta | null | undefined, b: Delta | null | undefined) => {
  const keys = new Set([...Object.keys(a ?? {}), ...Object.keys(b ?? {})]);
  for (const k of keys) if ((a?.[k] ?? 0) !== (b?.[k] ?? 0)) return false;
  return true;
};
const sum = (d: Record<string, number>) => Object.values(d).reduce((x, y) => x + y, 0);

const authority = createRoomAuthority({ preShuffledPool: start.preShuffledPool, qijia: start.qijia, changshu: start.changshu });
let mapping: RoomSeatMapping | null | undefined = start.initialMapping ?? null;
let ledger: Delta | undefined = initialRoomChipLedger(start);
let matchNo = 1;
const out = (s: string) => process.stdout.write(s + '\n');

const mismatches: string[] = [];
const scoreBreaks: string[] = [];
const ledgerBreaks: string[] = [];
const finalizeByMatch: Array<{ match: number; delta: Delta | null; baked: Delta | null; bakedHasFinal: boolean; rows: unknown }> = [];
const matchRoomChip: Record<number, Delta> = {};
const hands: string[] = [];
let handChip: Delta = {};
let handBakedChip: Delta = {};
let scoreTotal: number | null = null;

const addTo = (acc: Delta, d: Delta | null | undefined) => {
  for (const [k, v] of Object.entries(d ?? {})) acc[k] = (acc[k] ?? 0) + v;
};

for (const command of commands) {
  const action = command.action as Record<string, any>;
  if (action.type === 'stamp') continue;
  const g0 = authority.canonicalState().game;
  const wasEnded = authority.canonicalState().roundEnded;
  let finalize: Delta | null = null;
  let finalRows: unknown = null;
  if (action.type === 'nextMatch') {
    finalize = finalizeRoomChipDelta(g0 as any, mapping);
    finalRows = (g0 as any).getFinalScore().map((r: any) => ({ room: gameToRoomSeat(mapping, r.player), defen: r.defen, rank: r.rank, uma: r.uma, top: r.topNBonus, tobi: r.tobiBonus, tontonbu: r.tontonbuBonus, chip: r.chip, total: r.total }));
  }
  const gBefore = { ...g0.chipLedger } as Record<number, number>;
  const reason = authority.validateAndApply(command.actorSeat, action, members);
  if (reason) {
    out(`!! rev ${command.revision} ${action.type} rejected on replay: ${reason}`);
    break;
  }
  const effects = authority.takeCanonicalChipEffects();
  authority.takePendingCutins();
  const computed = mergeRoomChipDelta(computeRoomChipDelta(effects, mapping), finalize);
  const baked = (action._roomChipDelta ?? null) as Delta | null;
  if (!same(computed, baked)) {
    mismatches.push(`rev ${command.revision} m${matchNo} ${action.type}: 焼いた ${fmt(baked)} / 読み直し ${fmt(computed)}${finalize ? ` [内 finalize ${fmt(finalize)}]` : ''} `);
  }
  // 持ちチップ [game ledger] の動きが、抜け番を除いた精算 effect と合うか [試合の切り替えの command は除く]
  if (action.type !== 'nextMatch') {
    const gAfter = authority.canonicalState().game.chipLedger as Record<number, number>;
    const gameMove: Delta = {};
    for (const gs of [0, 1, 2]) {
      const v = (gAfter[gs] ?? 0) - (gBefore[gs] ?? 0);
      if (v) gameMove[String(gameToRoomSeat(mapping, gs))] = v;
    }
    const noBench = mapping ? { ...mapping, inactiveRoomSeat: -1 } : mapping;
    const expected = computeRoomChipDelta(effects, noBench);
    if (!same(gameMove, expected)) {
      ledgerBreaks.push(`rev ${command.revision} m${matchNo} ${action.type}: 持ちチップの動き ${fmt(gameMove)} / 精算 ${fmt(expected)} `);
    }
  }
  if (action.type === 'nextMatch') {
    // 4b466ce 以降の nextMatch は順位チップを焼いている。それより前は焼いておらず、部屋の start の補正に入っている
    finalizeByMatch.push({ match: matchNo, delta: finalize, baked, bakedHasFinal: same(computed, baked), rows: finalRows });
  }
  addTo(handChip, computed);
  addTo(handBakedChip, baked);
  addTo((matchRoomChip[matchNo] ??= {}), baked);
  // 部屋チップの fold [snapshot と同じ規則]
  const folded = applyRoomChipCommand(ledger, mapping, action);
  ledger = folded.ledger;
  if (ledger && sum(ledger) !== 0) scoreBreaks.push(`rev ${command.revision}: 部屋チップの合計が ${sum(ledger)}`);
  if (action.type === 'nextMatch') {
    mapping = folded.mapping;
    matchNo += 1;
    scoreTotal = null;
    if (action._startChipLedger) authority.rebaseChipLedger(action._startChipLedger);
  }
  const st = authority.canonicalState();
  const g = st.game;
  // 点の合計 [供託込み] は局の終わりで一定のはず
  if (st.roundEnded && !wasEnded) {
    const total = Object.values(g.state.defen as Record<number, number>).reduce((x, y) => x + y, 0) + (g.state.lizhibang ?? 0) * 1000;
    if (scoreTotal === null) scoreTotal = total;
    else if (total !== scoreTotal) scoreBreaks.push(`rev ${command.revision} m${matchNo}: 点の合計 ${total} (前 ${scoreTotal})`);
  }
  if (action.type === 'nextRound' || action.type === 'nextMatch') {
    if (Object.keys(handBakedChip).length || Object.keys(handChip).length) {
      hands.push(`m${matchNo - (action.type === 'nextMatch' ? 1 : 0)} rev≤${command.revision} 焼いた ${fmt(handBakedChip)}${same(handChip, handBakedChip) ? '' : ` / 読み直し ${fmt(handChip)}`}`);
    }
    handChip = {};
    handBakedChip = {};
  }
}

const g = authority.canonicalState().game;
out(`room ${loaded.roomId}: command ${commands.length} 件 (rev ${commands.at(-1)?.revision}) / 試合 ${matchNo} 試合目の途中`);
out(`今の局: ${g.state.changbang === 0 ? '東' : '南'}${g.state.jushu + 1} 局 ${g.state.benbang} 本場 / 点 ${JSON.stringify(g.state.defen)} 供託 ${g.state.lizhibang}`);
out(`部屋チップ: 読み直しの fold ${fmt(ledger)} / snapshot ${fmt(snapshot.roomChipLedger)} → ${same(ledger, snapshot.roomChipLedger as Delta) ? '一致' : 'ズレ'}`);
const proj: Delta = {};
for (const gs of [0, 1, 2]) proj[String(gameToRoomSeat(mapping, gs))] = g.chipLedger[gs as 0 | 1 | 2];
out(`今の試合の持ちチップ (部屋の席で) ${fmt(proj)} / mapping ${JSON.stringify(mapping)}`);
out(`精算の delta のズレ: ${mismatches.length} 件`);
for (const m of mismatches) out('  ' + m);
out(`点 ・ 合計の破れ: ${scoreBreaks.length} 件`);
for (const m of scoreBreaks) out('  ' + m);
out(`持ちチップと精算のズレ: ${ledgerBreaks.length} 件`);
for (const m of ledgerBreaks) out('  ' + m);
out('試合の終わりの順位チップ:');
for (const f of finalizeByMatch) out(`  試合 ${f.match}: 読み直し ${fmt(f.delta)} / 焼いた ${fmt(f.baked)} ${JSON.stringify(f.rows)}`);
out('試合ごとの部屋チップ (焼いた delta の和):');
for (const [m, d] of Object.entries(matchRoomChip)) out(`  試合 ${m}: ${fmt(d)} 合計 ${sum(d)}`);
if (values.hands) { out('局ごと:'); for (const h of hands) out('  ' + h); }

if (values.api) {
  const api = new DatabaseSync(values.api, { readOnly: true });
  const rows = api.prepare('SELECT match_id, match_no, chip_delta_json, members_json, finished_at FROM matches WHERE room_id=? ORDER BY match_no').all(loaded.roomId) as any[];
  const roomMembers = (start.roomMembers ?? start.members) as Array<{ seat: number; user_id?: string; username?: string }>;
  const seatOf = new Map(roomMembers.map((m) => [String(m.user_id), String(m.seat)]));
  out('API の matches:');
  for (const r of rows) {
    const d = JSON.parse(r.chip_delta_json) as Record<string, number>;
    const bySeat: Delta = {};
    for (const [uid, v] of Object.entries(d)) bySeat[seatOf.get(uid) ?? uid] = v;
    const stats = api.prepare('SELECT user_id, chip_delta, final_defen, placement FROM match_player_stats WHERE match_id=?').all(r.match_id) as any[];
    const st: Delta = {};
    for (const s of stats) st[seatOf.get(String(s.user_id)) ?? s.user_id] = s.chip_delta;
    const withFinal: Delta = { ...(matchRoomChip[r.match_no] ?? {}) };
    const fin = finalizeByMatch.find((f) => f.match === r.match_no);
    if (fin && !fin.bakedHasFinal) addTo(withFinal, fin.delta);
    out(`  試合 ${r.match_no}: matches ${fmt(bySeat)} / stats ${fmt(st)} / 部屋 + 順位 ${fmt(withFinal)} → ${same(bySeat, withFinal) ? '一致' : 'ズレ'}`);
  }
}
