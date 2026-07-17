
// game3.ts から切り出した tingpai / hule_mianzi 周り pure helpers
import Majiang from '@kobalab/majiang-core';
import { isValidAnmikaTile, toCorePai } from '../helpers';

type Suit = 'm' | 'p' | 's' | 'z';

function tileKinds(): Array<[Suit, number]> {
  const kinds: Array<[Suit, number]> = [];
  for (let n = 1; n <= 9; n++) {
    if (isValidAnmikaTile('m', n)) kinds.push(['m', n]);
    kinds.push(['p', n], ['s', n]);
  }
  for (let n = 1; n <= 7; n++) kinds.push(['z', n]);
  return kinds;
}

function stripMarker(p: string): string {
  const raw = String(p).replace(/[\+\=\-_*]/g, '');
  const core = toCorePai(raw);
  if (core === 'm1') return 'm7';
  if (core[1] === '0') return core[0] + '5';
  return core;
}

/**
 * majiang-core の待ちを、このゲームで実在する牌名へ戻す。
 * 一萬は牌山に存在せず七萬がその役割を担うため、外へ返す待ちは m7 に統一する。
 * m8 は嵌八萬（ぽっちだけで完成する仮想待ち）なので例外的に残す。
 */
function normalizeAnmikaWait(p: string): string | null {
  const raw = String(p).replace(/[\+\=\-_*]/g, '');
  const core = toCorePai(raw);
  if (core.length < 2) return null;
  const suit = core[0] as Suit;
  const digit = core[1] === '0' ? '5' : core[1];
  const normalized = suit === 'm' && digit === '1' ? 'm7' : `${suit}${digit}`;
  if (normalized === 'm8') return normalized;
  const n = Number(normalized[1]);
  return isValidAnmikaTile(suit, n) ? normalized : null;
}

/**
 * 通常解釈と「m7 を m1 とみなす」解釈のうち、実際に聴牌している解だけから待ちを集める。
 * Util.tingpai は非聴牌手では向聴数を下げる牌を返すため、xiangting===0 の guard が必要。
 */
function getStandardAnmikaWaits(shoupai: any): string[] {
  const variants: any[] = [shoupai];
  const m7Count = Number(shoupai?._bingpai?.m?.[7] ?? 0);
  if (m7Count > 0) {
    const swapped = shoupai.clone();
    swapped._bingpai.m[1] = Number(swapped._bingpai.m[1] ?? 0) + m7Count;
    swapped._bingpai.m[7] = 0;
    if (swapped._zimo === 'm7') swapped._zimo = 'm1';
    variants.push(swapped);
  }

  const waits = new Set<string>();
  for (const variant of variants) {
    if (Majiang.Util.xiangting(variant) !== 0) continue;
    for (const raw of (Majiang.Util.tingpai(variant) ?? []) as string[]) {
      const normalized = normalizeAnmikaWait(raw);
      if (normalized) waits.add(normalized);
    }
  }
  return [...waits];
}

function cloneCounts(shoupai: any): Record<Suit, number[]> | null {
  if (!shoupai) return null;
  if ((shoupai._fulou ?? []).length > 0) return null;
  return {
    m: [...(shoupai._bingpai?.m ?? [])],
    p: [...(shoupai._bingpai?.p ?? [])],
    s: [...(shoupai._bingpai?.s ?? [])],
    z: [...(shoupai._bingpai?.z ?? [])],
  };
}

function countTiles(counts: Record<Suit, number[]>): number {
  let total = 0;
  for (const [s, n] of tileKinds()) total += counts[s][n] ?? 0;
  return total;
}

function pairSlots(counts: Record<Suit, number[]>): number {
  let pairs = 0;
  for (const [s, n] of tileKinds()) pairs += Math.floor((counts[s][n] ?? 0) / 2);
  return pairs;
}

function addTile(counts: Record<Suit, number[]>, pai: string, delta: 1 | -1): boolean {
  const base = stripMarker(pai);
  if (base.length < 2) return false;
  const s = base[0] as Suit;
  const n = parseInt(base[1], 10);
  if ((s !== 'm' && s !== 'p' && s !== 's' && s !== 'z') || !Number.isFinite(n) || !isValidAnmikaTile(s, n)) return false;
  const next = (counts[s][n] ?? 0) + delta;
  if (next < 0 || next > 4) return false;
  counts[s][n] = next;
  return true;
}

function americanChitoiCompleteFromCounts(counts: Record<Suit, number[]>): boolean {
  return countTiles(counts) === 14 && pairSlots(counts) >= 7 && countAmericanChitoiQuadsFromCounts(counts) > 0;
}

function countAmericanChitoiQuadsFromCounts(counts: Record<Suit, number[]>): number {
  let quads = 0;
  for (const [s, n] of tileKinds()) if ((counts[s][n] ?? 0) === 4) quads++;
  return quads;
}

function countsForTingpai(shoupai: any): Record<Suit, number[]> | null {
  const counts = cloneCounts(shoupai);
  if (!counts) return null;
  if (countTiles(counts) % 3 === 2 && typeof shoupai._zimo === 'string') {
    addTile(counts, shoupai._zimo, -1);
  }
  return counts;
}

