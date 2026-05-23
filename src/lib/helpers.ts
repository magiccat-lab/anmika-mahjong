
// アンミカ三麻 共通ヘルパ [normalize / debug log / 牌種判定]

// @ts-ignore - majiang-core 型定義なし
import Majiang from '@kobalab/majiang-core';

/** debug log 一元化
 *  - default は ON [常に console.log + DebugLogPanel に出る]
 *  - `window.__ANMIKA_DEBUG__=false` を明示 set した時のみ OFF [production 用 mute]
 *  - R19 #8 fix: online 対戦中 [window.__anmikaOnline=true] は強制 OFF、
 *    他家の getTingpaiList / ロン候補等の隠し情報が console から漏れる公平性問題防止
 *  - Playwright [navigator.webdriver=true] は test 用に強制 ON 維持 */
export function isDebugEnabled(): boolean {
  if (typeof window === 'undefined') return true;
  const w = window as any;
  const isPlaywright = typeof navigator !== 'undefined' && (navigator as any).webdriver === true;
  if (isPlaywright) return w.__ANMIKA_DEBUG__ !== false;
  // online 中 + 非 Playwright は強制 OFF [対戦相手の手牌覗き防止]
  if (w.__anmikaOnline === true) return false;
  return w.__ANMIKA_DEBUG__ !== false;
}
/** 後方互換: 旧 const DEBUG_LOG 参照は初期値、 dlog は動的に判定 */
export const DEBUG_LOG: boolean = isDebugEnabled();
export function dlog(...args: any[]): void { if (isDebugEnabled()) console.log(...args); }

/** アンミカ独自: 萬子は m7 [=m1 扱い] と m9 の 2 種のみ存在、 m2-m6/m8 は牌として無い
 *  [ルール: m7 を m1 として扱い、 国士13面 / 順子 / 倍率計算 全 path で この前提を共有]
 *  iter / swap / 候補生成で manzu を扱う時は必ずこの helper で gate する [P0-5 予防 2026-05-11] */
export const ANMIKA_VALID_MANZU = [7, 9] as const;
export function isValidAnmikaTile(s: string, n: number): boolean {
  if (s === 'm') return n === 7 || n === 9;
  return true; // p/s/z は通常通り [n の正当性は別 path で]
}

import type { PochiPai } from './types';

/** z5 4 色 / 金牌 [gp/gs/gN] を majiang-core 用に変換
 *  - z5b/r/g/y → z5
 *  - gp → p0 [金は赤の一種として majiang-core 渡し]
 *  - gs → s0
 *  - gN → z4
 */
export function toCorePai(p: string): string {
  if (typeof p === 'string' && p.length > 2 && p[0] === 'z' && p[1] === '5') return 'z5';
  if (p === 'gp') return 'p0';
  if (p === 'gs') return 's0';
  if (p === 'gN') return 'z4';
  return p;
}

/** @deprecated majiang-core 入力境界では toCorePai を使う。旧 import 互換だけ残す。 */
export const normalizePai = toCorePai;

/** 金牌 key 判定 */
export function isGoldPai(p: string): boolean { return p === 'gp' || p === 'gs' || p === 'gN'; }
export function isPochiPai(p: string): p is PochiPai { return p === 'z5b' || p === 'z5r' || p === 'z5g' || p === 'z5y'; }

export const ANMIKA_EXPANDED_PAI = ['z5b', 'z5r', 'z5g', 'z5y', 'gp', 'gs', 'gN'] as const;
export type AnmikaExpandedPai = typeof ANMIKA_EXPANDED_PAI[number];

export function isAnmikaExpandedPai(p: string): p is AnmikaExpandedPai {
  return (ANMIKA_EXPANDED_PAI as readonly string[]).includes(p);
}

export type AnmikaCounts = Record<AnmikaExpandedPai, number>;

