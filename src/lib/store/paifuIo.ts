
// store action: 牌譜 v2 JSON から StoreState を再構築
// 純関数 [paifu → StoreState | null]、 store.ts は update() で wrap して呼ぶ
import { Game3, buildShoupai, normalizePochiMultiplier } from '../game3';
import type { StoreState } from '../store';
import type { PlayerId } from '../types';

const PLAYERS = [0, 1, 2] as const;

function restorePendingAfterDapai(ng: Game3, restoredLastZimo: string | null): Pick<StoreState, 'lastDapai' | 'awaitingRonDecision' | 'ronPassedPlayers' | 'ronDeclaredPlayers' | 'ronResults' | 'awaitingFulou' | 'ponCandidates' | 'kanCandidates' | 'message'> {
  const empty = {
    lastDapai: null,
    awaitingRonDecision: false,
    ronPassedPlayers: [],
    ronDeclaredPlayers: [],
    ronResults: [],
    awaitingFulou: false,
    ponCandidates: [],
    kanCandidates: [],
    message: null,
  };
  if (restoredLastZimo) return empty;
  const events = Array.isArray(ng.events) ? ng.events : [];
  const lastEvent = events[events.length - 1] as any;
  if (!lastEvent || lastEvent.type !== 'dapai') return empty;
  const from = lastEvent.player;
  const pai = lastEvent.pai;
  if (![0, 1, 2].includes(from) || typeof pai !== 'string') return empty;
  const lastDapai = { player: from, pai };
  const ronCandidates = PLAYERS.filter((p) => p !== from && ng.canRon(p as PlayerId, pai, from as PlayerId));
  const ponCandidates: Array<{ player: number; mianzi: string[] }> = [];
  const kanCandidates: Array<{ player: number; mianzi: string[] }> = [];
  const someoneFever = PLAYERS.some((p) => ng.feverActive[p]);
  for (const p of PLAYERS) {
    if (p === from) continue;
    if (someoneFever && !ng.feverActive[p]) continue;
    const pon = ng.getPonCandidates(p as PlayerId, from as PlayerId, pai);
    if (pon.length > 0) ponCandidates.push({ player: p, mianzi: pon });
    const kan = ng.getDamingangCandidates(p as PlayerId, from as PlayerId, pai);
    if (kan.length > 0) kanCandidates.push({ player: p, mianzi: kan });
  }
  if (ronCandidates.length > 0) {
    return {
      ...empty,
      lastDapai,
      awaitingRonDecision: true,
      ponCandidates,
      kanCandidates,
      message: `ロン可能: player ${ronCandidates.join(',')}`,
    };
  }
  if (ponCandidates.length > 0 || kanCandidates.length > 0) {
    const ppl = [
      ...ponCandidates.map((c) => `pon p${c.player}`),
      ...kanCandidates.map((c) => `kan p${c.player}`),
    ];
    return {
      ...empty,
      lastDapai,
      awaitingFulou: true,
      ponCandidates,
      kanCandidates,
      message: `副露可能: ${ppl.join(' / ')}`,
    };
  }
  return empty;
}