/** 待ち牌一覧 [tingpai 流用、 z5 等含む] */
export function getTingpaiList(shoupai: any): string[] {
  if (!shoupai) return [];
  try {
    const sp_clone = shoupai.clone();
    sp_clone._zimo = null;
    const base = getStandardAnmikaWaits(sp_clone);
    return Array.from(new Set([...base, ...getAmericanChitoiWaits(shoupai)]));
  } catch {
    return getAmericanChitoiWaits(shoupai);
  }
}

/** ツモ前の手牌で待ち牌一覧 [ツモ牌を 1 枚減らして tingpai] */
export function getTingpaiListBeforeZimo(shoupai: any): string[] {
  if (!shoupai) return [];
  try {
    const sp_clone = shoupai.clone();
    if (typeof sp_clone._zimo === 'string' && sp_clone._zimo.length > 3) return [];
    if (typeof sp_clone._zimo === 'string' && sp_clone._zimo.length <= 3) {
      const core = toCorePai(sp_clone._zimo);
      const ss = core[0];
      const nn = parseInt(core[1] === '0' ? '5' : core[1]);
      sp_clone._bingpai[ss][nn] -= 1;
      if (core[1] === '0' && ss !== 'z') sp_clone._bingpai[ss][0] -= 1;
      sp_clone._zimo = null;
    }
    const base = getStandardAnmikaWaits(sp_clone);
    return Array.from(new Set([...base, ...getAmericanChitoiWaits(sp_clone)]));
  } catch {
    return getAmericanChitoiWaits(shoupai);
  }
}

/** アメリカ七対子: 4 枚使いを 2 対子として扱う独自待ち */
export function getAmericanChitoiWaits(shoupai: any): string[] {
  const counts = countsForTingpai(shoupai);
  if (!counts || countTiles(counts) !== 13) return [];
  const waits: string[] = [];
  for (const [s, n] of tileKinds()) {
    if ((counts[s][n] ?? 0) >= 4) continue;
    const c = { m: [...counts.m], p: [...counts.p], s: [...counts.s], z: [...counts.z] };
    c[s][n] = (c[s][n] ?? 0) + 1;
    if (americanChitoiCompleteFromCounts(c)) waits.push(`${s}${n}`);
  }
  return waits;
}

export function americanChitoiXiangting(shoupai: any): number {
  const counts = cloneCounts(shoupai);
  if (!counts) return 99;
  const total = countTiles(counts);
  if (americanChitoiCompleteFromCounts(counts)) return -1;
  if (total === 13 && getAmericanChitoiWaits(shoupai).length > 0) return 0;
  if (total === 14) {
    for (const [s, n] of tileKinds()) {
      if ((counts[s][n] ?? 0) <= 0) continue;
      const c = { m: [...counts.m], p: [...counts.p], s: [...counts.s], z: [...counts.z] };
      c[s][n] -= 1;
      if (countTiles(c) === 13 && pairSlots(c) >= 6) {
        for (const [ws, wn] of tileKinds()) {
          if ((c[ws][wn] ?? 0) >= 4) continue;
          const wc = { m: [...c.m], p: [...c.p], s: [...c.s], z: [...c.z] };
          wc[ws][wn] += 1;
          if (americanChitoiCompleteFromCounts(wc)) return 0;
        }
      }
    }
  }
  return Math.max(1, 6 - pairSlots(counts));
}

export function americanChitoiComplete(shoupai: any, ronpai: string | null = null): boolean {
  const counts = cloneCounts(shoupai);
  if (!counts) return false;
  if (ronpai) addTile(counts, ronpai, 1);
  return americanChitoiCompleteFromCounts(counts);
}

export function countAmericanChitoiQuads(shoupai: any, ronpai: string | null = null): number {
  const counts = cloneCounts(shoupai);
  if (!counts) return 0;
  if (ronpai) addTile(counts, ronpai, 1);
  return countAmericanChitoiQuadsFromCounts(counts);
}

/** ぽっちオールマイティ: 手牌の z5 [白] を任意の牌で置換して和了可能か */
export function canTsumoWithPochiSwap(shoupai: any, fromCore: string = 'z5'): boolean {
  const fromSuit = fromCore[0];
  const fromNum = parseInt(fromCore[1]);
  const candidates: string[] = [];
  for (const s of ['m', 'p', 's', 'z']) {
    const len = s === 'z' ? 8 : 10;
    for (let n = 1; n < len; n++) {
      if (s === 'm' && n !== 7 && n !== 9) continue;
      candidates.push(`${s}${n}`);
    }
  }
  // 嵌八萬だけは山に存在しない m8 をぽっちが代用するため、通常牌 catalog 外でも候補に含める。
  candidates.push('m8');
  for (const swap of candidates) {
    const sp_clone = shoupai.clone();
    try {
      if ((sp_clone._bingpai[fromSuit]?.[fromNum] ?? 0) >= 1) {
        sp_clone._bingpai[fromSuit][fromNum] -= 1;
        const ss = swap[0]; const nn = parseInt(swap[1]);
        if (sp_clone._bingpai[ss][nn] >= 4) continue;
        sp_clone._bingpai[ss][nn] += 1;
        if (sp_clone._zimo && toCorePai(sp_clone._zimo) === fromCore) sp_clone._zimo = swap;
        const r = Majiang.Util.hule_mianzi(sp_clone);
        if (r && r.length > 0) return true;
        if (americanChitoiComplete(sp_clone)) return true;
      }
    } catch { /* skip */ }
  }
  return false;
}