export function emptyAnmikaCounts(): AnmikaCounts {
  return { z5b: 0, z5r: 0, z5g: 0, z5y: 0, gp: 0, gs: 0, gN: 0 };
}

function ensureAnmikaCounts(sp: any): AnmikaCounts {
  const bp = sp?._bingpai;
  if (!bp) return emptyAnmikaCounts();
  if (!bp.__anmika) bp.__anmika = emptyAnmikaCounts();
  for (const k of ANMIKA_EXPANDED_PAI) {
    if (typeof bp.__anmika[k] !== 'number') bp.__anmika[k] = 0;
    bp[k] = bp.__anmika[k];
  }
  return bp.__anmika;
}

export function syncAnmikaBingpai(sp: any): void {
  if (!sp?._bingpai?.__anmika) return;
  ensureAnmikaCounts(sp);
}

export function getAnmikaCount(sp: any, pai: AnmikaExpandedPai): number {
  return ensureAnmikaCounts(sp)[pai] ?? 0;
}

export function addAnmikaPai(sp: any, pai: string, delta: number): void {
  if (!isAnmikaExpandedPai(pai) || !sp?._bingpai) return;
  const counts = ensureAnmikaCounts(sp);
  counts[pai] = Math.max(0, (counts[pai] ?? 0) + delta);
  sp._bingpai[pai] = counts[pai];
}

export function countPochiInHand(sp: any): { blue: number; red: number; green: number; yellow: number } {
  const counts = ensureAnmikaCounts(sp);
  return { blue: counts.z5b, red: counts.z5r, green: counts.z5g, yellow: counts.z5y };
}

export function countGoldInHand(sp: any): { p: number; s: number; z: number } {
  const counts = ensureAnmikaCounts(sp);
  return { p: counts.gp, s: counts.gs, z: counts.gN };
}

export function countColoredZ5(sp: any): number {
  const counts = ensureAnmikaCounts(sp);
  return counts.z5b + counts.z5r + counts.z5g + counts.z5y;
}

export function patchAnmikaShoupai(sp: any, tiles: string[] = []): any {
  if (!sp || sp.__anmikaPatched) return sp;
  ensureAnmikaCounts(sp);
  for (const p of tiles) addAnmikaPai(sp, p, 1);
  const origZimo = sp.zimo.bind(sp);
  const origDapai = sp.dapai.bind(sp);
  const origClone = sp.clone.bind(sp);
  sp.zimo = (p: string, check = true) => {
    const raw = p?.replace(/_$/, '') ?? p;
    const ret = origZimo(toCorePai(p), check);
    addAnmikaPai(sp, raw, 1);
    if (isAnmikaExpandedPai(raw)) sp._anmikaZimo = raw;
    return ret;
  };
  sp.dapai = (p: string, check = true) => {
    const suffix = p.endsWith('_') ? '_' : '';
    const raw = p.replace(/_$/, '');
    const ret = origDapai(toCorePai(raw) + suffix, check);
    addAnmikaPai(sp, raw, -1);
    sp._anmikaZimo = null;
    return ret;
  };
  // [2026-05-21 fix] fulou wrap: 副露時 hand から consume される牌の anmika 拡張 count
  // (z5b/r/g/y) を decrement。
  // 旧: fulou は core _bingpai.z[5] のみ decrement、 anmika 拡張 count 据置 →
  //   「白ポンしても手牌に colored z5 が残る」 display bug (リョー報告 2026-05-21)
  // mianzi format (majiang-core):
  //   pon:     '<suit><digit><digit><digit><dir>'    例 'z555-'
  //   ankan:   '<suit><digit><digit><digit><digit>'  例 'z5555'
  //   minkan:  '<suit><digit><digit><digit><digit><dir>'
  const origFulou = sp.fulou?.bind(sp);
  if (origFulou) {
    sp.fulou = (mianzi: string, check = true) => {
      const ret = origFulou(mianzi, check);
      try {
        const suit = mianzi[0];
        if (suit !== 'z') return ret; // ぽっち対象は z5 のみ
        const digits = mianzi.replace(/[+=\-]/g, '').slice(1); // 'z555-' → '555'
        const z5Count = (digits.match(/5/g) || []).length;
        if (z5Count === 0) return ret;
        const hasDir = /[+=\-]/.test(mianzi);
        const takenCount = hasDir ? 1 : 0;
        const handConsume = Math.max(0, z5Count - takenCount);
        const counts = ensureAnmikaCounts(sp);
        let toConsume = handConsume;
        for (const cKey of ['z5b', 'z5r', 'z5g', 'z5y'] as const) {
          while (toConsume > 0 && (counts[cKey] ?? 0) > 0) {
            addAnmikaPai(sp, cKey, -1);
            toConsume -= 1;
          }
          if (toConsume === 0) break;
        }
      } catch {
        // anmika consume 失敗しても core fulou は成功してるので silent skip
      }
      return ret;
    };
  }
  sp.clone = () => {
    const cloned = patchAnmikaShoupai(origClone());
    cloned._bingpai.__anmika = { ...ensureAnmikaCounts(sp) };
    cloned._anmikaZimo = sp._anmikaZimo ?? null;
    syncAnmikaBingpai(cloned);
    return cloned;
  };
  sp.__anmikaPatched = true;
  return sp;
}

