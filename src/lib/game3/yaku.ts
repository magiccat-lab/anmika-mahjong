
// game3.ts から切り出した役判定 pure helpers
import Majiang from '@kobalab/majiang-core';
import { toCorePai } from '../helpers';

/** 間八萬厳密判定:
 *  1. 副露なし [面前]
 *  2. アガリ牌が z5 [白ぽ swap で m8 化、 山には m8 ナシ]
 *  3. 手牌に m7 / m9 が各 1 枚以上
 *  4. m8 swap で m789 順子を含むアガリ形になる解があれば確定 */
export function isKanpaman(shoupai: any, agariPai: string | null, substituteFrom: string = 'z5'): boolean {
  if (!shoupai) return false;
  if (shoupai._fulou && shoupai._fulou.length > 0) return false;
  const singleTileCore = (pai: string): string => toCorePai(String(pai).replace(/[\+=\-_*]/g, ''));
  const fromCore = singleTileCore(substituteFrom);
  if (!agariPai || singleTileCore(agariPai) !== fromCore) return false;
  if ((shoupai._bingpai.m[7] ?? 0) < 1) return false;
  if ((shoupai._bingpai.m[9] ?? 0) < 1) return false;
  try {
    const spClone = shoupai.clone();
    const agariAlreadyInHand = typeof spClone._zimo === 'string'
      && spClone._zimo.length <= 3
      && singleTileCore(spClone._zimo) === fromCore;
    if (agariAlreadyInHand) {
      // ツモ時は元のぽっち牌が手牌へ加算済みなので、その実牌だけを m8 に置換する。
      const fromSuit = fromCore[0];
      const fromNum = Number(fromCore[1] === '0' ? 5 : fromCore[1]);
      if (!spClone._bingpai[fromSuit] || (spClone._bingpai[fromSuit][fromNum] ?? 0) < 1) return false;
      spClone._bingpai[fromSuit][fromNum] -= 1;
    }
    // ロン時の shoupai は和了牌を含まない13枚。今回の正ぽっちを m8 として1枚加える。
    spClone._bingpai.m[8] = (spClone._bingpai.m[8] ?? 0) + 1;
    spClone._zimo = 'm8';
    const decompositions = Majiang.Util.hule_mianzi(spClone);
    if (!decompositions || decompositions.length === 0) return false;
    for (const d of decompositions) {
      // hule_mianzi は和了牌位置を `m78_!9` のような記号付きで返す。
      if (Array.isArray(d) && d.some((m: string) => m.replace(/[^m\d]/g, '') === 'm789')) {
        return true;
      }
    }
    return false;
  } catch { /* skip */ }
  return false;
}

/** 11-15 の直しより前に記録した対局を読み直す時だけ true にする (server の restore ・ 牌譜再生が、新しい判定で
 *  記録の手が弾かれた時に 1 回だけ使う)。前の判定は p7 ・ p8 ・ p9 ・ s7 ・ s8 ・ s9 の枚数だけを見ていた */
export const kanpaman789Rule = { legacyCountOnly: false };

/** 新しい判定で読み直して記録の手が弾かれたら、前の判定 (枚数だけ) でもう 1 回読む */
export function withLegacyKanpaman789<T>(run: () => T): T {
  try {
    return run();
  } catch (error) {
    if (kanpaman789Rule.legacyCountOnly) throw error;
    kanpaman789Rule.legacyCountOnly = true;
    try {
      return run();
    } catch {
      throw error;
    } finally {
      kanpaman789Rule.legacyCountOnly = false;
    }
  }
}

/** 嵌八萬に付く 789 三色: m789 ・ p789 ・ s789 が 3 つとも順子として取れるアガリ形か。
 *  bp は和了牌込み 14 枚 (副露は除く) の枚数表。ぽっちが m8 に置換されていなければ z5 を 1 枚 m8 として読む。
 *  [11-15 リョー「この牌譜だと789三色おかしくね？9p9pだし」2L8R 13 戦目: m79+ぽっち p67899 s666789 は
 *  p678 + p99 の頭にしか割れず p789 が無いのに、p7 ・ p8 ・ p9 が 1 枚ずつあるだけで付いていた] */
