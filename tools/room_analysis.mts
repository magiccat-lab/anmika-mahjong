// 部屋の打牌の分析 [2026-10-14 リョー「nagaとか他の麻雀AIのロジックを解析して組み込んでほしい」→ ページの答え P1 ・ P2 ・ Q1 ・ Q2]
// 部屋のまとめ (room_summary_replay.mts、3 分以内に作る) とは別の道具。人の打牌 1 つずつに、切る候補ごとの期待値を当てる。
//  - P1 受け入れの質: 1 シャンテン以下は、引いてテンパイした時の待ちの枚数と打点 (majiang-core の点数 + フィーバーの段) で重み付け
//  - P2 押し引き: リーチを受けている時は、今の打牌の目安の放銃率 × 相手の打点 (部屋のアガリの平均) を引く (akochan ・ 爆打の型の簡易版)
//  - Q1 全打牌: 候補の中で一番期待値の高い切り方との差 (点) を「損」として全打牌に付ける。NAGA の一致率の様に、損 0 の割合も出す
// 和了率は「残りのツモで待ちを引く」だけの目安 (1 − (1 − 待ち/見えていない牌)^残りツモ)。相手のロン ・ 流局 ・ 次の巡の放銃は数えない。
// P3 (モンテカルロ) はこの後に別に足す。使い方: node_modules/.bin/tsx tools/room_analysis.mts GFIO [db]
import { DatabaseSync } from 'node:sqlite';
import { resolve } from 'node:path';

// @ts-ignore - majiang-core 型定義なし
import Majiang from '@kobalab/majiang-core';
import { createRoomAuthority, type RoomAuthority } from '../server/authority';
import { parseCanonicalRoomSnapshot, type AcceptedRoomCommand } from '../server/protocol';
import { toCorePai, normalizeBaopaiForMajiang, isPositiveZ5 } from '../src/lib/helpers';
import { canFeverLizhi } from '../src/lib/game3/feverLizhi';
import { comboDanger, comboBreakdown } from './lib/combo_danger.mts';

