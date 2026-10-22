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
import { canFeverLizhi } from '../src/lib/game3/feverLizhi';
import { comboDanger, comboBreakdown, passedTracker } from './lib/combo_danger.mts';
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
// リーチ後に他家が通した牌 (放銃率の現物に足す)
let passed = passedTracker();
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
  cpu_ukeire: number;
  // 10-14 先輩「フィーバー打つために確定暗刻にできるように8pきったんだと思う…フィーバー効率とかも加味して」:
  // 1 シャンテンで 7 が 2 枚以上ある時だけ、候補ごとに「引いてテンパイ + フィーバー立直できる」枚数と、そのうち 2 段以上
  fever: Record<string, { uke: number; fever: number; fever2: number }> | null;
  // 10-14 先輩「危険牌切るのはどう評価すればいいんだろうね」: 切った牌と CPU の牌の安全度を言葉で
  safety_note: string;
};
// 東風ごと → 人ごと (まとめは前にまとめた東風の続きから作るので、数は東風で分けておく)
const discardStats: Record<string, Record<string, { evaluated: number; cpu_match: number; tags: Record<string, number>; fold_spots: number; folded: number }>> = {};
const discardReviews: DiscardReview[] = [];
const baseOf = (p: string) => {
  const core = toCorePai(String(p).replace(/[\+\=\-_*]/g, ''));
  return core.length < 2 ? core : core[0] + (core[1] === '0' ? '5' : core[1]);
};
// 河とドラ表示に見えている枚数 (自分の手は数えない)
function visibleElsewhere(game: any, t: string): number {
  let v = 0;
  for (const p of [0, 1, 2]) for (const d of (game.he.get(p)?._pai ?? []) as string[]) if (baseOf(d) === t) v++;
  for (const x of (game.shan?.baopai ?? []) as string[]) if (baseOf(x) === t) v++;
  return v;
}
// 7 がもう暗刻にならない (手の枚数 + まだ見えていない枚数 < 3)。CPU の「7 はフィーバーの種」の決まりは残り枚数を見ていない
// (10-14 先輩「isgのやつも7m2キレとかじゃなかったか、そういうのもみてね」)
function deadSeven(game: any, sp: any, b: string): boolean {
  if (b[1] !== '7' || !'mps'.includes(b[0])) return false;
  const held = Number(sp?._bingpai?.[b[0]]?.[7] ?? 0);
  if (held >= 3) return false;
  const unseen = Math.max(0, 4 - held - visibleElsewhere(game, b));
  return held + unseen < 3;
}
// CPU (game3 evaluateDiscardRows_) が牌を残したがる理由。prio の減点の言葉の版
function keepReasons(game: any, player: number, sp: any, base: string, dropsNiji: boolean): string[] {
  const out: string[] = [];
  const s = base[0];
  const n = Number(base[1]);
  if (n === 7 && 'mps'.includes(s)) {
    const held = Number(sp?._bingpai?.[s]?.[7] ?? 0);
    if (deadSeven(game, sp, base)) out.push(`${tileName(base)} は ${visibleElsewhere(game, base)} 枚見えていて、もう暗刻にならない (CPU は残り枚数を見ずに残す)`);
    else out.push(held >= 2 ? `7 は ${held} 枚あるのでフィーバーの種として強く残す` : '7 はフィーバーの種として軽く残す');
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
const DRAW_KINDS: string[] = [];
for (const s of ['m', 'p', 's']) for (let n = 1; n <= 9; n++) if (s !== 'm' || n === 7 || n === 9) DRAW_KINDS.push(s + n);
for (let n = 1; n <= 7; n++) DRAW_KINDS.push('z' + n);
// 1 シャンテンの手で pai を切った後、引いてテンパイ (どれかを切って 0 シャンテン) になる牌の枚数と、
// そのテンパイでフィーバー立直できる (7 の確定暗刻) 枚数、うち 2 段以上の枚数
function feverUkeire(game: any, sp: any, pai: string): { uke: number; fever: number; fever2: number } | null {
  const a = sp.clone();
  try { a.dapai(pai); } catch { return null; }
  const xt = Majiang.Util.xiangting(a);
  if (xt !== 1) return null;
  const seen = (t: string) => {
    let v = 0;
    for (const p of [0, 1, 2]) for (const d of (game.he.get(p)?._pai ?? []) as string[]) if (baseOf(d) === t) v++;
    for (const b of (game.shan?.baopai ?? []) as string[]) if (baseOf(b) === t) v++;
    return v;
  };
  let uke = 0, fever = 0, fever2 = 0;
  for (const t of DRAW_KINDS) {
    const rem = Math.max(0, 4 - Number(a._bingpai?.[t[0]]?.[Number(t[1])] ?? 0) - seen(t));
    if (!rem) continue;
    const b = a.clone();
    b._bingpai[t[0]][Number(t[1])] += 1;
    b._zimo = t;
    if (Majiang.Util.xiangting(b) >= xt) continue;
    uke += rem;
    let best = 0;
    for (const c of b.get_dapai(false) as string[]) {
      const e = b.clone();
      try { e.dapai(c); } catch { continue; }
      if (Majiang.Util.xiangting(e) !== 0) continue;
      const f = canFeverLizhi(e);
      if (f.ok) best = Math.max(best, f.tier);
    }
    if (best >= 1) fever += rem;
    if (best >= 2) fever2 += rem;
  }
  return { uke, fever, fever2 };
}
const SAFETY_WORD = (v: number) => (v >= 10 ? '現物' : v >= 4 ? 'スジ' : v >= 2 ? 'カベ' : '危険 (現物でもスジでもない)');
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
  const st = ((discardStats[String(match)] ??= {})[user] ??= { evaluated: 0, cpu_match: 0, tags: {}, fold_spots: 0, folded: 0 });
  st.evaluated += 1;
  const cpu = rows.find((r) => r.recommended) ?? rows[0];
  // 降り率: リーチを受けて 2 シャンテン以上 (CPU なら降りる) の打牌のうち、目安の放銃率が一番安全な牌から 1.5% 以内だった割合
  const minXtAll = Math.min(...rows.map((r) => r.xiangting));
  // 放銃率はコンボ理論で見積もる (10-14 先輩「コンボ理論採用して解析してほしい」。前の目安の表 dangerPct は使わない)
  const combo = comboDanger(game, player, passed.passed);
  const danger = new Map<string, number>(rows.map((r) => [r.base, combo.get(r.base) ?? 0]));
  const minDanger = Math.min(...danger.values());
  const foldSpot = rows[0].hasLizhiOpponent && minXtAll >= 2;
  if (foldSpot) {
    st.fold_spots += 1;
    if ((danger.get(chosen.base) ?? 0) <= minDanger + 1.5) st.folded += 1;
  }
  if (cpu.base === chosen.base) {
    // CPU と同じ牌は拾わない (10-14 先輩「切った 南 → CPU なら 南 …こういうのは通知してもしゃーないやろ」)
    st.cpu_match += 1;
    return;
  }
  const minXt = Math.min(...rows.map((r) => r.xiangting));
  const bestUk = Math.max(...rows.filter((r) => r.xiangting === minXt).map((r) => r.ukeire));
  // 祝儀温存の減点だけ: prio から字牌 ・ 端牌の加点 (字 3 / 1・9 は 2 / 2・8 は 1)、リーチ者がいる時の安全度、
  // 9 萬の国士 ・ 清老頭のための減点 (祝儀ではない。10-14 先輩「9mじゃなくて白切る理由も良く分からん」で取り違えが分かった) を抜く
  const chipPenalty = (r: any) => {
    const b = String(r.base ?? '');
    const n = Number(b[1]);
    const basePrio = b[0] === 'z' ? 3 : (n === 1 || n === 9) ? 2 : (n === 2 || n === 8) ? 1 : 0;
    const m9 = b === 'm9' ? (Number(sp?._bingpai?.m?.[9] ?? 0) >= 2 ? 2 : 1) : 0;
    // 暗刻にならない 7 は種ではないので、CPU の 7 の減点 (3 枚 5 / 2 枚 3 / 1 枚 1) を数えない
    const held7 = Number(sp?._bingpai?.[b[0]]?.[7] ?? 0);
    const dead7 = deadSeven(game, sp, b) ? (held7 >= 2 ? 3 : 1) : 0;
    return basePrio - (r.prio - (r.hasLizhiOpponent ? r.safety : 0)) - m9 - dead7;
  };
  const flush = heading_flush(sp, chosen.base);
  // フィーバーの受け入れ: 1 シャンテンで 7 が 2 枚以上 (手の中) ある時だけ、切った牌 ・ CPU の牌 ・ 受け入れの多い 1 シャンテンの候補を見る
  const sevens = ['m', 'p', 's'].some((x) => Number(sp?._bingpai?.[x]?.[7] ?? 0) >= 2);
  let fever: Record<string, { uke: number; fever: number; fever2: number }> | null = null;
  if (sevens && minXt <= 1 && chosen.xiangting === 1) {
    fever = {};
    const opts = [chosen, cpu, ...rows.filter((r) => r.xiangting === 1).sort((a, b) => b.ukeire - a.ukeire).slice(0, 4)];
    for (const r of opts) {
      if (fever[r.base]) continue;
      const f = feverUkeire(game, sp, r.pai);
      if (f) fever[r.base] = f;
    }
  }
  const fvChosen = fever?.[chosen.base];
  const fvCpu = fever?.[cpu.base];
  // 切った方が 2 段以上のフィーバーを多く残すなら、受け入れが少なくてもフィーバーを見た打牌として拾わない
  const feverJustified = !!(fvChosen && fvCpu && fvChosen.fever2 > fvCpu.fever2);
  const feverBetter = fever ? Object.entries(fever).find(([b, f]) => b !== chosen.base && fvChosen && f.fever2 >= fvChosen.fever2 + 3 && f.fever >= fvChosen.fever) : undefined;
  const defending = chosen.hasLizhiOpponent && chosen.safety >= 4;
  const tags: DiscardTag[] = [];
  const notes: string[] = [];
  if (!defending && chosen.xiangting > minXt) {
    tags.push('牌効率');
    notes.push(`シャンテンが ${minXt} → ${chosen.xiangting} に戻った`);
  } else if (!defending && !flush && !feverJustified && chosen.xiangting === minXt && bestUk - chosen.ukeire >= 4 && chosen.ukeire <= bestUk * 0.85) {
    tags.push('受け入れ');
    notes.push(`受け入れ ${chosen.ukeire} 枚 (一番多い切り方は ${bestUk} 枚)`);
  }
  const keepChip = chipPenalty(chosen) >= 2 ? rows.find((r) => r.base !== chosen.base && r.xiangting <= chosen.xiangting
    && r.ukeire >= chosen.ukeire && chipPenalty(r) < chipPenalty(chosen)) : undefined;
  if (feverBetter && !tags.includes('祝儀・フィーバー')) {
    tags.push('祝儀・フィーバー');
    notes.push(`${tileName(feverBetter[0])} を切ると 2 段フィーバーのテンパイが ${feverBetter[1].fever2} 枚 (切った牌は ${fvChosen!.fever2} 枚)`);
  }
  if (keepChip && !tags.includes('祝儀・フィーバー')) {
    tags.push('祝儀・フィーバー');
    notes.push(chosen.dropsNiji ? `虹を崩した (${tileName(keepChip.base)} なら崩さず同じ形)` : `祝儀 ・ フィーバーの種を切った (${tileName(keepChip.base)} でも形は同じ)`);
  }
  // 危険牌は CPU と同じ物差し: リーチを受けて 2 シャンテン以上 (CPU なら降りる) なのに無スジを切り、現物かスジがあった時だけ
  // (10-14 先輩「危険牌切るのはどう評価すればいいんだろうね。今のだと分かりづらい」)
  const safest = rows.reduce((a, b) => ((danger.get(b.base) ?? 99) < (danger.get(a.base) ?? 99) ? b : a), rows[0]);
  const dChosen = danger.get(chosen.base) ?? 0;
  const dSafe = danger.get(safest.base) ?? 0;
  if (foldSpot && dChosen - dSafe >= 5) {
    tags.push('危険牌');
    notes.push(`${minXt} シャンテンでリーチを受けたら CPU は降りる。コンボ理論の放銃率は、切った ${tileName(chosen.base)} ${dChosen}% (${comboBreakdown(game, player, chosen.base, passed.passed)})、${tileName(safest.base)} なら ${dSafe}%`);
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
  const safetyNote = cpu.hasLizhiOpponent
    ? `リーチ者がいる。コンボ理論の放銃率は 切った ${tileName(chosen.base)} ${dChosen}%、CPU の ${tileName(cpu.base)} ${danger.get(cpu.base) ?? 0}%、一番安全な ${tileName(safest.base)} ${dSafe}%`
    : '';
  const rivers: Record<string, string[]> = {};
  for (const p of [0, 1, 2]) rivers[String(p)] = [...((game.he.get(p)?._pai ?? []) as string[])];
  const turn = (game.he.get(player)?._pai ?? []).length + 1;
  discardReviews.push({
    match, hand, revision, seat, user, hand14: String(sp?.toString?.() ?? ''), chosen: chosenRaw,
    xiangting: chosen.xiangting, ukeire: chosen.ukeire, cpu: cpu.pai,
    best: rows.slice(0, 3).map((r) => ({ pai: r.pai, xiangting: r.xiangting, ukeire: r.ukeire, safety: r.safety })),
    tags, note: notes.join(' / '),
    turn, rivers, dora: [...((game.shan?.baopai ?? []) as string[])], lizhi: [...(game.lizhi ?? [])] as number[], cpu_reason: why.join('。'),
    cpu_ukeire: cpu.ukeire, fever, safety_note: safetyNote,
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
  passed = passedTracker();
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
    passed.before(before.game);
    const reason = authority.validateAndApply(command.actorSeat, structuredClone(command.action), members);
    if (reason) {
      diverged.push({ match, revision: command.revision, reason });
      return;
    }
    authority.takeCanonicalChipEffects();
    authority.takePendingCutins();
    const after: any = authority.canonicalState();
    passed.after(after.game);
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
