
// game3.ts から切り出した snapshot pure helpers
// 金北選択変更時に巻き戻すための state 保存/復元
// 2026-05-14 codex review fix: state.lizhibang / qianggangPending / events / chipBreakdown も対象に拡張
import type { PlayerId } from './chip';

export type PreHuleSnapshot = {
  defen: Record<PlayerId, number>;
  chipLedger: Record<PlayerId, number>;
  akiUsedCount: Record<PlayerId, number>;
  feverActive: Record<PlayerId, boolean>;
  baopaiLen: number;
  fubaopaiLen: number;
  lizhibang: number;
  qianggangPending: boolean;
  eventsLen: number;
  chipBreakdownLen: number;
};

export type SnapshotRefs = {
  defen: Record<PlayerId, number>;
  chipLedger: Record<PlayerId, number>;
  akiUsedCount: Record<PlayerId, number>;
  feverActive: Record<PlayerId, boolean>;
  shan: any;
  state: { lizhibang: number };
  game: any; // for qianggangPending / events / chipBreakdown
};

export function saveSnapshot(refs: SnapshotRefs): PreHuleSnapshot {
  return {
    defen: { ...refs.defen },
    chipLedger: { ...refs.chipLedger },
    akiUsedCount: { ...refs.akiUsedCount },
    feverActive: { ...refs.feverActive },
    baopaiLen: refs.shan.baopai.length,
    fubaopaiLen: (refs.shan.fubaopai ?? []).length,
    lizhibang: refs.state?.lizhibang ?? 0,
    qianggangPending: refs.game?.qianggangPending ?? false,
    eventsLen: (refs.game?.events ?? []).length,
    chipBreakdownLen: (refs.game?.chipBreakdown ?? []).length,
  };
}

/** snap を refs に書き戻し [shan の baopai / fubaopai 末尾を pop して山末尾に戻す] */
export function restoreSnapshot(refs: SnapshotRefs, snap: PreHuleSnapshot | null): void {
  if (!snap) return;
  // mutate in-place [refs は state 上の参照]
  Object.assign(refs.defen, snap.defen);
  Object.assign(refs.chipLedger, snap.chipLedger);
  Object.assign(refs.akiUsedCount, snap.akiUsedCount);
  Object.assign(refs.feverActive, snap.feverActive);
  while (refs.shan.baopai.length > snap.baopaiLen) {
    const popped = refs.shan._baopai.pop();
    refs.shan._pai.push(popped);
  }
  while ((refs.shan.fubaopai ?? []).length > snap.fubaopaiLen) {
    const popped = (refs.shan._fubaopai ?? []).pop();
    if (popped) refs.shan._pai.push(popped);
  }
  // 2026-05-14 codex review fix: lizhibang / qianggangPending / events / chipBreakdown も復元
  if (refs.state) refs.state.lizhibang = snap.lizhibang;
  if (refs.game) {
    refs.game.qianggangPending = snap.qianggangPending;
    if (Array.isArray(refs.game.events)) refs.game.events.length = snap.eventsLen;
    if (Array.isArray(refs.game.chipBreakdown)) refs.game.chipBreakdown.length = snap.chipBreakdownLen;
  }
}