const roomId = process.argv[2];
const dbPath = process.argv[3] ?? resolve('data', 'anmika.sqlite3');
if (!roomId) {
  console.error('usage: room_analysis.mts <room_id> [db]');
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
const members = start.members.map((member: any) => ({ seat: member.seat, is_cpu: member.is_cpu }));
const segments: AcceptedRoomCommand[][] = [[]];
for (const command of commands) {
  if (command.action.type === 'nextMatch') segments.push([command]);
  else segments[segments.length - 1].push(command);
}

// アンミカのルールで点数を出す (game3 の hule と同じ設定)
const anmikaRule = Majiang.rule({
  '配給原点': 35000, '順位点': ['30.0', '0', '-30.0'], '場数': 1, '連荘方式': 3, 'ノーテン罰あり': false,
  'クイタンあり': true, '途中流局あり': false, '一発あり': true, '裏ドラあり': true,
});
const baseOf = (p: string) => {
  const core = toCorePai(String(p).replace(/[+=\-_*]/g, ''));
  return core.length < 2 ? core : core[0] + (core[1] === '0' ? '5' : core[1]);
};
const HONOR: Record<string, string> = { z1: '東', z2: '南', z3: '西', z4: '北', z5: '白', z6: '發', z7: '中' };
const tileName = (b: string) => HONOR[b] ?? `${b[1]}${({ m: '萬', p: '筒', s: '索' } as Record<string, string>)[b[0]] ?? ''}`;
const DRAW_KINDS: string[] = [];
for (const s of ['m', 'p', 's']) for (let n = 1; n <= 9; n++) if (s !== 'm' || n === 7 || n === 9) DRAW_KINDS.push(s + n);
for (let n = 1; n <= 7; n++) DRAW_KINDS.push('z' + n);

type Ctx = { game: any; player: number; unseen: (t: string) => number; unseenTotal: number; draws: number; param: any };

// 13 枚のテンパイの手: 待ちの見えていない枚数と、待ちごとの打点 (ロン、リーチ付き) の重み付き平均 × フィーバーの段
function tenpaiValue(ctx: Ctx, e: any): { wait: number; value: number; fever: number } {
  let waits: string[] = [];
  try { waits = Majiang.Util.tingpai(e) ?? []; } catch { waits = []; }
  let wait = 0, sum = 0;
  for (const w of waits) {
    const rem = ctx.unseen(baseOf(w));
    if (!rem) continue;
    let defen = 0;
    try {
      const r = Majiang.Util.hule(e.clone(), `${w}-`, ctx.param);
      defen = Number(r?.defen ?? 0);
    } catch { defen = 0; }
    wait += rem;
    sum += rem * defen;
  }
  let fever = 0;
  try { const f = canFeverLizhi(e); if (f.ok) fever = f.tier; } catch { fever = 0; }
  // フィーバーは和了が続くので打点を (1 + 段) 倍で見る (目安。P3 で試して入れ替える)
  return { wait, value: wait ? (sum / wait) * (1 + fever) : 0, fever };
}
const winProb = (wait: number, unseenTotal: number, draws: number) =>
  unseenTotal > 0 && draws > 0 ? 1 - Math.pow(Math.max(0, 1 - wait / unseenTotal), draws) : 0;

// 切った後の手の期待値 (点)。2 シャンテン以上は null (受け入れの枚数で比べる)
function optionEv(ctx: Ctx, sp: any, pai: string): { ev: number | null; xt: number; detail: string } {
  const a = sp.clone();
  try { a.dapai(pai); } catch { return { ev: null, xt: 99, detail: '' }; }
  const xt = Majiang.Util.xiangting(a);
  if (xt === 0) {
    const t = tenpaiValue(ctx, a);
    const p = winProb(t.wait, ctx.unseenTotal, ctx.draws);
    return { ev: p * t.value, xt, detail: `テンパイ 待ち ${t.wait} 枚 ・ 打点 ${Math.round(t.value)}${t.fever ? ` (フィーバー ${t.fever} 段)` : ''} ・ 和了率 ${Math.round(p * 100)}%` };
  }
  if (xt !== 1) return { ev: null, xt, detail: '' };
  let reach = 0, acc = 0;
  for (const tk of DRAW_KINDS) {
    const rem = ctx.unseen(tk);
    if (!rem) continue;
    const b = a.clone();
    b._bingpai[tk[0]][Number(tk[1])] += 1;
    b._zimo = tk;
    if (Majiang.Util.xiangting(b) !== 0) continue;
    let best = 0;
    for (const c of b.get_dapai(false) as string[]) {
      const e = b.clone();
      try { e.dapai(c); } catch { continue; }
      if (Majiang.Util.xiangting(e) !== 0) continue;
      const t = tenpaiValue(ctx, e);
      // テンパイになった後のツモは残りの半分くらい
      best = Math.max(best, winProb(t.wait, ctx.unseenTotal, Math.max(1, Math.floor(ctx.draws / 2))) * t.value);
    }
    reach += rem;
    acc += rem * best;
  }
  const pReach = winProb(reach, ctx.unseenTotal, ctx.draws);
  const avg = reach ? acc / reach : 0;
  return { ev: pReach * avg, xt, detail: `テンパイへの受け入れ ${reach} 枚 ・ テンパイした時の期待値 ${Math.round(avg)}` };
}

type Review = {
  match: number; hand: number; turn: number; seat: number; user: string; hand14: string; chosen: string; best: string;
  loss: number | null; xiangting: number; best_xiangting: number; options: Array<{ pai: string; ev: number | null; xt: number; ukeire: number; danger: number; detail: string; combo: string }>;
  kind: 'ev' | 'ukeire'; lizhi: boolean; bad: boolean;
  // 悪手の時だけ局面を残す (河は席番号 → 打った牌、ドラ表示、リーチ者の席)
  rivers?: Record<string, string[]>; dora?: string[]; lizhi_seats?: number[];
};
const reviews: Review[] = [];
const oppValues: number[] = [];
const diverged: Array<{ match: number; revision: number; reason: string }> = [];

function review(game: any, action: Record<string, any>, match: number, hand: number, seat: number): void {
  const player = game.lunbanToPlayerId(game.state.lunban);
  const rowsAll: any[] = game.adviseDiscard(player, 99) ?? [];
  if (!rowsAll.length || rowsAll[0].forced) return;
  const sp = game.shoupai.get(player);
  const chosenRaw = action.type === 'tsumokiri' ? String(sp?._zimo ?? '') : String(action.pai ?? '');
  const chosenRow = rowsAll.find((r) => r.pai === chosenRaw) ?? rowsAll.find((r) => r.base === baseOf(chosenRaw));
  if (!chosenRow) return;
  // 見えていない枚数 (自分の手 ・ 全員の河 ・ 鳴き ・ ドラ表示を引く)
  const seenCount: Record<string, number> = {};
  const addSeen = (p: string) => { const b = baseOf(p); if (b) seenCount[b] = (seenCount[b] ?? 0) + 1; };
  for (const s of ['m', 'p', 's', 'z']) for (let n = 1; n <= 9; n++) { const c = Number(sp?._bingpai?.[s]?.[n] ?? 0); if (c) seenCount[s + n] = (seenCount[s + n] ?? 0) + c; }
  for (const p of [0, 1, 2]) {
    for (const d of (game.he.get(p)?._pai ?? []) as string[]) addSeen(d);
    for (const m of (game.shoupai.get(p)?._fulou ?? []) as string[]) { const s = m[0]; for (const ch of m.replace(/[^0-9]/g, '')) addSeen(s + ch); }
  }
  for (const x of (game.shan?.baopai ?? []) as string[]) addSeen(x);
  const unseen = (t: string) => Math.max(0, 4 - (seenCount[t] ?? 0));
  const unseenTotal = DRAW_KINDS.reduce((a, t) => a + unseen(t), 0);
  const paishu = Number(game.shan?.paishu ?? 0);
  const ctx: Ctx = {
    game, player, unseen, unseenTotal, draws: Math.max(1, Math.floor(paishu / 3)),
    param: Majiang.Util.hule_param({
      rule: anmikaRule, zhuangfeng: game.changfengZ - 1, menfeng: game.zifengZ(player) - 1, lizhi: 1,
      baopai: (game.shan?.baopai ?? []).filter((p: any) => typeof p === 'string' && !p.startsWith('f') && !isPositiveZ5(p)).map(normalizeBaopaiForMajiang),
      fubaopai: null, changbang: game.state.benbang, lizhibang: game.state.lizhibang,
    }),
  };
  const hasLizhi = !!rowsAll[0].hasLizhiOpponent;
  const vOpp = oppValues.length ? oppValues.reduce((a, b) => a + b, 0) / oppValues.length : 8000;
  const minXt = Math.min(...rowsAll.map((r) => r.xiangting));
  const comboDanger0 = comboDanger(game, player);
  // 見る候補: 一番少ないシャンテンの物と、切った牌 (多くても 8 つ。受け入れの多い順)。リーチを受けていれば一番安い牌 (降りの候補) も
  const safest = hasLizhi ? [...rowsAll].sort((a, b) => (comboDanger0.get(a.base) ?? 0) - (comboDanger0.get(b.base) ?? 0))[0] : null;
  const cand = [chosenRow, ...(safest ? [safest] : []), ...rowsAll.filter((r) => r.xiangting === minXt).sort((a, b) => b.ukeire - a.ukeire).slice(0, 8)]
    .filter((r, i, arr) => arr.findIndex((x) => x.base === r.base) === i);
  // 放銃率はコンボ理論 (tools/lib/combo_danger.mts)
  const combo = comboDanger0;
  const options = cand.map((r) => {
    const e = optionEv(ctx, sp, r.pai);
    const danger = combo.get(r.base) ?? 0;
    // リーチを受けている時、2 シャンテン以上に下がる切り方は降り (アガリを見ない) として −放銃率 × 相手の打点で比べる
    const fold = e.ev === null && hasLizhi;
    const ev = fold ? -(danger / 100) * vOpp : e.ev === null ? null : e.ev - (hasLizhi ? (danger / 100) * vOpp : 0);
    return { pai: r.pai, base: r.base, ev, xt: e.xt === 99 ? r.xiangting : e.xt, ukeire: r.ukeire, danger, detail: fold ? '降り (アガリを見ない)' : e.detail };
  });
  const chosen = options.find((o) => o.base === chosenRow.base)!;
  let best = options[0];
  let kind: 'ev' | 'ukeire' = 'ukeire';
  if (options.every((o) => o.ev !== null)) {
    kind = 'ev';
    for (const o of options) if ((o.ev as number) > (best.ev as number)) best = o;
  } else {
    // 2 シャンテン以上: シャンテン → 受け入れ。リーチを受けていれば放銃率の低い方 (CPU と同じ降りの線)
    for (const o of options) {
      const better = o.xt < best.xt || (o.xt === best.xt && (hasLizhi && minXt >= 2 ? o.danger < best.danger : o.ukeire > best.ukeire));
      if (better) best = o;
    }
  }
  const loss = kind === 'ev'
    ? Math.max(0, Math.round((best.ev as number) - (chosen.ev as number)))
    : (chosen.xt > best.xt ? null : best.ukeire > 0 ? Math.round((1 - chosen.ukeire / best.ukeire) * 100) / 100 : 0);
  const bad = loss === null || (kind === 'ev' ? (loss as number) >= 1000 : (loss as number) >= 0.4);
  const context = bad ? {
    rivers: Object.fromEntries([0, 1, 2].map((p) => [String(p), [...((game.he.get(p)?._pai ?? []) as string[])]])),
    dora: [...((game.shan?.baopai ?? []) as string[])],
    lizhi_seats: [...(game.lizhi ?? [])] as number[],
  } : {};
  reviews.push({
    match, hand, turn: (game.he.get(player)?._pai ?? []).length + 1, seat, user: roomSeatUser[seat] ?? '', hand14: String(sp?.toString?.() ?? ''),
    chosen: chosenRaw, best: best.pai, loss, xiangting: chosen.xt, best_xiangting: best.xt, kind, lizhi: hasLizhi, bad, ...context,
    options: options.map((o) => ({ pai: o.pai, ev: o.ev === null ? null : Math.round(o.ev), xt: o.xt, ukeire: o.ukeire, danger: o.danger, detail: o.detail,
      combo: hasLizhi ? comboBreakdown(game, player, o.base) : '' })),
  });
}

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
  let handNo = 1;
  for (const command of body) {
    const type = String(command.action.type);
    if (type === 'stamp') continue;
    if (type === 'nextRound') handNo += 1;
    const before: any = authority.canonicalState();
    if ((type === 'discard' || type === 'tsumokiri') && members.find((m: any) => m.seat === command.actorSeat && !m.is_cpu)) {
      try {
        review(before.game, command.action as Record<string, any>, match, handNo, command.actorSeat);
      } catch {
        // 分析は付けるだけ。読み直しは止めない
      }
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
    for (const event of (after.game.events ?? []).slice(eventsBefore)) {
      if (event?.type === 'hule' && Number(event.defen) > 0) oppValues.push(Number(event.defen));
    }
  }
});

// 人ごと: 一致率 (損 0)、悪手率 (期待値で 1,000 点以上 ・ シャンテン戻し ・ 受け入れ 4 割以上減)、期待値の損の合計
const byUser: Record<string, { discards: number; match: number; bad: number; ev_loss: number; ev_count: number }> = {};
for (const r of reviews) {
  const u = (byUser[r.user] ??= { discards: 0, match: 0, bad: 0, ev_loss: 0, ev_count: 0 });
  u.discards += 1;
  if (baseOf(r.best) === baseOf(r.chosen) || r.loss === 0) u.match += 1;
  if (r.bad) u.bad += 1;
  if (r.kind === 'ev' && r.loss !== null) { u.ev_loss += r.loss; u.ev_count += 1; }
}
console.log(JSON.stringify({
  room: roomId, room_seat_user: roomSeatUser, diverged, opp_value: oppValues.length ? Math.round(oppValues.reduce((a, b) => a + b, 0) / oppValues.length) : 8000,
  by_user: byUser, reviews, names: Object.fromEntries(Object.entries(HONOR)), tile_name_example: tileName('p5'),
}));
