
// game3.ts から切り出した snapshot pure helpers
// 金北選択変更時に巻き戻すための state 保存/復元
// 2026-05-14 codex review fix: state.lizhibang / qianggangPending / events / chipBreakdown も対象に拡張
import type { PlayerId } from './chip';

const PLAYERS = [0, 1, 2] as const;

type GoldHand = Record<PlayerId, { p: number; s: number; z: number }>;
type PochiHand = Record<PlayerId, { blue: number; red: number; green: number; yellow: number }>;
type Huapai = Record<PlayerId, string[]>;
type PlayerCounts = Record<PlayerId, number>;
type KinpeiTarget = Record<PlayerId, 'haru' | 'natsu' | 'aki' | 'fuyu' | null>;
type KamiPochiDoraChoices = Record<PlayerId, Record<string, string>>;

export type PreHuleSnapshot = {
  defen: Record<PlayerId, number>;
  chipLedger: Record<PlayerId, number>;
  akiUsedCount: Record<PlayerId, number>;
  /** [D-01] 表示の秋 f3 の消費済み occurrence [`baopai:i`/`fubaopai:i`]。旧 snapshot 互換で optional */
  akiUsedIndicators?: Record<PlayerId, string[]>;
  feverActive: Record<PlayerId, boolean>;
  feverSaiAwarded?: Record<PlayerId, string[]>;
  lateShuvariWindow?: Record<PlayerId, boolean>;
  goldHand: GoldHand;
  pochiHand: PochiHand;
  huapai: Huapai;
  nukidora: PlayerCounts;
  nukidoraGold: PlayerCounts;
  kinpeiTarget: KinpeiTarget;
  kamiPochiDoraChoices: KamiPochiDoraChoices;
  shanSnapshot: any | null;
  baopaiLen: number;
  fubaopaiLen: number;
  lizhibang: number;
  qianggangPending: boolean;
  eventsLen: number;
  chipBreakdownLen: number;
  /** [2026-07-23 4人回し Phase1] chipEffects の截断復元用 [旧 snapshot 互換で optional] */
  chipEffectsLen?: number;
  fuyuRevealState: any;
};

export type SnapshotRefs = {
  defen: Record<PlayerId, number>;
  chipLedger: Record<PlayerId, number>;
  akiUsedCount: Record<PlayerId, number>;
  akiUsedIndicators?: Record<PlayerId, string[]>;
  feverActive: Record<PlayerId, boolean>;
  feverSaiAwarded: Record<PlayerId, string[]>;
  lateShuvariWindow: Record<PlayerId, boolean>;
  goldHand: GoldHand;
  pochiHand: PochiHand;
  huapai: Huapai;
  nukidora: PlayerCounts;
  nukidoraGold: PlayerCounts;
  kinpeiTarget: KinpeiTarget;
  kamiPochiDoraChoices?: KamiPochiDoraChoices;
  shan: any;
  state?: { lizhibang: number };
  game?: any; // for qianggangPending / events / chipBreakdown
};

function cloneGoldHand(src: Partial<GoldHand> | undefined): GoldHand {
  return {
    0: { p: src?.[0]?.p ?? 0, s: src?.[0]?.s ?? 0, z: src?.[0]?.z ?? 0 },
    1: { p: src?.[1]?.p ?? 0, s: src?.[1]?.s ?? 0, z: src?.[1]?.z ?? 0 },
    2: { p: src?.[2]?.p ?? 0, s: src?.[2]?.s ?? 0, z: src?.[2]?.z ?? 0 },
  };
}

function clonePochiHand(src: Partial<PochiHand> | undefined): PochiHand {
  return {
    0: { blue: src?.[0]?.blue ?? 0, red: src?.[0]?.red ?? 0, green: src?.[0]?.green ?? 0, yellow: src?.[0]?.yellow ?? 0 },
    1: { blue: src?.[1]?.blue ?? 0, red: src?.[1]?.red ?? 0, green: src?.[1]?.green ?? 0, yellow: src?.[1]?.yellow ?? 0 },
    2: { blue: src?.[2]?.blue ?? 0, red: src?.[2]?.red ?? 0, green: src?.[2]?.green ?? 0, yellow: src?.[2]?.yellow ?? 0 },
  };
}

