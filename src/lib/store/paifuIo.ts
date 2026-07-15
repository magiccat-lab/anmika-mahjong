
// store action: 牌譜 v2 JSON から StoreState を再構築
// 純関数 [paifu → StoreState | null]、 store.ts は update() で wrap して呼ぶ
import { Game3, buildShoupai, normalizePochiMultiplier } from '../game3';
import { cloneCanonical } from '../canonicalJson';
import type { StoreState } from '../store';
import type { PlayerId } from '../types';

const PLAYERS = [0, 1, 2] as const;
export const PAIFU_SCHEMA_VERSION = 3 as const;

function hasPendingDecision(state: Pick<StoreState,
  'awaitingRonDecision' | 'awaitingFulou' | 'lizhiPending' | 'pendingKinpei' |
  'pendingFuyu' | 'pendingFeverContinue' | 'pendingPingju' | 'pendingQianggang' |
  'pendingSaiKoro'
>): boolean {
  return state.awaitingRonDecision
    || state.awaitingFulou
    || state.lizhiPending !== null
    || state.pendingKinpei !== null
    || state.pendingFuyu !== null
    || state.pendingFeverContinue !== null
    || state.pendingPingju
    || state.pendingQianggang !== null
    || state.pendingSaiKoro !== null;
}

/**
 * Until arbitrary mid-decision restoration is supported, saves are limited to
 * an unambiguous turn start (one player has a real drawn tile) or a completed
 * match after every post-win decision has been resolved.
 */
export function isSafePaifuSavePoint(state: StoreState): boolean {
  if (hasPendingDecision(state)) return false;
  if (state.game.state.finished) return state.roundEnded;
  if (state.roundEnded || state.lastDapai !== null || typeof state.lastZimo !== 'string') return false;
  try {
    const player = state.game.lunbanToPlayerId(state.game.state.lunban);
    const zimo = state.game.shoupai.get(player)?._zimo;
    return typeof zimo === 'string' && zimo.length <= 2;
  } catch {
    return false;
  }
}

function serializeHand(sp: any): any {
  if (!sp?._bingpai) return null;
  const bp = sp._bingpai;
  return {
    bingpai: {
      _: bp._,
      m: [...(bp.m ?? [])],
      p: [...(bp.p ?? [])],
      s: [...(bp.s ?? [])],
      z: [...(bp.z ?? [])],
      anmika: bp.__anmika ? { ...bp.__anmika } : null,
    },
    fulou: [...(sp._fulou ?? [])],
    zimo: sp._zimo ?? null,
    anmikaZimo: sp._anmikaZimo ?? null,
    anmikaFulou: cloneCanonical(sp._anmikaFulou ?? []),
    anmikaFulouPhysical: cloneCanonical(sp._anmikaFulouPhysical ?? []),
  };
}

