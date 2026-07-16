
// game3.ts から切り出した chip orchestration helpers
// applyFuyuChip [冬 アリス / チューリップ / 上下段] + applyChipsOnHule [和了時 chip 全集計]
//
// context 化方針: Game3 class が握ってる多面 field を `HuleChipCtx` interface 経由で渡す。
// chip 加算は既に game3/chip.ts に切り出し済 [computeChipMultiplier 等] なので、
// ここでは ctx.applyChipOall / applyChipFromLoser / applyFuyuChip メソッドを通して使う。
//
// 関数自体は this 依存ナシの pure 形、 class 側は wrap method で互換維持。

import { dlog, isNijiPai, toCorePai } from '../helpers';
import type { PlayerId } from './chip';
import { hasGoldKita as hasGoldKitaTile, type GoldHand } from './gold';
import type { PochiHand } from './pochi';
import { claimTileIdentity } from './claimTile';

export interface HuleChipCtx {
  shoupai: Map<PlayerId, any>;
  he: Map<PlayerId, any>;
  goldHand: Record<PlayerId, GoldHand>;
  pochiHand: Record<PlayerId, PochiHand>;
  huapai: Record<PlayerId, string[]>;
  nukidora: Record<PlayerId, number>;
  nukidoraGold?: Record<PlayerId, number>;
  discardLog?: Record<PlayerId, Array<{ pai: string; gold?: boolean; pochi?: string; tsumogiri?: boolean }>>;
  kinpeiTarget: Record<PlayerId, 'haru' | 'natsu' | 'aki' | 'fuyu' | null>;
  lizhi: Set<PlayerId>;
  openLizhi: Set<PlayerId>;
  feverActive: Record<PlayerId, boolean>;
  shuvariActive?: Record<PlayerId, boolean>;
  fuyuConsumed: Record<PlayerId, boolean>;
  shan: any;
  // R23 #1 fix: 夏夏金北 ×4 の差分を state.defen に反映するため state 参照
  state?: { defen: Record<PlayerId, number> };
  // 2026-05-15 bug Y fix: applyHule で動かした 3麻実点 delta [post-applyHule - beforeDefen] を渡す
  // 旧 R23 #1 fix は result.fenpei [4麻 majiang-core 計算] を ×3 して state.defen に加算してたが、
  // fenpei は 3麻 winnerGain と乖離してて 100単位の中途半端な ズレが発生する bug。
  // applyHule 反映済 delta [3麻実点] を ×3 加算する形に修正
  beforeDefen?: Record<PlayerId, number>;
  /** ロン牌 [ロン時のみ]。chip 集計では majiang-core の sp._bingpai に未反映なので補う */
  ronpai?: string | null;
  // method bridges [class 側で wrap、 helper からは callback として利用]
  applyChipOall: (target: PlayerId, n: number, opts?: { bypassShuvari?: boolean; bypassFever?: boolean; bypassPochi?: boolean; label?: string; mode?: 'tsumo' | 'ron' }) => void;
  applyChipFromLoser: (winner: PlayerId, loser: PlayerId, n: number, opts?: { bypassShuvari?: boolean; bypassFever?: boolean; bypassPochi?: boolean; label?: string; mode?: 'tsumo' | 'ron' }) => void;
}

/** 冬 [アリス / チューリップ / 上下段] 処理
 *  - fuyuCount=1 → アリス [単発 hit で停止]
 *  - fuyuCount>=2 → チューリップ [連続 hit、 隣接判定あり]
 *  - hasKinpei=true → 上下段 ペア [冬冬金北 等]
 */
