
// game3.ts から切り出した役判定 pure helpers
import Majiang from '@kobalab/majiang-core';
import { toCorePai } from '../helpers';

/** 間八萬厳密判定:
 *  1. 副露なし [面前]
 *  2. アガリ牌が z5 [白ぽ swap で m8 化、 山には m8 ナシ]
 *  3. 手牌に m7 / m9 が各 1 枚以上
 *  4. m8 swap で m789 順子を含むアガリ形になる解があれば確定 */
export function isKanpaman(shoupai: any, agariPai: string | null): boolean {
  if (!shoupai) return false;
  if (shoupai._fulou && shoupai._fulou.length > 0) return false;
  if (!agariPai || toCorePai(agariPai) !== 'z5') return false;
  if ((shoupai._bingpai.m[7] ?? 0) < 1) return false;
  if ((shoupai._bingpai.m[9] ?? 0) < 1) return false;
  try {
    const spClone = shoupai.clone();
    if ((spClone._bingpai.z[5] ?? 0) >= 1) {
      spClone._bingpai.z[5] -= 1;
      spClone._bingpai.m[8] = (spClone._bingpai.m[8] ?? 0) + 1;
      // [2026-05-21 fix] _zimo は z5b/r/g/y 等 raw colored pochi 可、 toCorePai 比較
      if (spClone._zimo && toCorePai(spClone._zimo) === 'z5') spClone._zimo = 'm8';
      const decompositions = Majiang.Util.hule_mianzi(spClone);
      if (!decompositions || decompositions.length === 0) return false;
      for (const d of decompositions) {
        if (Array.isArray(d) && d.some((m: string) => m === 'm789' || m.startsWith('m789'))) {
          return true;
        }
      }
      return false;
    }
  } catch { /* skip */ }
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
  // 防御的: 想定外 key [g*/z5*/f*] は pai そのまま返す → 呼び側で 後段の処理に害なし
  if (pai.length > 2 || pai[0] === 'g' || pai[0] === 'f') return pai;
  const s = pai[0];
  const n = pai[1] === '0' ? 5 : parseInt(pai[1]);
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