function cloneHuapai(src: Partial<Huapai> | undefined): Huapai {
  return {
    0: [...(src?.[0] ?? [])],
    1: [...(src?.[1] ?? [])],
    2: [...(src?.[2] ?? [])],
  };
}

function clonePlayerCounts(src: Partial<PlayerCounts> | undefined): PlayerCounts {
  return {
    0: src?.[0] ?? 0,
    1: src?.[1] ?? 0,
    2: src?.[2] ?? 0,
  };
}

function cloneKinpeiTarget(src: Partial<KinpeiTarget> | undefined): KinpeiTarget {
  return {
    0: src?.[0] ?? null,
    1: src?.[1] ?? null,
    2: src?.[2] ?? null,
  };
}

export function saveSnapshot(refs: SnapshotRefs): PreHuleSnapshot {
  return {
    defen: { ...refs.defen },
    chipLedger: { ...refs.chipLedger },
    akiUsedCount: { ...refs.akiUsedCount },
    akiUsedIndicators: {
      0: [...(refs.akiUsedIndicators?.[0] ?? [])],
      1: [...(refs.akiUsedIndicators?.[1] ?? [])],
      2: [...(refs.akiUsedIndicators?.[2] ?? [])],
    },
    feverActive: { ...refs.feverActive },
    feverSaiAwarded: {
      0: [...(refs.feverSaiAwarded?.[0] ?? [])],
      1: [...(refs.feverSaiAwarded?.[1] ?? [])],
      2: [...(refs.feverSaiAwarded?.[2] ?? [])],
    },
    lateShuvariWindow: { ...(refs.lateShuvariWindow ?? { 0: false, 1: false, 2: false }) },
    goldHand: cloneGoldHand(refs.goldHand),
    pochiHand: clonePochiHand(refs.pochiHand),
    huapai: cloneHuapai(refs.huapai),
    nukidora: clonePlayerCounts(refs.nukidora),
    nukidoraGold: clonePlayerCounts(refs.nukidoraGold),
    kinpeiTarget: cloneKinpeiTarget(refs.kinpeiTarget),
    kamiPochiDoraChoices: {
      0: { ...(refs.kamiPochiDoraChoices?.[0] ?? {}) },
      1: { ...(refs.kamiPochiDoraChoices?.[1] ?? {}) },
      2: { ...(refs.kamiPochiDoraChoices?.[2] ?? {}) },
    },
    shanSnapshot: typeof refs.shan?.snapshot === 'function' ? refs.shan.snapshot() : null,
    baopaiLen: refs.shan.baopai.length,
    fubaopaiLen: (refs.shan.fubaopai ?? []).length,
    lizhibang: refs.state?.lizhibang ?? 0,
    qianggangPending: refs.game?.qianggangPending ?? false,
    eventsLen: (refs.game?.events ?? []).length,
    chipBreakdownLen: (refs.game?.chipBreakdown ?? []).length,
    chipEffectsLen: (refs.game?.chipEffects ?? []).length,
    fuyuRevealState: refs.game?.fuyuRevealState
      ? JSON.parse(JSON.stringify(refs.game.fuyuRevealState))
      : { 0: null, 1: null, 2: null },
  };
}

/** snap を refs に書き戻し [shan の baopai / fubaopai 末尾を pop して、
 *  配牌時に固定された山の深い側へ戻す] */