export function applyFuyuChip(
  ctx: HuleChipCtx,
  winner: PlayerId,
  loser: PlayerId | null,
  fuyuCount: number,
  hasKinpei: boolean,
): void {
  const sp = ctx.shoupai.get(winner);
  if (!sp) return;
  // [2026-05-15 bug 4 fix] 副露あり 判定は ankan [\d{4}$] 除く: 暗槓のみは 門前扱い、
  // 通常 副露 [+/=/-] が 1 つでも あれば 鳴き手 → 冬 chip 半減。
  // 旧 code は _fulou.length > 0 で 暗槓も鳴き扱い → 暗槓だけの 門前手で chip 半減してた bug。
  const isFulou = (sp._fulou ?? []).some((m: string) => /[\+=\-]/.test(m));
  // 副露あり player の 冬 chip 倍率 半減 [リョー指示 2026-05-15]:
  // 門前: 2 chip / 副露あり: 1 chip [×0.5、 整数化]、 既存挙動 [isFulou ? 1 : 2] と同 result
  const chipPerHit = isFulou ? 1 : 2;
  const isTulip = fuyuCount >= 2;
  const enableLowerDeck = hasKinpei;
  // 現物 count map [tile key → 手牌中の枚数]
  // [リョー仕様 2026-05-11: 各めくり牌 vs 手牌の matching tile 枚数を合算]
  const genbutsuCount: Record<string, number> = {};
  const baseTile = (s: string, raw: string | number): string | null => {
    const n = raw === '0' ? 5 : (typeof raw === 'number' ? raw : parseInt(raw, 10));
    if (!Number.isFinite(n)) return null;
    if (s !== 'm' && s !== 'p' && s !== 's' && s !== 'z') return null;
    return `${s}${n}`;
  };
  for (const s of ['m', 'p', 's'] as const) {
    for (let n = 1; n <= 9; n++) {
      const c = sp._bingpai[s]?.[n] ?? 0;
      if (c > 0) genbutsuCount[`${s}${n}`] = (genbutsuCount[`${s}${n}`] ?? 0) + c;
    }
  }
  for (let n = 1; n <= 7; n++) {
    const c = sp._bingpai.z?.[n] ?? 0;
    if (c > 0) genbutsuCount[`z${n}`] = (genbutsuCount[`z${n}`] ?? 0) + c;
  }
  if (ctx.ronpai) {
    const strippedRon = String(ctx.ronpai).replace(/[\+=\-_*]/g, '').slice(0, 2);
    const ronTile = baseTile(strippedRon[0], strippedRon[1]);
    if (ronTile) genbutsuCount[ronTile] = (genbutsuCount[ronTile] ?? 0) + 1;
  }
  const nuki = ctx.nukidora[winner] ?? 0;
  if (nuki > 0) genbutsuCount['z4'] = (genbutsuCount['z4'] ?? 0) + nuki;
  // R19 #5 fix: nukidoraGold [金北 抜き済] も z4 + gN 現物に含める、
  // 旧 code は 抜き済 金北 が genbutsu count に入らず 冬めくり 当たり判定 が ズレてた
  const nukiG = (ctx as any).nukidoraGold?.[winner] ?? 0;
  if (nukiG > 0) {
    genbutsuCount['z4'] = (genbutsuCount['z4'] ?? 0) + nukiG;
  }
  // goldHand は _bingpai の 5 / z4 に含まれるため、現物数には重ねない。
  // [2026-05-15 fix bug D] 副露表記は 'm555+' [先頭 suit + 数字列] 形式、
  // 旧 code は stripped を 2 文字ずつ slice してて [tile 'm5','55',...] と無効 tile が混入、
  // 副露内 同 suit の 2 枚目以降が genbutsuCount に乗らず 冬めくり 当たり判定 から漏れる bug。
  // 正: 先頭 1 文字を suit、 残り数字を 1 文字ずつ tile 化 [0 は 5 に正規化して二重数えしない]
  for (const m of sp._fulou ?? []) {
    const stripped = (m as string).replace(/[\+=\-_*]/g, '');
    if (stripped.length < 2) continue;
    const fsuit = stripped[0];
    if (fsuit !== 'm' && fsuit !== 'p' && fsuit !== 's' && fsuit !== 'z') continue;
    for (let i = 1; i < stripped.length; i++) {
      const num = stripped[i];
      if (num < '0' || num > '9') continue;
      const tile = baseTile(fsuit, num);
      if (!tile) continue;
      genbutsuCount[tile] = (genbutsuCount[tile] ?? 0) + 1;
    }
  }
  // 華牌 [抜き華] も genbutsu に追加 [冬めくり対象、 神ぽっち swap target にもなる]
  for (const hp of ctx.huapai[winner] ?? []) {
    genbutsuCount[hp] = (genbutsuCount[hp] ?? 0) + 1;
  }
  const isLizhiW = ctx.lizhi.has(winner);
  const huaCount = ctx.huapai[winner].length + (isLizhiW ? 0 : 0);

  // めくり牌 1 枚 → 手牌中 match 数 [tulip は ±1 隣接 / m7↔m9 / m7m9↔z5 含む]
  let naturalHuaCounted = false;
  const checkHit = (pai: string | undefined, opts: { kamiPochiHua?: boolean } = {}): number => {
    if (!pai) return 0;
    if (pai.startsWith('f')) {
      let count = 0;
      if (!naturalHuaCounted) {
        count += huaCount;
        naturalHuaCounted = true;
      }
      if (opts.kamiPochiHua) count += 1;
      return count;
    }
    // R19 #5 fix: gp/gs/gN は length 2 でも特例 normalize 必須 [旧 length>2 内で 不発]
    let norm: string;
    if (pai === 'gp' || pai === 'p0') norm = 'p5';
    else if (pai === 'gs' || pai === 's0') norm = 's5';
    else if (pai === 'gN') norm = 'z4';
    else if (pai.length > 2 && pai.startsWith('z5')) norm = 'z5';
    else norm = pai;
    const matches = new Set<string>();
    matches.add(norm);
    if (isTulip) {
      const s = norm[0]; const n = parseInt(norm[1] === '0' ? '5' : norm[1]);
      if (s === 'm') {
        if (n === 7) { matches.add('z5'); matches.add('m9'); }
        else if (n === 9) { matches.add('z5'); matches.add('m7'); }
      } else if (s === 'z' && n === 5) {
        // z5 ↔ m7 / m9
        matches.add('m7'); matches.add('m9');
      } else if (s !== 'z') {
        // チューリップ ±1 隣接 [循環: 1↔9 も対象、 リョー指示 2026-05-11]
        if (n > 1) matches.add(`${s}${n - 1}`);
        else matches.add(`${s}9`); // n===1 → s9 循環
        if (n < 9) matches.add(`${s}${n + 1}`);
        else matches.add(`${s}1`); // n===9 → s1 循環
      }
    }
    let count = 0;
    for (const m of matches) count += genbutsuCount[m] ?? 0;
    return count;
  };

  const shanPai = ctx.shan._pai as string[];
  // めくった牌は shan._fuyuRevealed に保管 [inventory 維持 / ドラ表とは別管理]、 各めくりの hit / miss は fuyuLog
  const fuyuRevealed = ((ctx.shan as any)._fuyuRevealed ??= []) as string[];
  const fuyuLog: Array<{ pai: string; tier: 'upper' | 'lower'; hit: number }> = [];
  // 神ぽっち swap [冬めくり時]: 候補 = bingpai + 抜き北 + 抜き華、 最多枚数の牌を pick
  // [リョー指示 2026-05-11: 手牌 + 北 + 華 を候補にして最多枚数を 「打点確定時点で固定」]
  const mostCommon = (): string | null => {
    const counts: Record<string, number> = {};
    for (const s of ['m', 'p', 's'] as const) {
      for (let n = 1; n <= 9; n++) {
        const c = sp._bingpai[s]?.[n] ?? 0;
        if (c > 0) counts[`${s}${n}`] = c;
      }
    }
    for (let n = 1; n <= 7; n++) {
      const c = sp._bingpai.z?.[n] ?? 0;
      if (c > 0) counts[`z${n}`] = c;
    }
    const nuki = (ctx.nukidora[winner] ?? 0) + ((ctx as any).nukidoraGold?.[winner] ?? 0);
    if (nuki > 0) counts['z4'] = (counts['z4'] ?? 0) + nuki;
    for (const hp of ctx.huapai[winner] ?? []) {
      counts[hp] = (counts[hp] ?? 0) + 1;
    }
    for (const m of sp._fulou ?? []) {
      const stripped = (m as string).replace(/[\+=\-_*]/g, '');
      const fsuit = stripped[0];
      if (fsuit !== 'm' && fsuit !== 'p' && fsuit !== 's' && fsuit !== 'z') continue;
      for (let i = 1; i < stripped.length; i++) {
        const tile = baseTile(fsuit, stripped[i]);
        if (!tile) continue;
        counts[tile] = (counts[tile] ?? 0) + 1;
      }
    }
    let best: { pai: string; n: number } | null = null;
    for (const [pai, n] of Object.entries(counts)) {
      if (!best || n > best.n) best = { pai, n };
    }
    return best?.pai ?? null;
  };
  const effectivePai = (pai: string | undefined): { pai: string | undefined; kamiPochiHua: boolean } => {
    if (!pai) return { pai, kamiPochiHua: false };
    // 青ぽっち [z5b] / 緑ぽっち [z5g] は 神ぽっち効果で 最大枚数の手牌 として扱う
    if (pai === 'z5b' || pai === 'z5g') {
      const swapped = mostCommon() ?? pai;
      return { pai: swapped, kamiPochiHua: swapped.startsWith('f') };
    }
    return { pai, kamiPochiHua: false };
  };
  let totalHits = 0;
  while (true) {
    if (shanPai.length === 0) break;
    if (!enableLowerDeck && shanPai.length < 1) break;
    if (shanPai.length === 0) break;
    const upper = shanPai.pop()!;
    const lower = enableLowerDeck && shanPai.length > 0 ? shanPai.pop() : undefined;
    const upEff = effectivePai(upper);
    const lowEff = effectivePai(lower);
    const upHit = checkHit(upEff.pai ?? upper, { kamiPochiHua: upEff.kamiPochiHua });
    const lowHit = enableLowerDeck ? checkHit(lowEff.pai, { kamiPochiHua: lowEff.kamiPochiHua }) : 0;
    fuyuRevealed.push(upper);
    fuyuLog.push({ pai: upper, tier: 'upper', hit: upHit });
    if (lower !== undefined) {
      fuyuRevealed.push(lower);
      fuyuLog.push({ pai: lower, tier: 'lower', hit: lowHit });
    }
    if (upHit + lowHit === 0) break;
    totalHits += upHit + lowHit;
    // 冬は上下どちらかヒットしてる限り続く [リョー指示 2026-05-12]、
    // 旧 logic は アリス単体 [fuyu=1 + no kinpei] で 1 回めくって break してたが spec 違反
  }
  if (totalHits > 0) {
    const totalChip = totalHits * chipPerHit;
    // 冬冬金北 [fuyuCount>=2 + kinpei] のみ シュバリ非適用 [リョー指示 2026-05-11]
    // 冬単体 / 冬金北 [fuyuCount=1 + kinpei] は シュバリ乗る
    const bypassShuvari = isTulip && hasKinpei;
    const opts = { label: `冬 ${totalHits}hit${bypassShuvari ? ' [冬冬金北 シュバ非適用]' : ''}`, bypassShuvari };
    if (loser !== null) ctx.applyChipFromLoser(winner, loser, totalChip, opts);
    else ctx.applyChipOall(winner, totalChip, opts);
  }
  // 可視化用に fuyuLog を ctx 経由で stash [呼出側で result.fuyuLog として保持]
  (ctx as any)._lastFuyuLog = fuyuLog;
}

