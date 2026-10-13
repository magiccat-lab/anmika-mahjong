// [2026-10-13 リョー「サーバー更新した時に前の演出がもっかい色々再生される問題があるっぽいから気を付けてね」]
// 部屋の復元 [ws の再起動 ・ reject 後の作り直し] は記録の command を頭から読み直す。読み直した手が積んだ
// 演出 cutin [ツモ ・ ロン ・ リーチ ・ 4北 ・ プラ転 …] は新しい ts で canonical に残り、最初の同期で
// 全員の画面に昔の演出が流れていた。復元した authority には未配信の cutin が残らない事を見る。
import { describe, expect, it } from 'vitest';

import { createRoomAuthority } from '../../../server/authority';
import { captureSeatProjection, reactionTimeoutAction, restoreAuthority, turnTimeoutAction } from '../../../server/ws_server';
import type { AcceptedRoomCommand, CanonicalRoomSnapshot } from '../../../server/protocol';
import { defaultSanmaRule, generateTilePool } from '../shan3';

function pool(seed: number): string[] {
  const tiles = generateTilePool(defaultSanmaRule()).map(String);
  let value = seed;
  for (let i = tiles.length - 1; i > 0; i -= 1) {
    value = (value * 1103515245 + 12345) % 2147483648;
    const j = value % (i + 1);
    [tiles[i], tiles[j]] = [tiles[j], tiles[i]];
  }
  return tiles;
}

/** 和了後の選択は server の代行と同じく既定の物を選ぶ */
function postWin(state: any): { actor: number; action: Record<string, any> } | null {
  const owner = (p: any) => p?.decisionOwners?.[p?.decisionOwnerIndex ?? 0] ?? p?.winner ?? 0;
  if (state.pendingFuyu) return { actor: owner(state.pendingFuyu), action: { type: 'selectFuyu', use: true } };
  if (state.pendingKinpei) return { actor: owner(state.pendingKinpei), action: { type: 'selectKinpei', target: null } };
  if (state.pendingKamiPochi) {
    const p = state.pendingKamiPochi;
    return { actor: owner(p), action: { type: 'selectKamiPochi', target: p.candidates?.[0], occurrenceKey: p.occurrenceKey } };
  }
  if (state.pendingPochiSwap) {
    const p = state.pendingPochiSwap;
    return { actor: owner(p), action: { type: 'selectPochiSwap', target: p.candidates?.[0]?.target } };
  }
  if (state.pendingSaiKoro) {
    const p = state.pendingSaiKoro;
    const actor = p.chances?.[p.currentIdx ?? 0]?.winner ?? p.winner;
    if (!p.selectedCombo) return { actor, action: { type: 'selectSaiKoroCombo', small: 1, large: 6 } };
    if (!p.finalized) return { actor, action: { type: 'rollSaiKoroDice', override: [3, 4] } };
    return { actor, action: { type: 'advanceSaiKoro' } };
  }
  if (state.pendingFeverContinue) return { actor: state.pendingFeverContinue.winner, action: { type: 'continueFever' } };
  return null;
}

describe('部屋の復元で昔の演出を流さない', () => {
  it('読み直した command の cutin は復元した authority に残らない', () => {
    const members = [0, 1, 2].map((seat) => ({ seat, is_cpu: true }));
    const start = { preShuffledPool: pool(11), qijia: 0, changshu: 1 };
    const live = createRoomAuthority(start);
    const log: AcceptedRoomCommand[] = [];
    let liveCutins = 0;
    for (let step = 0; step < 3000 && liveCutins < 3; step += 1) {
      const state: any = live.canonicalState();
      let cand = postWin(state);
      if (!cand && (state.roundEnded || live.roundEnded) && live.isPostWinResolved()) {
        cand = { actor: 0, action: { type: 'nextRound', preShuffledPool: pool(100 + step) } };
      }
      if (!cand) {
        const seat = [...live.ronCandidates, ...live.ponCandidates.map((c) => c.player), ...live.kanCandidates.map((c) => c.player)][0];
        cand = seat !== undefined
          ? { actor: seat, action: reactionTimeoutAction(live, seat) as Record<string, any> }
          : { actor: live.currentPlayer(), action: turnTimeoutAction(live, true) as Record<string, any> };
      }
      if (!cand?.action) break;
      const action = structuredClone(cand.action);
      if (live.validateAndApply(cand.actor, action, members)) break;
      live.takeCanonicalChipEffects();
      liveCutins += live.takePendingCutins().length;
      log.push({ commandId: `c${log.length + 1}`, revision: log.length + 1, actorSeat: cand.actor, fromUserId: '', action, matchId: 0, roundId: 0, acceptedAt: '' } as AcceptedRoomCommand);
    }
    // 対局の中で演出は出ていた [ここが 0 だと下の確かめが空振りになる]
    expect(liveCutins).toBeGreaterThan(0);

    const snapshot = {
      roomId: 'CUTIN',
      started: true,
      start: { ...start, members: members.map((m) => ({ ...m, user_id: `u${m.seat}`, username: `u${m.seat}` })) },
      commands: [],
    } as unknown as CanonicalRoomSnapshot;
    const restored = restoreAuthority(snapshot, log)!;
    const state: any = restored.canonicalState();
    expect(state.cutin ?? null).toBeNull();
    expect(state.cutinQueue ?? []).toEqual([]);
    for (const seat of [0, 1, 2, -1]) {
      const projection: any = captureSeatProjection(restored, seat);
      expect(projection.store.cutin ?? null, `seat ${seat}`).toBeNull();
      expect(projection.store.cutinQueue ?? [], `seat ${seat}`).toEqual([]);
    }
  });
});