/** Build the single v3 paifu representation used by export and restore. */
export function buildCanonicalPaifuSnapshot(state: StoreState, timestamp = new Date().toISOString()): any {
  if (!isSafePaifuSavePoint(state)) {
    throw new Error('牌譜は安全な手番開始時か、処理完了後の半荘終了時だけ保存できます');
  }
  const g = state.game;
  const shan = g.shan as any;
  const shanSnapshot = typeof shan.snapshot === 'function' ? shan.snapshot() : {};
  return cloneCanonical({
    type: 'anmika-mahjong-paifu',
    version: PAIFU_SCHEMA_VERSION,
    schemaVersion: PAIFU_SCHEMA_VERSION,
    timestamp,
    safePoint: { kind: g.state.finished ? 'match-ended' : 'turn-start' },
    game: {
      init: {
        shanRule: g.shanRule,
        startingDefen: g.startingDefen,
        changshu: g.changshu,
      },
      state: g.state,
      events: g.events,
      shan: {
        initialPai: [...(shan._initialPai ?? [])],
        ...shanSnapshot,
        fuyuRevealed: [...(shan._fuyuRevealed ?? [])],
        extraSanReduction: Number(shan.extraSanReduction ?? 0),
        closed: !!shan._closed,
      },
      shoupai: PLAYERS.map((player) => serializeHand(g.shoupai.get(player))),
      he: PLAYERS.map((player) => {
        const he = g.he.get(player);
        return he?._pai ? [...he._pai] : [];
      }),
      fields: {
        nukidora: g.nukidora,
        nukidoraGold: g.nukidoraGold,
        yifaActive: g.yifaActive,
        lizhiDeclareDapai: g.lizhiDeclareDapai,
        lingshangActive: g.lingshangActive,
        firstTurnState: g.firstTurnState,
        qianggangPending: g.qianggangPending,
        feverWinCount: g.feverWinCount,
        goldHand: g.goldHand,
        huapai: g.huapai,
        pochiHand: g.pochiHand,
        lastZimoInfo: g.lastZimoInfo,
        pochiMultiplier: g.pochiMultiplier,
        pochiPaymentMode: g.pochiPaymentMode,
        pochiChipReverse: g.pochiChipReverse,
        pochiChipDouble: g.pochiChipDouble,
        chipLedger: g.chipLedger,
        haruActive: g.haruActive,
        fuyuSkip: g.fuyuSkip,
        fuyuConsumed: g.fuyuConsumed,
        akiUsedCount: g.akiUsedCount,
        kinpeiTarget: g.kinpeiTarget,
        chipBreakdown: g.chipBreakdown,
        discardLog: g.discardLog,
        justNukidBei: g.justNukidBei,
        lizhi: Array.from(g.lizhi),
        openLizhi: Array.from(g.openLizhi),
        feverActive: g.feverActive,
        feverDeclareTing: g.feverDeclareTing,
        feverTier: g.feverTier,
        feverDeclareDapaiPlayer: g.feverDeclareDapaiPlayer,
        shuvariActive: g.shuvariActive,
        shuvariUsed: g.shuvariUsed,
        tobiChipPaid: g.tobiChipPaid,
      },
    },
    store: {
      lastZimo: state.lastZimo,
      lastDapai: state.lastDapai,
      lastWinner: state.lastWinner,
      lastHuleResult: state.lastHuleResult,
      roundEnded: state.roundEnded,
      message: state.message,
      cpu: state.cpu,
    },
  });
}

