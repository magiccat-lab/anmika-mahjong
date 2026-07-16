
// game3.ts から切り出した pure helpers [フィーバーリーチ判定 + 待ち枯渇判定]
// game state を引数で受け取り、 this 依存を排した関数群

// @ts-ignore - majiang-core 型定義なし
import Majiang from '@kobalab/majiang-core';
import { toCorePai } from '../helpers';

export type FeverCheck = { ok: boolean; tiles: string[]; tier: 1 | 2 | 3; rainbow?: boolean };

function countTileInMianzi(mianzi: string, target: string): number {
  if (!mianzi || !target) return 0;
  const targetCore = toCorePai(target).replace('0', '5');
  const stripped = String(mianzi).replace(/[\+=\-_*]/g, '');
  const suit = stripped[0];
  if (suit !== targetCore[0]) return 0;
  let count = 0;
  for (const d of stripped.slice(1).replace(/0/g, '5')) {
    if (`${suit}${d}` === targetCore) count++;
  }
  return count;
}

/** 厳密判定: 手牌 7×3 が 全テンパイ解 で 必ず 暗刻として使われる か
 *  待ち牌 each に対して hule_mianzi で 14 牌 和了形 全解 を取得、
 *  全解で `${s}777` 暗刻 が存在する場合のみ true。
 *  shoupai が clone() を持たない / tingpai 取れない / hule_mianzi 解 0 件の場合は null
 *  [呼び元 fallback、 lenient check に委ねる] */
function isAlwaysAnkanByHule(shoupai: any, s: string): boolean | null {
  if (!shoupai || typeof shoupai.clone !== 'function') return null;
  let waits: string[] = [];
  try {
    const sp_for_ting = shoupai.clone();
    // tingpai は _zimo を消して 13 牌で呼ぶ [ツモ前テンパイ check]
    // _zimo が ある [14 牌] 場合は 1 牌減らして tingpai 取得
    if (sp_for_ting._zimo && sp_for_ting._zimo.length <= 3) {
      const core = toCorePai(sp_for_ting._zimo);
      const ss = core[0];
      const nn = parseInt(core[1] === '0' ? '5' : core[1]);
      sp_for_ting._bingpai[ss][nn] -= 1;
      if (core[1] === '0' && ss !== 'z') sp_for_ting._bingpai[ss][0] -= 1;
      sp_for_ting._zimo = null;
    }
    waits = Majiang.Util.tingpai(sp_for_ting) ?? [];
  } catch {
    return null;
  }
  if (waits.length === 0) return null;

  const kotsu = `${s}777`;

  let totalSolutions = 0;
  for (const t of waits) {
    let solutions: string[][] = [];
    try {
      const sp_clone = shoupai.clone();
      // 既に _zimo がある場合は同じ tile で hule_mianzi が打てるよう調整
      // hule_mianzi(shoupai, rongpai) 内部で clone+zimo されるので そのまま渡せる
      // ただし現 shoupai が 14 牌 [_zimo あり] だと再 zimo で 15 牌になる、
      // よって 13 牌に戻してから rongpai 引数で渡す
      if (sp_clone._zimo && sp_clone._zimo.length <= 3) {
        const core = toCorePai(sp_clone._zimo);
        const ss = core[0];
        const nn = parseInt(core[1] === '0' ? '5' : core[1]);
        sp_clone._bingpai[ss][nn] -= 1;
        if (core[1] === '0' && ss !== 'z') sp_clone._bingpai[ss][0] -= 1;
        sp_clone._zimo = null;
      }
      solutions = Majiang.Util.hule_mianzi(sp_clone, t + '_') ?? [];
    } catch {
      continue;
    }
    if (solutions.length === 0) continue;
    totalSolutions += solutions.length;
    for (const decomp of solutions) {
      // 各 mianzi 文字列、 末尾 suffix [_+=-! / 数字 4 つ目] を考慮し、
      // 「s777 暗刻」 = `${s}` で始まり 続く 3 文字が '777'、 4 文字目 [あれば] が 数字以外
      // [s7777 ankan は除く、 suffix _ や ! や +/=/- は OK]
      let hasS777Kotsu = false;
      for (const m of decomp) {
        if (typeof m !== 'string' || m.length < 4) continue;
        if (m[0] !== s) continue;
        if (m[1] !== '7' || m[2] !== '7' || m[3] !== '7') continue;
        // 4 文字目までで `s777`、 5 文字目以降は数字でないこと [`s7777` ankan は弾く]
        if (m.length >= 5 && /\d/.test(m[4])) continue;
        hasS777Kotsu = true;
        break;
      }
      if (!hasS777Kotsu) {
        // この解 で 7 が 暗刻として使われていない → 厳密 reject
        return false;
      }
    }
  }
  if (totalSolutions === 0) return null;
  return true;
}

