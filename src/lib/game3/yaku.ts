
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