export function hasKanpaman789(bp: { m?: number[]; p?: number[]; s?: number[]; z?: number[] }): boolean {
  const c: Record<'m' | 'p' | 's' | 'z', number[]> = {
    m: Array.from({ length: 10 }, (_, i) => (i === 0 ? 0 : bp.m?.[i] ?? 0)),
    p: Array.from({ length: 10 }, (_, i) => (i === 0 ? 0 : bp.p?.[i] ?? 0)),
    s: Array.from({ length: 10 }, (_, i) => (i === 0 ? 0 : bp.s?.[i] ?? 0)),
    z: Array.from({ length: 8 }, (_, i) => (i === 0 ? 0 : bp.z?.[i] ?? 0)),
  };
  if (c.m[8] < 1 && c.z[5] > 0) { c.z[5] -= 1; c.m[8] += 1; }
  for (const s of ['m', 'p', 's'] as const) {
    for (const n of [7, 8, 9]) {
      if (c[s][n] < 1) return false;
      c[s][n] -= 1;
    }
  }
  const total = (['m', 'p', 's', 'z'] as const).reduce((sum, s) => sum + c[s].reduce((a, b) => a + b, 0), 0);
  if (total % 3 !== 2) return false;
  // 残りが 面子 N 個 + 頭 1 つに割れるか
  const mentsuOnly = (): boolean => {
    for (const s of ['m', 'p', 's', 'z'] as const) {
      const arr = c[s];
      for (let n = 1; n < arr.length; n += 1) {
        if (arr[n] === 0) continue;
        if (arr[n] >= 3) {
          arr[n] -= 3;
          const ok = mentsuOnly();
          arr[n] += 3;
          if (ok) return true;
        }
        if (s !== 'z' && n <= 7 && arr[n + 1] > 0 && arr[n + 2] > 0) {
          arr[n] -= 1; arr[n + 1] -= 1; arr[n + 2] -= 1;
          const ok = mentsuOnly();
          arr[n] += 1; arr[n + 1] += 1; arr[n + 2] += 1;
          if (ok) return true;
        }
        return false;
      }
    }
    return true;
  };
  for (const s of ['m', 'p', 's', 'z'] as const) {
    for (let n = 1; n < c[s].length; n += 1) {
      if (c[s][n] < 2) continue;
      c[s][n] -= 2;
      const ok = mentsuOnly();
      c[s][n] += 2;
      if (ok) return true;
    }
  }
  return false;
}

/** 「あるドラ target が成立する indicator」 を逆引きする helper
 *  神ぽっち [game3.ts:933] で baopai 内 z5 をこの indicator で 仮想 swap するため
 *  [入力] target = 「ドラ にしたい牌」
 *  [出力] indicator = 「その target がドラになる indicator [前の牌]」
 *  例: target=z1 [東] → indicator=z4 [北] [z4 indicator が z1 ドラを差す]
 *  アンミカ独自: m7/m9 は swap、 字牌は 1-4 / 5-7 で循環
 *  target に来るのは 通常牌 [m/p/s/z] のみ [mostCommonPaiInHand の出力] */
export function doraIndicatorOf(pai: string): string {
  // expanded tile も同じ物理数牌・字牌のドラ対象として逆算する。
  // 華牌はドラ対象を持たないため、そのまま返して呼び側の華処理へ渡す。
  if (pai[0] === 'f') return pai;
  const core = toCorePai(pai);
  if (!/^[mpsz][0-9]$/.test(core)) return pai;
  const s = core[0];
  const n = core[1] === '0' ? 5 : parseInt(core[1]);
  if (!Number.isFinite(n)) return pai;
  if (s === 'z') {
    if (n <= 4) return `z${((n - 2 + 4) % 4) + 1}`;
    return `z${((n - 6 + 3) % 3) + 5}`;
  }
  if (s === 'm') {
    if (n === 7) return 'm9';
    if (n === 9) return 'm7';
  }
  return `${s}${((n - 2 + 9) % 9) + 1}`;
}
