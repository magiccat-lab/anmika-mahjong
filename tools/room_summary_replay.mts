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
import { toCorePai } from '../src/lib/helpers';
import Majiang from '@kobalab/majiang-core';
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

// base / sign / shuba は読み直しで付ける [合わなくなった東風は 0 / '' / null のまま]。
// 10-14 先輩「サイコロはベースと±別でちゃんと出したいね。あとシュバと順当な当てとね、その辺も整理して」
//  - hitChip = 出目当ての分 [ゾロ目でない投げの command の _roomChipDelta]、zoroChip = シュバの連続ゾロ目特典の分 [ゾロ目の投げ]
type Dice = {
  match: number; seat: number; user: string; name: string; rolls: number; hits: number; chip: number; revision: number;
  zoros: number; hitChip: number; zoroChip: number; base: number; mult: number; sign: '' | '+' | '-'; shuba: boolean | null;
};
type Hule = { match: number; seat: number | null; ron: boolean; defen: number; hand: string; revision: number };
// 1 局で動いた祝儀 (アガリ ・ サイコロ ・ 華 ・ 流局のテンパイ料も全部)。局の切れ目は nextRound。
// 10-14 先輩「局で100枚以上動いた部分とかサイコロとかハイライトで3枚目以降の画像として」
type Hand = { match: number; ordinal: number; delta: Record<string, number>; hules: number; firstRevision: number; lastRevision: number };
const dice: Dice[] = [];
const hules: Hule[] = [];
const diverged: Array<{ match: number; revision: number; reason: string }> = [];
// 打牌の見返し (10-14 先輩「打牌のミスとかjsonで見返せるようにしたいな。牌効率の問題とか祝儀/フィーバー効率の問題とか」)。
// 人が切る直前に Game3.adviseDiscard (CPU と同じ物差し: シャンテン → 受け入れ → 祝儀温存の減点込みの優先度、リーチ者がいれば安全度) を当てる。
// 「ミス」ではなく「CPU の物差しと違う打牌」として出す。リーチ後とフィーバーの強制ツモ切りは見ない
type DiscardTag = '牌効率' | '受け入れ' | '祝儀・フィーバー' | '危険牌';
type DiscardReview = {
  match: number; hand: number; revision: number; seat: number; user: string; hand14: string; chosen: string;
  xiangting: number; ukeire: number; cpu: string; best: Array<{ pai: string; xiangting: number; ukeire: number; safety: number }>;
  tags: DiscardTag[]; note: string;
  // 10-14 先輩「具体的な川の状況とかを見たい」「5sは何目的で切ったのか分からん」: 局面と CPU の決め手
  turn: number; rivers: Record<string, string[]>; dora: string[]; lizhi: number[]; cpu_reason: string;
};
// 東風ごと → 人ごと (まとめは前にまとめた東風の続きから作るので、数は東風で分けておく)
const discardStats: Record<string, Record<string, { evaluated: number; cpu_match: number; tags: Record<string, number> }>> = {};
const discardReviews: DiscardReview[] = [];
const baseOf = (p: string) => {
  const core = toCorePai(String(p).replace(/[\+\=\-_*]/g, ''));
  return core.length < 2 ? core : core[0] + (core[1] === '0' ? '5' : core[1]);
};
// CPU (game3 evaluateDiscardRows_) が牌を残したがる理由。prio の減点の言葉の版
function keepReasons(game: any, player: number, sp: any, base: string, dropsNiji: boolean): string[] {
  const out: string[] = [];
  const s = base[0];
  const n = Number(base[1]);
  if (n === 7 && 'mps'.includes(s)) {
    const held = Number(sp?._bingpai?.[s]?.[7] ?? 0);
    out.push(held >= 2 ? `7 は ${held} 枚あるのでフィーバーの種として強く残す` : '7 はフィーバーの種として軽く残す');
  }
  const seeds = ['m', 'p', 's'].filter((x) => Number(sp?._bingpai?.[x]?.[7] ?? 0) >= 3).length;
  if (seeds >= 1 && (n === 6 || n === 8) && 'mps'.includes(s)) out.push('7 の暗刻の周りなので残す');
  if (base === 'm9') out.push(Number(sp?._bingpai?.m?.[9] ?? 0) >= 2 ? '9 萬は 2 枚あるので国士 ・ 清老頭のために残す' : '9 萬は国士 ・ 清老頭のために残す');
  if (base === 'z5') out.push('白 (ぽっち) は残す');
  if (dropsNiji) out.push('切ると虹が河に出る');
  return out;
}
const HONOR_NAME: Record<string, string> = { z1: '東', z2: '南', z3: '西', z4: '北', z5: '白', z6: '發', z7: '中' };
const tileName = (b: string) => HONOR_NAME[b] ?? `${b[1]}${({ m: '萬', p: '筒', s: '索' } as Record<string, string>)[b[0]] ?? ''}`;
// 染め手に向かっているか: 切った後の手 (鳴いた面子を含む) で 1 色 + 字牌が 75% 以上、かつ切った牌がその色でも字牌でもない
function heading_flush(sp: any, chosenBase: string): boolean {
  const c = sp.clone();
  try { c.dapai(chosenBase); } catch { return false; }
  const counts: Record<string, number> = { m: 0, p: 0, s: 0, z: 0 };
  for (const x of ['m', 'p', 's', 'z']) for (let k = 1; k <= 9; k++) counts[x] += Number(c._bingpai?.[x]?.[k] ?? 0);
  for (const m of (c._fulou ?? []) as string[]) counts[m[0]] = (counts[m[0]] ?? 0) + (m.replace(/[^0-9]/g, '').length);
  const total = counts.m + counts.p + counts.s + counts.z;
  const main = (['m', 'p', 's'] as const).reduce((a, b) => (counts[b] > counts[a] ? b : a), 'p');
  return total > 0 && (counts[main] + counts.z) / total >= 0.75 && chosenBase[0] !== main && chosenBase[0] !== 'z';
}
function reviewDiscard(game: any, action: Record<string, any>, match: number, hand: number, revision: number, seat: number): void {
  const player = game.lunbanToPlayerId(game.state.lunban);
  const rows: any[] = game.adviseDiscard(player, 99) ?? [];
  if (!rows.length || rows[0].forced) return;
  const sp = game.shoupai.get(player);
  const chosenRaw = action.type === 'tsumokiri' ? String(sp?._zimo ?? '') : String(action.pai ?? '');
  if (!chosenRaw) return;
  const chosen = rows.find((r) => r.pai === chosenRaw) ?? rows.find((r) => r.base === baseOf(chosenRaw));
  if (!chosen) return;
  const user = roomSeatUser[seat] ?? '';
  const st = ((discardStats[String(match)] ??= {})[user] ??= { evaluated: 0, cpu_match: 0, tags: {} });
  st.evaluated += 1;
  const cpu = rows.find((r) => r.recommended) ?? rows[0];
  if (cpu.base === chosen.base) st.cpu_match += 1;
  const minXt = Math.min(...rows.map((r) => r.xiangting));
  const bestUk = Math.max(...rows.filter((r) => r.xiangting === minXt).map((r) => r.ukeire));
  // 祝儀温存の減点だけ: prio から字牌 ・ 端牌の加点 (字 3 / 1・9 は 2 / 2・8 は 1)、リーチ者がいる時の安全度、
  // 9 萬の国士 ・ 清老頭のための減点 (祝儀ではない。10-14 先輩「9mじゃなくて白切る理由も良く分からん」で取り違えが分かった) を抜く
  const chipPenalty = (r: any) => {
    const b = String(r.base ?? '');
    const n = Number(b[1]);
    const basePrio = b[0] === 'z' ? 3 : (n === 1 || n === 9) ? 2 : (n === 2 || n === 8) ? 1 : 0;
    const m9 = b === 'm9' ? (Number(sp?._bingpai?.m?.[9] ?? 0) >= 2 ? 2 : 1) : 0;
    return basePrio - (r.prio - (r.hasLizhiOpponent ? r.safety : 0)) - m9;
  };
  const flush = heading_flush(sp, chosen.base);
  const defending = chosen.hasLizhiOpponent && chosen.safety >= 4;
  const tags: DiscardTag[] = [];
  const notes: string[] = [];
  if (!defending && chosen.xiangting > minXt) {
    tags.push('牌効率');
    notes.push(`シャンテンが ${minXt} → ${chosen.xiangting} に戻った`);
  } else if (!defending && !flush && chosen.xiangting === minXt && bestUk - chosen.ukeire >= 4 && chosen.ukeire <= bestUk * 0.85) {
    tags.push('受け入れ');
    notes.push(`受け入れ ${chosen.ukeire} 枚 (一番多い切り方は ${bestUk} 枚)`);
  }
  const keepChip = chipPenalty(chosen) >= 2 ? rows.find((r) => r.base !== chosen.base && r.xiangting <= chosen.xiangting
    && r.ukeire >= chosen.ukeire && chipPenalty(r) < chipPenalty(chosen)) : undefined;
  if (keepChip) {
    tags.push('祝儀・フィーバー');
    notes.push(chosen.dropsNiji ? `虹を崩した (${keepChip.pai} なら崩さず同じ形)` : `祝儀 ・ フィーバーの種を切った (${keepChip.pai} でも形は同じ)`);
  }
  // テンパイ (切った後 0 シャンテン) の押しは判断なので外す
  if (chosen.hasLizhiOpponent && chosen.xiangting > 0 && chosen.safety < 0 && rows.some((r) => r.safety >= 4)) {
    tags.push('危険牌');
    notes.push('リーチ者がいる時に危険牌 (現物かスジがあった)');
  }
  if (flush && tags.includes('牌効率')) notes.push('染め手に向かう打牌かも (CPU は役を見ない)');
  for (const t of tags) st.tags[t] = (st.tags[t] ?? 0) + 1;
  if (!tags.length) return;
  // CPU の決め手を言葉で
  const why: string[] = [];
  if (cpu.xiangting < chosen.xiangting) why.push(`CPU の切り方だと ${cpu.xiangting} シャンテン、切った手は ${chosen.xiangting} シャンテン`);
  else if (cpu.ukeire !== chosen.ukeire) why.push(`受け入れ (次に引いてシャンテンが進む牌) が ${cpu.ukeire} 枚 対 ${chosen.ukeire} 枚`);
  else why.push('シャンテンも受け入れも同じで、残したい牌の決まりの差');
  const after = (pai: string) => { const c = sp.clone(); try { c.dapai(pai); } catch { return null; } return c; };
  const ca = after(cpu.pai);
  if (ca && cpu.xiangting <= 5) {
    const paths: string[] = [];
    if (Majiang.Util.xiangting_qidui(ca) === cpu.xiangting) paths.push('七対子');
    if (Majiang.Util.xiangting_guoshi(ca) === cpu.xiangting) paths.push('国士');
    if (paths.length) why.push(`${paths.join(' ・ ')}の受け入れも数に入っている`);
  }
  const keep = keepReasons(game, player, sp, chosen.base, chosen.dropsNiji);
  if (keep.length) why.push(`${tileName(chosen.base)}: ${keep.join('、')}`);
  if (chosen.base[0] === 'z' || cpu.base[0] === 'z') {
    if (cpu.base[0] === 'z' && chosen.base[0] !== 'z') why.push(`${tileName(cpu.base)} は字牌なので先に切る順`);
  }
  if (cpu.hasLizhiOpponent) why.push(`安全度は CPU の牌 ${cpu.safety} ・ 切った牌 ${chosen.safety} (現物 10 ・ スジ 4 ・ カベ 2 ・ 危険 -5)`);
  const rivers: Record<string, string[]> = {};
  for (const p of [0, 1, 2]) rivers[String(p)] = [...((game.he.get(p)?._pai ?? []) as string[])];
  const turn = (game.he.get(player)?._pai ?? []).length + 1;
  discardReviews.push({
    match, hand, revision, seat, user, hand14: String(sp?.toString?.() ?? ''), chosen: chosenRaw,
    xiangting: chosen.xiangting, ukeire: chosen.ukeire, cpu: cpu.pai,
    best: rows.slice(0, 3).map((r) => ({ pai: r.pai, xiangting: r.xiangting, ukeire: r.ukeire, safety: r.safety })),
    tags, note: notes.join(' / '),
    turn, rivers, dora: [...((game.shan?.baopai ?? []) as string[])], lizhi: [...(game.lizhi ?? [])] as number[], cpu_reason: why.join('。'),
  });
}
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
        current = {
          match, seat: command.actorSeat, user: roomSeatUser[command.actorSeat] ?? '', name: '', rolls: 0, hits: 0, chip: 0, revision: command.revision,
          zoros: 0, hitChip: 0, zoroChip: 0, base: 0, mult: 0, sign: '', shuba: null,
        };
      }
      combo = [Math.min(action.small, action.large), Math.max(action.small, action.large)];
    }
    const mineDelta = current ? Number(delta[String(current.seat)] ?? 0) : 0;
    if (current) current.chip += mineDelta;
    const rolled = action.type === 'rollSaiKoroDice' && Array.isArray(action.override) ? action.override as [number, number] : null;
    if (current && rolled && rolled[0] === rolled[1]) {
      current.zoros += 1;
      current.zoroChip += mineDelta;
    } else if (current) {
      current.hitChip += mineDelta;
    }
    if (current && rolled && combo) {
      const [d1, d2] = rolled;
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
  let handNo = 1;
  for (const command of body) {
    const type = String(command.action.type);
    if (type === 'stamp') continue;
    if (type === 'nextRound') handNo += 1;
    const before: any = authority.canonicalState();
    if ((type === 'discard' || type === 'tsumokiri') && members.find((m) => m.seat === command.actorSeat && !m.is_cpu)) {
      try {
        reviewDiscard(before.game, command.action as Record<string, any>, match, handNo, command.revision, command.actorSeat);
      } catch {
        // 見返しは付けるだけ。読み直しは止めない
      }
    }
    if (type === 'selectSaiKoroCombo' && before.pendingSaiKoro) {
      const ps = before.pendingSaiKoro;
      const chance = ps.chances[ps.currentIdx] ?? {};
      const target = mine.find((d) => d.revision === command.revision);
      if (target) {
        target.name = String(chance.name ?? chance.awardKey ?? '');
        target.base = Number(chance.baseChip ?? 0);
        // ± は払いの倍率の符号 [逆ぽっちは base が正のまま倍率で払いに回る。store.rollSaiKoroDice と同じ opts]
        const roller = Number(chance.winner ?? ps.winner) as 0 | 1 | 2;
        const mode = chance.mode === 'ron' ? 'ron' : 'tsumo';
        target.mult = before.game.computeChipMultiplier(roller, { bypassShuvari: true, bypassPochi: mode === 'ron', mode });
        target.sign = target.mult < 0 ? '-' : '+';
        // シュバサイ = 役固有の常時シュバ、またはシュバ適用のサイコロ × シュバ宣言中 [store.rollSaiKoroDice と同じ判定]
        target.shuba = chance.alwaysShuvari === true || (chance.shuvariApplicable === true && !!before.game.shuvariActive?.[roller]);
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
    // アガリは game の hule event で拾う [華や金北を選ぶ和了は tsumo の command の後で確定する]
    for (const event of (after.game.events ?? []).slice(eventsBefore)) {
      if (event?.type !== 'hule') continue;
      hules.push({ match, seat: event.player, ron: !!event.isRon, defen: Number(event.defen ?? 0), hand: String(after.game.shoupai.get(event.player)?.toString?.() ?? ''), revision: command.revision });
    }
  }
});

console.log(JSON.stringify({
  room: roomId, matches_started: segments.length, room_seat_user: roomSeatUser, dice, hules, hands, diverged,
  discard_review: discardReviews, discard_stats: discardStats,
}));