/** Shoupai 構築 [core 境界だけ toCorePai、独立牌 count は _bingpai.__anmika に保持] */
export function buildShoupai(tiles: string[]): any {
  const normalized = tiles.map(toCorePai);
  return patchAnmikaShoupai(new Majiang.Shoupai(normalized), tiles);
}

/** アンミカ独自ドラ計算用 baopai 正規化:
 *  - m7 表示牌 → ドラ m9 [majiang-core 期待は m8 → m9] → m8 を擬似で渡す
 *  - m9 表示牌 → ドラ m7 → m6 を擬似で渡す
 *  - 他は normalizePai 通り */
export function normalizeBaopaiForMajiang(p: string): string {
  const np = toCorePai(p);
  if (np === 'm7') return 'm8';
  if (np === 'm9') return 'm6';
  return np;
}

/** z5 色付き key → ぽっち色取得、 通常牌は null */
export function pochiColorFromPai(p: string): 'blue' | 'red' | 'green' | 'yellow' | null {
  return ({ z5b: 'blue', z5r: 'red', z5g: 'green', z5y: 'yellow' } as any)[p] ?? null;
}

/** 正ぽっち [緑/青] 判定 */
export function isPositiveZ5(p: string): boolean { return p === 'z5g' || p === 'z5b'; }
/** 逆ぽっち [赤/黄] 判定 */
export function isNegativeZ5(p: string): boolean { return p === 'z5r' || p === 'z5y'; }

/** ハン数→打点段階 [Lv]、 LEVEL_TO_FANSHU と対応
 *  Lv4=4-5 翻 [マンガン]、 Lv5=6-7 翻 [ハネ]、 Lv6=8-10 [倍]、 Lv7=11-12 [三倍]、 Lv8=13+ [役満]、 Lv9=18+ [五倍]、 Lv10=24+ [六倍]
 */
export function fanshuLevel(fanshu: number, fu: number): number {
  if (fanshu >= 24) return 10;
  if (fanshu >= 18) return 9;
  if (fanshu >= 13) return 8;
  if (fanshu >= 11) return 7;
  if (fanshu >= 8) return 6;
  if (fanshu >= 6) return 5;
  if (fanshu >= 4) return 4;
  if (fanshu >= 1 && fu * Math.pow(2, fanshu + 2) === 1920) return 4; // 切上満貫
  if (fanshu === 3) return 3;
  if (fanshu === 2) return 2;
  if (fanshu === 1) return 1;
  return 0;
}
export const LEVEL_TO_FANSHU = [0, 1, 2, 3, 4, 6, 8, 11, 13, 18, 24];