export function restoreSnapshot(refs: SnapshotRefs, snap: PreHuleSnapshot | null): void {
  if (!snap) return;
  // mutate in-place [refs は state 上の参照]
  Object.assign(refs.defen, snap.defen);
  Object.assign(refs.chipLedger, snap.chipLedger);
  Object.assign(refs.akiUsedCount, snap.akiUsedCount);
  if (refs.akiUsedIndicators) {
    for (const p of PLAYERS) {
      refs.akiUsedIndicators[p] = [...(snap.akiUsedIndicators?.[p] ?? [])];
    }
  }
  Object.assign(refs.feverActive, snap.feverActive);
  // [2026-07-22 リョー報告: 金北で華を強化すると四華サイコロが2回] feverSaiAwarded は
  // restore で巻き戻さない。金北変更等の再計算 [saveHuleSnapshot→restore→再settle] で
  // 支払い済みサイコロの記録が消え、同じ award が再発火していた。
  // 「振ったサイコロは巻き戻らない」= 局内で単調増加、消去は局開始リセットのみ
  if (refs.lateShuvariWindow) {
    Object.assign(refs.lateShuvariWindow, snap.lateShuvariWindow ?? { 0: false, 1: false, 2: false });
  }
  for (const p of PLAYERS) {
    Object.assign(refs.goldHand[p], snap.goldHand[p]);
    Object.assign(refs.pochiHand[p], snap.pochiHand[p]);
    refs.huapai[p].length = 0;
    refs.huapai[p].push(...snap.huapai[p]);
  }
  Object.assign(refs.nukidora, snap.nukidora);
  Object.assign(refs.nukidoraGold, snap.nukidoraGold);
  Object.assign(refs.kinpeiTarget, snap.kinpeiTarget);
  if (refs.kamiPochiDoraChoices) {
    for (const p of PLAYERS) {
      refs.kamiPochiDoraChoices[p] = { ...(snap.kamiPochiDoraChoices?.[p] ?? {}) };
    }
  }
  if (snap.shanSnapshot && typeof refs.shan?.restore === 'function') {
    refs.shan.restore(snap.shanSnapshot);
  } else {
    const addedFubaopai: string[] = [];
    while ((refs.shan.fubaopai ?? []).length > snap.fubaopaiLen) {
      const popped = (refs.shan._fubaopai ?? []).pop();
      if (popped) addedFubaopai.unshift(popped);
    }
    const addedBaopai: string[] = [];
    while (refs.shan.baopai.length > snap.baopaiLen) {
      const popped = refs.shan._baopai.pop();
      if (popped) addedBaopai.unshift(popped);
    }
    // 秋の物理開示順 [表1→裏1→表2→裏2] を保ったまま深い側へ戻す。
    // 種別ごとに unshift すると [表1→表2→裏1→裏2] へ並び替わり、
    // 次の候補計算で固定位置と異なる表示牌を開いてしまう。
    const restoredIndicators: string[] = [];
    const maxAdded = Math.max(addedBaopai.length, addedFubaopai.length);
    for (let index = 0; index < maxAdded; index += 1) {
      if (addedBaopai[index]) restoredIndicators.push(addedBaopai[index]);
      if (addedFubaopai[index]) restoredIndicators.push(addedFubaopai[index]);
    }
    refs.shan._pai.unshift(...restoredIndicators);
  }
  // 2026-05-14 codex review fix: lizhibang / qianggangPending / events / chipBreakdown も復元
  if (refs.state) refs.state.lizhibang = snap.lizhibang;
  if (refs.game) {
    refs.game.qianggangPending = snap.qianggangPending;
    if (Array.isArray(refs.game.events)) refs.game.events.length = snap.eventsLen;
    if (Array.isArray(refs.game.chipBreakdown)) refs.game.chipBreakdown.length = snap.chipBreakdownLen;
    // [2026-07-23 4人回し Phase1] 投機評価の巻き戻しで effect も一緒に截断 [幻の精算を残さない]
    if (Array.isArray(refs.game.chipEffects) && typeof snap.chipEffectsLen === 'number') {
      refs.game.chipEffects.length = Math.min(refs.game.chipEffects.length, snap.chipEffectsLen);
    }
    refs.game.fuyuRevealState = snap.fuyuRevealState
      ? JSON.parse(JSON.stringify(snap.fuyuRevealState))
      : { 0: null, 1: null, 2: null };
  }
}