function restoreV3(paifu: any, preservedCpu: Record<PlayerId, boolean>): StoreState | null {
  if (paifu.schemaVersion !== PAIFU_SCHEMA_VERSION || !paifu.game || !paifu.store) return null;
  if (paifu.safePoint?.kind !== 'turn-start' && paifu.safePoint?.kind !== 'match-ended') return null;
  const terminal = paifu.safePoint.kind === 'match-ended';
  if (terminal !== !!paifu.game.state?.finished || terminal !== !!paifu.store.roundEnded) return null;
  if (!terminal && (paifu.store.roundEnded || paifu.store.lastDapai !== null || typeof paifu.store.lastZimo !== 'string')) return null;

  const init = paifu.game.init ?? {};
  const shanData = paifu.game.shan ?? {};
  const ng = new Game3({
    shanRule: init.shanRule,
    qijia: paifu.game.state?.qijia,
    startingDefen: init.startingDefen,
    changshu: init.changshu,
    preShuffledPool: shanData.initialPai,
  });
  const shan = ng.shan as any;
  shan._initialPai = [...(shanData.initialPai ?? [])];
  shan.restore({
    pai: [...(shanData.pai ?? [])],
    rinshan: [...(shanData.rinshan ?? [])],
    rinshanUsed: shanData.rinshanUsed ?? 0,
    lastDrawnHuapai: [...(shanData.lastDrawnHuapai ?? [])],
    lastZimoGold: !!shanData.lastZimoGold,
    lastZimoPochi: shanData.lastZimoPochi ?? null,
    kanDoraCount: shanData.kanDoraCount ?? 0,
    weikaigang: !!shanData.weikaigang,
    baopai: [...(shanData.baopai ?? [])],
    fubaopai: shanData.fubaopai === null ? null : [...(shanData.fubaopai ?? [])],
  });
  shan._fuyuRevealed = [...(shanData.fuyuRevealed ?? [])];
  shan.extraSanReduction = Number(shanData.extraSanReduction ?? 0);
  shan._closed = !!shanData.closed;
  ng.state = cloneCanonical(paifu.game.state);
  ng.events = cloneCanonical(paifu.game.events ?? []);

  for (const player of PLAYERS) {
    const data = paifu.game.shoupai?.[player];
    if (!data?.bingpai) return null;
    const sp = buildShoupai([]);
    sp._bingpai = {
      _: data.bingpai._,
      m: [...(data.bingpai.m ?? [])],
      p: [...(data.bingpai.p ?? [])],
      s: [...(data.bingpai.s ?? [])],
      z: [...(data.bingpai.z ?? [])],
    };
    if (data.bingpai.anmika) {
      sp._bingpai.__anmika = { ...data.bingpai.anmika };
      for (const [pai, count] of Object.entries(data.bingpai.anmika)) sp._bingpai[pai] = count;
    }
    sp._fulou = [...(data.fulou ?? [])];
    sp._zimo = data.zimo ?? null;
    sp._anmikaZimo = data.anmikaZimo ?? null;
    sp._anmikaFulou = cloneCanonical(data.anmikaFulou ?? []);
    sp._anmikaFulouPhysical = cloneCanonical(data.anmikaFulouPhysical ?? []);
    ng.shoupai.set(player, sp);
  }

  const dummy = new Game3();
  dummy.qipai();
  for (const player of PLAYERS) {
    const heInst = new (dummy.he.get(0).constructor)();
    heInst._pai = [...(paifu.game.he?.[player] ?? [])];
    ng.he.set(player, heInst);
  }

  const fields = paifu.game.fields ?? {};
  const recordFields = [
    'nukidora', 'nukidoraGold', 'yifaActive', 'lizhiDeclareDapai', 'lingshangActive',
    'feverWinCount', 'goldHand', 'huapai', 'pochiHand', 'lastZimoInfo',
    'pochiMultiplier', 'pochiPaymentMode', 'pochiChipReverse', 'pochiChipDouble',
    'chipLedger', 'haruActive', 'fuyuSkip', 'fuyuConsumed', 'akiUsedCount',
    'kinpeiTarget', 'chipBreakdown', 'discardLog', 'justNukidBei', 'feverActive',
    'feverDeclareTing', 'feverTier', 'shuvariActive', 'shuvariUsed',
  ];
  for (const field of recordFields) {
    if (fields[field] !== undefined) (ng as any)[field] = cloneCanonical(fields[field]);
  }
  ng.restoreFirstTurnState(fields.firstTurnState);
  ng.qianggangPending = !!fields.qianggangPending;
  ng.lizhi = new Set(fields.lizhi ?? []);
  ng.openLizhi = new Set(fields.openLizhi ?? []);
  ng.feverDeclareDapaiPlayer = fields.feverDeclareDapaiPlayer ?? null;
  ng.tobiChipPaid = !!fields.tobiChipPaid;

  const cpu = paifu.store.cpu ?? preservedCpu;
  return {
    game: ng,
    lastZimo: paifu.store.lastZimo ?? null,
    lastDapai: cloneCanonical(paifu.store.lastDapai ?? null),
    lastWinner: paifu.store.lastWinner ?? null,
    lastHuleResult: cloneCanonical(paifu.store.lastHuleResult ?? null),
    awaitingRonDecision: false,
    ronPassedPlayers: [],
    ronDeclaredPlayers: [],
    ronResults: [],
    awaitingFulou: false,
    ponCandidates: [],
    kanCandidates: [],
    roundEnded: !!paifu.store.roundEnded,
    message: paifu.store.message !== undefined
      ? paifu.store.message
      : `📂 牌譜 v${PAIFU_SCHEMA_VERSION} 復元完了 [timestamp: ${paifu.timestamp}]`,
    cpu: { 0: !!cpu[0], 1: !!cpu[1], 2: !!cpu[2] },
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
export function buildStateFromPaifu(paifu: any, preservedCpu: Record<PlayerId, boolean> = { 0: false, 1: false, 2: false }): StoreState | null {
  if (paifu.type !== 'anmika-mahjong-paifu' || (paifu.version ?? 1) < 2) return null;
  if (paifu.version === PAIFU_SCHEMA_VERSION) return restoreV3(paifu, preservedCpu);
  if (paifu.version > PAIFU_SCHEMA_VERSION) return null;
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
  if (paifu.firstTurnState) ng.restoreFirstTurnState(paifu.firstTurnState);
  else ng.diyizimo = paifu.diyizimo ?? false;
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
    cpu: { 0: !!preservedCpu[0], 1: !!preservedCpu[1], 2: !!preservedCpu[2] },
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