/** 牌譜 v2 → StoreState を構築。 invalid なら null 返し、 store 側は message 設定のみ */
export function buildStateFromPaifu(paifu: any): StoreState | null {
  if (paifu.type !== 'anmika-mahjong-paifu' || (paifu.version ?? 1) < 2) return null;
  const ng = new Game3();
  const shan = ng.shan as any;
  shan._pai = [...(paifu.shan.currentPai ?? [])];
  shan._initialPai = [...(paifu.shan.initialPai ?? [])];
  shan._gold = new Array(shan._pai.length).fill(false);
  shan._baopai = [...(paifu.shan.baopai ?? [])];
  shan._fubaopai = [...(paifu.shan.fubaopai ?? [])];
  // 古い v2 牌譜には rinshan が無い。Game3 初期化時のランダム _rinshan を残すと
  // 復元後のカンで別山を引くので、未保存時も空で上書きする。
  shan._rinshan = [...(paifu.shan.rinshan ?? [])];
  shan._fuyuRevealed = [...(paifu.shan.fuyuRevealed ?? [])];
  shan._weikaigang = !!paifu.shan.weikaigang;
  shan.lastDrawnHuapai = [...(paifu.shan.lastDrawnHuapai ?? [])];
  shan.lastZimoGold = !!paifu.shan.lastZimoGold;
  shan.lastZimoPochi = paifu.shan.lastZimoPochi ?? null;
  shan.rinshanUsed = paifu.shan.rinshanUsed ?? 0;
  ng.state = { ...paifu.state };
  for (const pl of [0, 1, 2] as const) {
    const sd = paifu.shoupai?.[pl];
    if (sd) {
      const sp = buildShoupai([]);
      sp._bingpai = { _: sd.bingpai._, m: [...sd.bingpai.m], p: [...sd.bingpai.p], s: [...sd.bingpai.s], z: [...sd.bingpai.z] };
      sp._fulou = [...(sd.fulou ?? [])];
      sp._zimo = sd.zimo;
      ng.shoupai.set(pl, sp);
    }
  }
  const dummy = new Game3();
  dummy.qipai();
  for (const pl of [0, 1, 2] as const) {
    const heInst = new (dummy.he.get(0).constructor)();
    heInst._pai = [...(paifu.he?.[pl] ?? [])];
    ng.he.set(pl, heInst);
  }
  ng.huapai = paifu.huapai ?? { 0: [], 1: [], 2: [] };
  ng.goldHand = paifu.goldHand ?? { 0: { p: 0, s: 0, z: 0 }, 1: { p: 0, s: 0, z: 0 }, 2: { p: 0, s: 0, z: 0 } };
  ng.pochiHand = paifu.pochiHand ?? { 0: { blue: 0, red: 0, green: 0, yellow: 0 }, 1: { blue: 0, red: 0, green: 0, yellow: 0 }, 2: { blue: 0, red: 0, green: 0, yellow: 0 } };
  ng.nukidora = paifu.nukidora ?? { 0: 0, 1: 0, 2: 0 };
  // migration: nukidoraGold が paifu に無い場合 [v2 以前]、 goldHand.z 残数と bingpai.z[4] から推測
  //   旧仕様: gN 抜き時も nukidora++ し goldHand.z は残ったまま、 inventory ミスカウントの原因
  //   推測: goldHand.z > 0 かつ bingpai.z[4] === 0 で nukidora > 0 なら、 gN を抜いた可能性大
  //   → nukidoraGold に 1 振替 + goldHand.z -- + nukidora --
  ng.nukidoraGold = paifu.nukidoraGold ?? { 0: 0, 1: 0, 2: 0 };
  if (!paifu.nukidoraGold) {
    for (const pl of [0, 1, 2] as const) {
      const sp = ng.shoupai.get(pl);
      const z4InHand = sp?._bingpai?.z?.[4] ?? 0;
      const gN = ng.goldHand[pl]?.z ?? 0;
      const nk = ng.nukidora[pl] ?? 0;
      // hand に gN だけ残り [bingpai.z[4] === gN]、 かつ nukidora > 0 なら gN 抜き分を疑う
      // 安全側 [migration の付け替え過多回避]: gN > 0 かつ z4InHand === 0 のときのみ 1 件振替
      // goldHand.z > bingpai.z[4] なら 余剰 gN は 抜き済 [旧コードが goldHand 据置で nukidora++ してた]
      const staleGold = Math.max(0, gN - z4InHand);
      const shift = Math.min(staleGold, nk);
      if (shift > 0) {
        ng.nukidora[pl] -= shift;
        ng.goldHand[pl].z -= shift;
        ng.nukidoraGold[pl] += shift;
      }
    }
  }
  ng.kinpeiTarget = paifu.kinpeiTarget ?? { 0: null, 1: null, 2: null };
  ng.lizhi = new Set(paifu.lizhi ?? []);
  ng.openLizhi = new Set(paifu.openLizhi ?? []);
  ng.feverActive = paifu.feverActive ?? { 0: false, 1: false, 2: false };
  ng.feverTier = paifu.feverTier ?? { 0: 1, 1: 1, 2: 1 };
  ng.pochiMultiplier = {
    0: normalizePochiMultiplier(paifu.pochiMultiplier?.[0]),
    1: normalizePochiMultiplier(paifu.pochiMultiplier?.[1]),
    2: normalizePochiMultiplier(paifu.pochiMultiplier?.[2]),
  };
  ng.pochiPaymentMode = paifu.pochiPaymentMode ?? {
    0: ng.pochiMultiplier[0].defen < 0,
    1: ng.pochiMultiplier[1].defen < 0,
    2: ng.pochiMultiplier[2].defen < 0,
  };
  ng.shuvariUsed = paifu.shuvariUsed ?? { 0: false, 1: false, 2: false };
  ng.shuvariActive = paifu.shuvariActive ?? { 0: false, 1: false, 2: false };
  ng.chipLedger = paifu.chipLedger ?? { 0: 0, 1: 0, 2: 0 };
  ng.akiUsedCount = paifu.akiUsedCount ?? { 0: 0, 1: 0, 2: 0 };
  ng.yifaActive = paifu.yifaActive ?? { 0: false, 1: false, 2: false };
  ng.lizhiDeclareDapai = paifu.lizhiDeclareDapai ?? { 0: false, 1: false, 2: false };
  ng.lingshangActive = paifu.lingshangActive ?? { 0: false, 1: false, 2: false };
  // 嶺上牌を既にツモっている局面で qianggangPending=true が残っている古い牌譜は、
  // 加槓 window が閉じた後の stale flag とみなして落とす。
  const anyLingshangActive = Object.values(ng.lingshangActive).some(Boolean);
  ng.qianggangPending = (paifu.qianggangPending ?? false) && !anyLingshangActive;
  ng.diyizimo = paifu.diyizimo ?? false;
  ng.fuyuConsumed = paifu.fuyuConsumed ?? { 0: false, 1: false, 2: false };
  ng.fuyuSkip = paifu.fuyuSkip ?? { 0: false, 1: false, 2: false };
  ng.lastZimoInfo = paifu.lastZimoInfo ?? { player: null, pai: null, pochi: null, gold: false };
  ng.feverDeclareTing = paifu.feverDeclareTing ?? { 0: [], 1: [], 2: [] };
  ng.feverWinCount = paifu.feverWinCount ?? { 0: 0, 1: 0, 2: 0 };
  ng.justNukidBei = paifu.justNukidBei ?? { 0: false, 1: false, 2: false };
  ng.discardLog = paifu.discardLog ?? { 0: [], 1: [], 2: [] };
  ng.events = paifu.events ?? [];
  // 2026-05-15 fix [リョー報告: ツモ済 state で reload すると ツモ button / autoLizhi が
  //  どちらも発火せず stuck]: currentPlayer の shoupai._zimo が string で残ってるなら
  //  lastZimo を 復元する。 これがないと tsumokiri / autoLizhiAction / autoTsumoKiri
  //  すべて lastZimo falsy で no-op し、 リーチ player の番が永久に進まない
  let restoredLastZimo: string | null = null;
  try {
    const curPlayer = (ng as any).lunbanToPlayerId(ng.state.lunban);
    const curSp = ng.shoupai.get(curPlayer);
    const z = curSp?._zimo;
    if (typeof z === 'string' && z.length === 2) {
      restoredLastZimo = z;
    }
  } catch (_e) { /* lunban 破損等は no-op */ }
  const restoredPending = restorePendingAfterDapai(ng, restoredLastZimo);
  return {
    game: ng,
    lastZimo: restoredLastZimo,
    lastDapai: restoredPending.lastDapai,
    lastWinner: null,
    lastHuleResult: null,
    awaitingRonDecision: restoredPending.awaitingRonDecision,
    ronPassedPlayers: restoredPending.ronPassedPlayers,
    ronDeclaredPlayers: restoredPending.ronDeclaredPlayers,
    ronResults: restoredPending.ronResults,
    awaitingFulou: restoredPending.awaitingFulou,
    ponCandidates: restoredPending.ponCandidates,
    kanCandidates: restoredPending.kanCandidates,
    roundEnded: false,
    message: restoredPending.message ?? `📂 牌譜 v${paifu.version} 復元完了 [timestamp: ${paifu.timestamp}]`,
    cpu: { 0: false, 1: false, 2: false },
    lizhiPending: null,
    pendingKinpei: null,
    pendingFuyu: null,
    pendingFeverContinue: null,
    pendingPingju: false,
    pendingQianggang: null,
    pendingSaiKoro: null,
    stamps: { 0: null, 1: null, 2: null },
    cutin: null,
    cutinQueue: [],
  };
}
