// コンボ理論で見積もる放銃率 [2026-10-14 リョー「コンボ理論採用して解析してほしい」]
// 木村尚嵩『麻雀コンボ理論 放銃率の見積もりと押し引き戦術』(竹書房 2026-07) の考え方: リーチ者の待ちを
// 「両面 ・ 嵌張 ・ 辺張 ・ 双碰 ・ 単騎」の形 (コンボ) に分け、見えていない枚数から形ごとの組み合わせの数を数える。
// ある牌の放銃率 = その牌を待ちに含む形の組み合わせの数 ÷ ありうる形の組み合わせの数の合計。
// 本の細かい重みは読めていないので、ここでは 単騎だけ 0.5 倍、ほかは 1 倍 (仮置き)。
// フリテン: リーチ者の河にある牌を待ちに含む形は数えない (スジ ・ 現物の効き目はここから出る)。
// アンミカの萬子は 7 ・ 9 だけで順子にならないので、字牌と同じく双碰と単騎だけ。
import { toCorePai } from '../../src/lib/helpers';

const baseOf = (p: string) => {
  const core = toCorePai(String(p).replace(/[+=\-_*]/g, ''));
  return core.length < 2 ? core : core[0] + (core[1] === '0' ? '5' : core[1]);
};

export const TANKI_WEIGHT = 0.5;

/** 打つ人 (player) から見て、手 ・ 全員の河 ・ 鳴き ・ ドラ表示に見えていない枚数 */
export function unseenCounter(game: any, player: number): (t: string) => number {
  const seen: Record<string, number> = {};
  const add = (p: string) => { const b = baseOf(p); if (b) seen[b] = (seen[b] ?? 0) + 1; };
  const sp = game.shoupai.get(player);
  for (const s of ['m', 'p', 's', 'z']) for (let n = 1; n <= 9; n++) {
    const c = Number(sp?._bingpai?.[s]?.[n] ?? 0);
    if (c) seen[s + n] = (seen[s + n] ?? 0) + c;
  }
  for (const p of [0, 1, 2]) {
    for (const d of (game.he.get(p)?._pai ?? []) as string[]) add(d);
    for (const m of (game.shoupai.get(p)?._fulou ?? []) as string[]) { const s = m[0]; for (const ch of m.replace(/[^0-9]/g, '')) add(s + ch); }
  }
  for (const x of (game.shan?.baopai ?? []) as string[]) add(x);
  return (t: string) => Math.max(0, 4 - (seen[t] ?? 0));
}

type Shape = { waits: string[]; combos: number; kind: '両面' | '辺張' | '嵌張' | '双碰' | '単騎' };

/** リーチ者 1 人の待ちの形と組み合わせの数 (フリテンの形は除く) */
export function waitShapes(river: Set<string>, unseen: (t: string) => number): Shape[] {
  const out: Shape[] = [];
  const ok = (waits: string[]) => waits.every((w) => !river.has(w));
  for (const s of ['p', 's']) {
    const u = (n: number) => unseen(`${s}${n}`);
    for (let a = 1; a <= 8; a++) {
      const combos = u(a) * u(a + 1);
      if (!combos) continue;
      if (a === 1) { const w = [`${s}3`]; if (ok(w)) out.push({ waits: w, combos, kind: '辺張' }); }
      else if (a === 8) { const w = [`${s}7`]; if (ok(w)) out.push({ waits: w, combos, kind: '辺張' }); }
      else { const w = [`${s}${a - 1}`, `${s}${a + 2}`]; if (ok(w)) out.push({ waits: w, combos, kind: '両面' }); }
    }
    for (let a = 1; a <= 7; a++) {
      const combos = u(a) * u(a + 2);
      const w = [`${s}${a + 1}`];
      if (combos && ok(w)) out.push({ waits: w, combos, kind: '嵌張' });
    }
  }
  const all: string[] = [];
  for (const s of ['p', 's']) for (let n = 1; n <= 9; n++) all.push(`${s}${n}`);
  all.push('m7', 'm9');
  for (let n = 1; n <= 7; n++) all.push(`z${n}`);
  for (const t of all) {
    if (river.has(t)) continue;
    const k = unseen(t);
    if (k >= 2) out.push({ waits: [t], combos: (k * (k - 1)) / 2, kind: '双碰' });
    if (k >= 1) out.push({ waits: [t], combos: k * TANKI_WEIGHT, kind: '単騎' });
  }
  return out;
}

/** 牌 (base) ごとの放銃率 (%)。リーチ者が複数なら 1 − Π(1 − p)。リーチ者がいなければ空 */
export function comboDanger(game: any, player: number): Map<string, number> {
  const opps = [...(game.lizhi ?? [])].filter((p: number) => p !== player) as number[];
  const result = new Map<string, number>();
  if (!opps.length) return result;
  const unseen = unseenCounter(game, player);
  const safe = new Map<string, number>();
  for (const lp of opps) {
    const river = new Set(((game.he.get(lp)?._pai ?? []) as string[]).map(baseOf));
    const shapes = waitShapes(river, unseen);
    const total = shapes.reduce((a, s) => a + s.combos, 0);
    const hit = new Map<string, number>();
    for (const sh of shapes) for (const w of sh.waits) hit.set(w, (hit.get(w) ?? 0) + sh.combos);
    const tiles = new Set([...hit.keys(), ...river]);
    for (const t of tiles) {
      const p = total > 0 ? (hit.get(t) ?? 0) / total : 0;
      safe.set(t, (safe.get(t) ?? 1) * (1 - p));
    }
  }
  for (const [t, s] of safe) result.set(t, Math.round((1 - s) * 1000) / 10);
  return result;
}

/** 牌ごとの放銃率の内訳 (形ごとの組み合わせの数)。説明の 1 行に使う */
export function comboBreakdown(game: any, player: number, base: string): string {
  const opps = [...(game.lizhi ?? [])].filter((p: number) => p !== player) as number[];
  if (!opps.length) return '';
  const unseen = unseenCounter(game, player);
  const parts: string[] = [];
  for (const lp of opps) {
    const river = new Set(((game.he.get(lp)?._pai ?? []) as string[]).map(baseOf));
    if (river.has(base)) { parts.push('現物'); continue; }
    const byKind: Record<string, number> = {};
    for (const sh of waitShapes(river, unseen)) if (sh.waits.includes(base)) byKind[sh.kind] = (byKind[sh.kind] ?? 0) + sh.combos;
    const s = Object.entries(byKind).filter(([, v]) => v > 0).map(([k, v]) => `${k} ${Math.round(v * 10) / 10}`).join(' ・ ');
    parts.push(s || '当たる形なし');
  }
  return parts.join(' / ');
}