/** 和了時の chip 全集計
 *  - 赤 5 / 金 5 / 抜きドラ / 一発 / 裏ドラ
 *  - 春効果 [華 ×倍率 オール]
 *  - 冬効果 [applyFuyuChip 委譲]
 *  - 役満祝儀 / 三倍満 オール
 *  - 面前役祝儀 [混一 / 清一 / 二盃口]
 *  - 金北効果 [haru/natsu/aki/fuyu の打点 ×4 / chip 追加]
 *  result.hupai / result.defen / result.fanshu を mutate する
 */

function countNiji(sp: any, ronpai: string | null): number {
  let n = 0;
  if (sp?._bingpai?.__anmika) {
    n += sp._bingpai.__anmika.np3 ?? 0;
    n += sp._bingpai.__anmika.ns3 ?? 0;
    n += sp._bingpai.__anmika.nz3 ?? 0;
  }
  if (ronpai && isNijiPai(ronpai)) n += 1;
  return n;
}

export function applyChipsOnHule(
  ctx: HuleChipCtx,
  result: any,
  winner: PlayerId,
  loser: PlayerId | null,
): void {
  // 祝儀 panel 表示用: shuvari 使用状況を result に記録 [リョー指示 2026-05-12]
  result.shuvariUsedThisRound = !!ctx.shuvariActive?.[winner];
  // 面前満貫3枚→29枚: base chip (倍率前) を追跡
  let rawBaseTotal = 0;
  const origOall = ctx.applyChipOall;
  const origFromLoser = ctx.applyChipFromLoser;
  ctx.applyChipOall = (t, n, o) => { rawBaseTotal += n; origOall(t, n, o); };
  ctx.applyChipFromLoser = (w, l, n, o) => { rawBaseTotal += n; origFromLoser(w, l, n, o); };
  // The result carries the physical claim tile. River display metadata is not
  // authoritative and may be absent after reconnect or snapshot restoration.
  const claim = loser !== null ? claimTileIdentity(ctx.ronpai) : claimTileIdentity(null);
  const ronGoldP = claim.goldSuit === 'p' ? 1 : 0;
  const ronGoldS = claim.goldSuit === 's' ? 1 : 0;
  // 2026-05-14 user 報告 fix: goldHand は cumulative で discard / 副露 で漏れる case あり、
  // hule 時に 実 hand + fulou の '0' marker 数 で cap、 累積 ズレた金 5 chip 過剰計上を防ぐ
  const sp = ctx.shoupai.get(winner);
  let handAndFulouP0 = 0; // 5p の '0' marker [赤 or 金]
  let handAndFulouS0 = 0;
  if (sp) {
    handAndFulouP0 = sp._bingpai.p?.[0] ?? 0;
    handAndFulouS0 = sp._bingpai.s?.[0] ?? 0;
    for (const m of sp._fulou ?? []) {
      const ms = m as string;
      const head = ms[0];
      const zeros = (ms.match(/0/g) || []).length;
      if (head === 'p') handAndFulouP0 += zeros;
      else if (head === 's') handAndFulouS0 += zeros;
    }
  }
  // gold count を hand+fulou の '0' 枚数で cap [goldHand 累積バグ ガード]
  const cappedGoldP = Math.min(ctx.goldHand[winner].p, handAndFulouP0) + ronGoldP;
  const cappedGoldS = Math.min(ctx.goldHand[winner].s, handAndFulouS0) + ronGoldS;
  const winnerGoldCount = cappedGoldP + cappedGoldS;
  // 赤 count = 全 '0' marker - 金 count
  let redCount = 0;
  if (sp) {
    for (const s of ['m', 'p', 's']) {
      redCount += sp._bingpai[s]?.[0] ?? 0;
    }
    for (const m of sp._fulou ?? []) {
      const ms = m as string;
      if (ms.includes('0')) redCount += (ms.match(/0/g)?.length ?? 0);
    }
  }
  if (claim.core === 'p0') redCount += 1;
  if (claim.core === 's0') redCount += 1;
  redCount = Math.max(0, redCount - winnerGoldCount);

  const payByMode = (n: number, label?: string) => {
    if (loser !== null) ctx.applyChipFromLoser(winner, loser, n, { label });
    else ctx.applyChipOall(winner, n, { label });
  };
  if (redCount > 0) payByMode(2 * redCount, '赤 5 ×' + redCount);
  if (winnerGoldCount > 0) payByMode(4 * winnerGoldCount, '金 5 ×' + winnerGoldCount);
  // 虹牌: 0翻・7 chips each
  const nijiCount = countNiji(sp, loser !== null ? ctx.ronpai : null);
  if (nijiCount > 0) payByMode(7 * nijiCount, '虹 ×' + nijiCount);
  // 通常北 + 金北 両方とも 1 chip ずつ [リョー指示 2026-05-12、 金北も北の chip 含む]
  const nukiRegular = ctx.nukidora[winner];
  const nukiGold = ctx.nukidoraGold?.[winner] ?? 0;
  const nukiTotal = nukiRegular + nukiGold;
  if (nukiTotal > 0) payByMode(nukiTotal, '抜きドラ ×' + nukiTotal);

  if ((result.hupai ?? []).some((h: any) => h.name === '一発')) {
    if (loser !== null) ctx.applyChipFromLoser(winner, loser, 1, { label: '一発' });
    else ctx.applyChipOall(winner, 1, { label: '一発' });
  }
  const uradora = (result.hupai ?? []).find((h: any) => h.name === '裏ドラ');
  if (uradora && typeof uradora.fanshu === 'number' && uradora.fanshu > 0) {
    const lbl = `裏ドラ ×${uradora.fanshu}`;
    if (loser !== null) ctx.applyChipFromLoser(winner, loser, uradora.fanshu, { label: lbl });
    else ctx.applyChipOall(winner, uradora.fanshu, { label: lbl });
  }

  // 表示された華も和了時に抜いた扱い。裏はリーチ和了時だけ含める。
  const huaBase = ctx.huapai[winner];
  const hua = [...huaBase];
  for (const p of (ctx.shan.baopai ?? [])) if (typeof p === 'string' && /^f[1-4]$/.test(p)) hua.push(p);
  if (ctx.lizhi.has(winner)) {
    for (const p of (ctx.shan.fubaopai ?? [])) if (typeof p === 'string' && /^f[1-4]$/.test(p)) hua.push(p);
  }
  dlog('[haru chip]', { winner, huaBase, hua });
  const haruCount = hua.filter((p) => p === 'f1').length;
  if (haruCount >= 1) {
    const totalHua = hua.length;
    const haruKinpei = ctx.kinpeiTarget[winner] === 'haru';
    const multiplier = haruCount * (haruKinpei ? 2 : 1);
    // [2026-05-15 audit fix] 春効果はロン時もオール徴収だが、 ぽっち倍率はツモ和了時のみ。
    // ロン経由で trigger された 春は mode='ron' で applyChipOall 呼び、 ぽっち倍率を 1 強制。
    const haruMode: 'tsumo' | 'ron' | undefined = loser !== null ? 'ron' : 'tsumo';
    // [2026-07-16 リョー裁定] 春もシュバ適用 [5/23 audit CRITICAL [12] の「シュバ非適用」を撤回]
    ctx.applyChipOall(winner, totalHua * multiplier, {
      label: `春${haruKinpei ? '金北' : ''} [${totalHua}枚×${multiplier}]`,
      mode: haruMode,
    });
    result.hupai = result.hupai ?? [];
    const baseLabel = haruCount === 1 ? '春' : '春春';
    const fullLabel = haruKinpei ? `${baseLabel}金北` : baseLabel;
    result.hupai.push({ name: `${fullLabel} [${totalHua}枚×${multiplier} = ${totalHua * multiplier}オール]`, fanshu: 0 });
  }

  const fuyuCount = hua.filter((p) => p === 'f4').length;
  const isFuyuKinpei = ctx.kinpeiTarget[winner] === 'fuyu';
  const inFever = ctx.feverActive[winner];
  if (fuyuCount >= 1) {
    if (!inFever || ctx.fuyuConsumed[winner]) {
      applyFuyuChip(ctx, winner, loser, fuyuCount, isFuyuKinpei);
      // 冬めくり結果を result に紐付け [UI 表示用]
      if ((ctx as any)._lastFuyuLog) {
        result.fuyuLog = (ctx as any)._lastFuyuLog;
        (ctx as any)._lastFuyuLog = null;
      }
      if (inFever) ctx.feverActive[winner] = false;
    }
  }

  const dama = result.damanguan ?? 0;
  if (dama > 0) {
    const tsumoChips = [5, 5, 7, 9][Math.min(dama, 3)] ?? 5;
    const ronChips = [10, 10, 12, 14][Math.min(dama, 3)] ?? 10;
    if (loser === null) {
      ctx.applyChipOall(winner, tsumoChips, { label: `役満ツモ ×${dama}` });
    } else {
      ctx.applyChipFromLoser(winner, loser, ronChips, { label: `役満ロン ×${dama}` });
    }
    // 本役満 13翻超過 chip ボーナス [ツモ・ロン共通]
    // 「役満以外でハン数を計算して 13翻超えたら超過枚数分 chip」、 夏除く
    // 夏 fanshu 加算分を除外: hupai 中の 「夏 [打点ランクアップ ...翻相当]」 entry の fanshu 合計を引く
    const natsuBoostFan = (result.hupai ?? [])
      .filter((h: any) => typeof h.name === 'string' && h.name.startsWith('夏 ') && h.name.includes('ランクアップ'))
      .reduce((s: number, h: any) => s + (typeof h.fanshu === 'number' ? h.fanshu : 0), 0);
    // 役満以外で集計した fanshu。result.fanshu が無ければ個別役の数字を合算する。
    const baseFanshu = typeof result.fanshu === 'number'
      ? result.fanshu
      : (result.hupai ?? [])
        .filter((h: any) => typeof h.fanshu === 'number')
        .reduce((s: number, h: any) => s + h.fanshu, 0);
    const eligibleFanshu = baseFanshu - natsuBoostFan;
    if (eligibleFanshu > 13) {
      const bonusN = eligibleFanshu - 13;
      if (loser === null) ctx.applyChipOall(winner, bonusN, { label: `役満ツモ 13翻超過 ×${bonusN} [夏除く]` });
      else ctx.applyChipFromLoser(winner, loser, bonusN, { label: `役満ロン 13翻超過 ×${bonusN} [夏除く]` });
    }
  } else if (result.fanshu !== undefined && result.fanshu >= 11) {
    // 打点ランク chip [リョー指示 2026-05-12]:
    //   3 倍満 [11-12 翻]: 常に 3 オール [ロンでもオール]
    //   役満 [13-17 数え]: ツモ 5 オール / ロン 10 from loser
    //   5 倍満 [18-23]: ツモ 7 オール / ロン 12 from loser
    //   6 倍満 [24+]: ツモ 9 オール / ロン 14 from loser
    if (result.fanshu >= 13) {
      let rankTsumo: number, rankRon: number, rankLabel: string;
      if (result.fanshu >= 24) { rankTsumo = 9; rankRon = 14; rankLabel = '6 倍満'; }
      else if (result.fanshu >= 18) { rankTsumo = 7; rankRon = 12; rankLabel = '5 倍満'; }
      else { rankTsumo = 5; rankRon = 10; rankLabel = '役満 [数え]'; }
      if (loser === null) ctx.applyChipOall(winner, rankTsumo, { label: rankLabel });
      else ctx.applyChipFromLoser(winner, loser, rankRon, { label: rankLabel });
    } else {
      // 3 倍満 [11-12 翻] のみ ロンでもオール。mode は breakdown 用に明示する。
      const sanbaiMode: 'tsumo' | 'ron' | undefined = loser !== null ? 'ron' : 'tsumo';
      ctx.applyChipOall(winner, 3, { label: '3 倍満', mode: sanbaiMode });
    }
  }

  const sp2 = ctx.shoupai.get(winner);
  const isMenzen = !sp2._fulou || sp2._fulou.length === 0 || sp2._fulou.every((m: string) => m.match(/^[mpsz]\d{4}$/));
  if (isMenzen && result.hupai) {
    let menzenChip = 0;
    for (const h of result.hupai) {
      if (h.name === '混一色' || h.name === '混一色（喰い下がり）') menzenChip += 5;
      if (h.name === '清一色' || h.name === '清一色（喰い下がり）') menzenChip += 10;
      if (h.name === '二盃口') menzenChip += 15;
    }
    if (menzenChip > 0) {
      if (loser === null) {
        ctx.applyChipOall(winner, menzenChip, { label: 'ホンイツ等 面前役' });
      } else {
        ctx.applyChipFromLoser(winner, loser, menzenChip, { label: 'ホンイツ等 面前役' });
      }
    }
  }

  // R19 #1 fix: 金北抜き済も効果対象に。 旧 code は ctx.goldHand[winner].z > 0 のみ check、
  // declareNukiBei で goldHand.z 減らして nukidoraGold に移行 → 抜き済 金北で
  // 「夏夏金北 ×4」 「秋秋金北 祝儀」 が発動しなかった。
  // 「持ってた / 持ってる 金北」 で判定 [goldHand.z + nukidoraGold]
  const hasGoldKita = hasGoldKitaTile(ctx, winner);
  if (hasGoldKita) {
    const huaW = hua;
    const harus = huaW.filter((h) => h === 'f1').length;
    const natsus = huaW.filter((h) => h === 'f2').length;
    const akis = huaW.filter((h) => h === 'f3').length;
    const fuyus = huaW.filter((h) => h === 'f4').length;
    const target = ctx.kinpeiTarget[winner];
    let label = '';
    if (target === 'natsu' && natsus >= 2) {
      // 2026-05-15 bug Y fix: 旧 R23 #1 fix は result.fenpei [4麻 majiang-core 計算] を ×3 して
      // state.defen に加算してたが、 fenpei は 3麻 winnerGain と乖離してて 中途半端な 100 単位の
      // ズレが発生 [+10100 等]。 applyHule で実反映済の delta [3麻実点] を ×3 加算に修正
      if (!(result as any)._pointPaymentMultiplierApplied && ctx.state?.defen && ctx.beforeDefen) {
        for (const p of [0, 1, 2] as PlayerId[]) {
          const realDelta = ((ctx.state.defen as any)[p] ?? 0) - (ctx.beforeDefen[p] ?? 0);
          (ctx.state.defen as any)[p] = ((ctx.state.defen as any)[p] ?? 0) + realDelta * 3;
        }
      }
      if (!(result as any)._pointPaymentMultiplierApplied) {
        if (result.defen !== undefined) result.defen = result.defen * 4;
        if (result.defen3 !== undefined) result.defen3 = result.defen3 * 4;
        if (result.fenpei) result.fenpei = result.fenpei.map((x: number) => x * 4);
      }
      label = '夏夏金北 [打点 ×4]';
    } else if (target === 'natsu' && natsus === 1) {
      label = '夏金北 [+2 段アップ適用済]';
    } else if (target === 'aki' && akis >= 2) {
      if (result.fanshu !== undefined) {
        const natsuW = hua.filter((p: string) => p === 'f2').length;
        const chipN = result.fanshu + natsuW;
        if (loser !== null) ctx.applyChipFromLoser(winner, loser, chipN);
        else ctx.applyChipOall(winner, chipN);
      }
      label = '秋秋金北 [ハン数分祝儀]';
    } else if (target === 'aki' && akis === 1) {
      label = '秋金北 [ドラめくり追加適用済]';
    } else if (target === 'fuyu' && fuyus >= 2) {
      label = '冬冬金北 [上下段アリス・チューリップ適用済]';
    } else if (target === 'fuyu' && fuyus === 1) {
      label = '冬金北 [上下段アリス適用済]';
    } else if (target === 'haru' && harus >= 1) {
      label = harus >= 2 ? '春春金北 [春効果 ×4 適用済]' : '春金北 [春効果 ×2 適用済]';
    }
    if (label) {
      result.hupai.push({ name: label, fanshu: 0 });
    } else if (hasGoldKita && target === null) {
      result.hupai.push({ name: '金北 [強化保留中]', fanshu: 0 });
    }
  }
  // 面前満貫3枚→29枚: 面前マンガン以上で base chip が 3 なら 29 に引き上げ
  const sp3 = ctx.shoupai.get(winner);
  const isMenzen3 = !sp3._fulou || sp3._fulou.length === 0 || sp3._fulou.every((m: string) => m.match(/^[mpsz]\d{4}$/));
  const isMangan = (typeof result.fanshu === 'number' && result.fanshu >= 5) || (result.damanguan ?? 0) > 0;
  if (isMenzen3 && isMangan && rawBaseTotal === 3) {
    const boost = 26;
    if (loser !== null) origFromLoser(winner, loser, boost, { label: '面前満貫 3枚→29枚' });
    else origOall(winner, boost, { label: '面前満貫 3枚→29枚' });
    rawBaseTotal += boost;
    result.hupai = result.hupai ?? [];
    result.hupai.push({ name: '面前満貫 [3枚→29枚]', fanshu: 0 });
  }
  ctx.applyChipOall = origOall;
  ctx.applyChipFromLoser = origFromLoser;
}