/** フィーバーリーチ可否判定
 *  m7/p7/s7 の暗刻数で tier 判定 [1 種:single / 2 種:double / 3 種:triple]
 *  副露ありは不可 [ankan 除く]。 リョー指示: 任意組合せで 2 種=ダブル、 3 種=トリプル
 *  2026-05-15 厳密化 [v2]: 同 suit に 5/6/赤0 がある場合 567 順子余地で reject していた
 *  簡易 fix を撤廃、 majiang-core hule_mianzi で 全テンパイ和了解 を列挙し
 *  全解で 7 が 暗刻として使われる場合のみ OK。 majiang-core 取得失敗時は
 *  lenient fallback [5/6/0 不在のみ OK] に落ちる。 */
export function canFeverLizhi(shoupai: any): FeverCheck {
  if (!shoupai) return { ok: false, tiles: [], tier: 1 };
  const fulous = (shoupai._fulou ?? []) as string[];
  const nonAnkanFulou = fulous.some((m: string) => /[\+=\-]/.test(m));
  if (nonAnkanFulou) return { ok: false, tiles: [], tier: 1 };
  const tiles: string[] = [];
  for (const s of ['m', 'p', 's']) {
    const handCount = shoupai._bingpai?.[s]?.[7] ?? 0;
    let ankanCount = 0;
    for (const m of fulous) {
      const stripped = (m as string).replace(/[\+=\-_*]/g, '');
      // R20 #3: majiang-core 暗槓 format は `s7777` [suite + digit×4]
      if (stripped === `${s}7777` || stripped === `${s}7${s}7${s}7${s}7`) {
        ankanCount += 4;
      }
    }
    let ok = false;
    if (ankanCount >= 3) {
      // ankan あれば 確定暗刻 [4 枚 ankan のみで成立]
      ok = true;
    } else if (handCount + ankanCount >= 4) {
      // 2026-05-15 [bug B] fix: 同種 7 が 計 4 枚あれば 順子 1 枚消費しても残 3 枚は
      // 必ず 刻子 [雀頭は別 suit/字牌 ふくむ全体構成、 567 余地あっても 4 枚目は浮く=
      // 暗刻として使われる解が必ず存在]。 majiang-core 厳密判定は 「全解で暗刻」 を要求し、
      // 「s7×4 + 567 余地 → 1 解で順子使用」 を理由に false 返してしまうので 早期 ok=true。
      // ツモ牌 [s4 等] が 7 と無関係でも 関係なく 4 枚保持で確定。
      ok = true;
    } else if (handCount + ankanCount >= 3) {
      // handCount >= 3 必須。 majiang-core 厳密判定を試行
      const strict = isAlwaysAnkanByHule(shoupai, s);
      if (strict === true) {
        ok = true;
      } else if (strict === null) {
        // fallback: 5/6/0 不在なら OK [簡易判定、 mock test や ting 取れない state 用]
        const has5or6InHand =
          (shoupai._bingpai?.[s]?.[5] ?? 0) > 0 ||
          (shoupai._bingpai?.[s]?.[6] ?? 0) > 0 ||
          (shoupai._bingpai?.[s]?.[0] ?? 0) > 0;
        if (!has5or6InHand) ok = true;
      }
      // strict === false なら ok=false 維持 [厳密 reject]
    }
    if (ok) tiles.push(s + '7');
  }
  // レインボーフィーバー: 虹3p + 虹3s + 虹西 が全て手牌にあればフィーバー成立
  const anmikaCounts = shoupai._bingpai?.__anmika;
  const hasAllNiji = anmikaCounts
    && (anmikaCounts.np3 ?? 0) >= 1
    && (anmikaCounts.ns3 ?? 0) >= 1
    && (anmikaCounts.nz3 ?? 0) >= 1;
  if (tiles.length === 0 && !hasAllNiji) return { ok: false, tiles: [], tier: 1 };
  // 7暗刻の数 + 虹による tier 計算
  let tierCount = tiles.length;
  const rainbow = !!hasAllNiji;
  if (rainbow) tierCount += 1;
  const tier: 1 | 2 | 3 = tierCount >= 3 ? 3 : tierCount >= 2 ? 2 : 1;
  return { ok: true, tiles, tier, rainbow };
}

/** [2026-05-15 bug 8] 打牌候補ごとに fever 可否を返す API。
 *  「ツモ牌 + 手牌 14 枚」 から 各 dapai 候補を消費した 13 枚で canFeverLizhi 評価。
 *  user スクショ仕様: 9s 切り時のみ fever 成立 [他 dapai では fever NG] のような
 *  「特定打牌でしか 暗刻条件 満たさない」 case を 候補ごとに 弁別する。
 *
 *  返値: Map<dapai_pai, FeverCheck> [ok=true な candidate のみ含む形]
 *  store gate 側で 「fever 可な dapai のみ fever 宣言可能」 に絞れる。
 */
export function feverCandidatesByDapai(
  shoupai: any
): Map<string, FeverCheck> {
  const result = new Map<string, FeverCheck>();
  if (!shoupai) return result;
  let candidates: string[] = [];
  try {
    candidates = shoupai.get_dapai?.(false) ?? [];
  } catch {
    return result;
  }
  for (const c of candidates) {
    try {
      const sp_after = shoupai.clone();
      sp_after.dapai(c);
      const fc = canFeverLizhi(sp_after);
      if (fc.ok) result.set(c.replace(/_$/, ''), fc);
    } catch {
      continue;
    }
  }
  return result;
}

/** フィーバー成立後の待ち枯渇判定
 *  全待ち牌の山残合計が 0 なら true [1 人テンパイ流局] */
export function isFeverWaitExhausted(
  ting: string[],
  shoupaiAll: Map<number, any>,
  heAll: Map<number, any>,
  baopai: string[]
): boolean {
  if (ting.length === 0) return true;
  const baseTile = (p: string) => p[0] + (p[1] === '0' ? '5' : p[1]);
  let totalRemain = 0;
  for (const t of ting) {
    if (toCorePai(t) === 'z5') {
      // R19 #6 + R20 #4 fix: z5 visible に 副露中の白 [_fulou 内 z5 含む] と
      // ドラ表示 z5b/r/g/y も z5 として count、 旧 code は副露白 / 色別 baopai 漏れで 過大残
      let z5Visible = 0;
      for (const [, sp] of shoupaiAll) {
        if (!sp) continue;
        z5Visible += sp._bingpai?.z?.[5] ?? 0;
        // R20 #4 fix: _fulou 内 z5 も visible
        for (const m of sp._fulou ?? []) {
          z5Visible += countTileInMianzi(m as string, 'z5');
        }
      }
      for (const [, he] of heAll) {
        if (!he?._pai) continue;
        for (const d of he._pai as string[]) {
          const stripped = d.replace(/[\+=\-_*]/g, '');
          // [2026-05-21 fix] commit 4d1f476f で 河 _pai に z5b/r/g/y raw 牌が入る、
          // 旧 code は plain 'z5' のみ count、 色付き白が river 透過で 待ち枯渇判定がガバる。
          if (toCorePai(stripped) === 'z5') z5Visible++;
        }
      }
      // R20 #4 fix: ドラ表示 z5b/r/g/y も z5 として count
      for (const b of baopai ?? []) {
        if (toCorePai(b) === 'z5') z5Visible++;
      }
      totalRemain += Math.max(0, 4 - z5Visible);
      continue;
    }
    const tNorm = baseTile(t);
    const ss = tNorm[0]; const nn = parseInt(tNorm[1]);
    let visible = 0;
    for (const [, sp] of shoupaiAll) {
      if (!sp) continue;
      visible += sp._bingpai?.[ss]?.[nn] ?? 0;
      // _bingpai[s][5] は通常・赤・金を合算した core 5 の現物数。
      // _bingpai[s][0] / goldHand を重ねると手牌内だけ二重計上になる。
      for (const m of sp._fulou ?? []) {
        visible += countTileInMianzi(m as string, ss + nn);
      }
    }
    for (const [, he] of heAll) {
      if (!he?._pai) continue;
      for (const d of he._pai as string[]) {
        const stripped = d.replace(/[\+=\-_*]/g, '');
        if (stripped === ss + nn) visible++;
        // R20 #4 fix: 5 待ち で 赤 / 金 5 が河に出てる場合も count
        if (nn === 5 && (ss === 'p' || ss === 's')) {
          if (stripped === `${ss}0` || stripped === `g${ss}`) visible++;
        }
      }
    }
    for (const b of baopai ?? []) {
      if (b === ss + nn) visible++;
      if (nn === 5 && (ss === 'p' || ss === 's')) {
        if (b === `${ss}0` || b === `g${ss}`) visible++;
      }
    }
    totalRemain += Math.max(0, 4 - visible);
  }
  return totalRemain === 0;
}
