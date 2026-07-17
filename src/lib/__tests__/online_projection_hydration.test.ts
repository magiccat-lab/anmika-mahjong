import { get } from 'svelte/store';
import { describe, expect, it } from 'vitest';
import { createRoomAuthority } from '../../../server/authority';
import { captureSeatProjection } from '../../../server/ws_server';
import { createGameStore } from '../store';
import { defaultSanmaRule, generateTilePool } from '../shan3';

function concealedKnownCount(sp: any): number {
  return ['m', 'p', 's', 'z'].reduce((total, suit) =>
    total + (sp?._bingpai?.[suit] ?? []).reduce((sum: number, n: number) => sum + (n ?? 0), 0), 0);
}

describe('seat-scoped online projection hydration', () => {
  it('restores the recipient hand and turn phase without reconstructing hidden tiles or wall', () => {
    const authority = createRoomAuthority({
      preShuffledPool: generateTilePool(defaultSanmaRule()).map(String),
      qijia: 0,
    });
    const recipient = 1 as const;
    const projection: any = captureSeatProjection(authority, recipient);
    const game = createGameStore();

    game.initOnlineGame({
      ws: { readyState: 0, send() {} } as unknown as WebSocket,
      qijia: 0,
      mySeat: recipient,
      blindStart: {
        hands: { 0: [], 1: [], 2: [] },
        firstZimo: '',
        paishu: projection.shan.paishu,
        baopai: projection.shan.baopai,
        fubaopai: null,
      },
    });

    expect(game.hydrateOnlineProjection(projection)).toBe(true);
    const state: any = get(game);
    const own = state.game.shoupai.get(recipient);
    expect(own._bingpai.m).toEqual(projection.privateHand.bingpai.m);
    expect(own._bingpai.p).toEqual(projection.privateHand.bingpai.p);
    expect(own._bingpai.s).toEqual(projection.privateHand.bingpai.s);
    expect(own._bingpai.z).toEqual(projection.privateHand.bingpai.z);

    for (const player of [0, 2] as const) {
      const opponent = state.game.shoupai.get(player);
      const published = projection.publicHands[player];
      expect(concealedKnownCount(opponent)).toBe(published.revealedWaitTiles.length);
      expect(opponent._bingpai._).toBe(published.concealedCount - published.revealedWaitTiles.length);
      expect(opponent._zimo).toBe(published.hasZimo ? '__hidden_draw__' : published.pseudoZimo);
    }

    expect((state.game.shan as any)._pai).toEqual([]);
    expect(state.lastZimo).toBeNull();
    expect(state.awaitingRonDecision).toBe(projection.store.awaitingRonDecision);
    expect(state.awaitingFulou).toBe(projection.store.awaitingFulou);
  });

  it('rejects a projection addressed to a different seat', () => {
    const authority = createRoomAuthority({
      preShuffledPool: generateTilePool(defaultSanmaRule()).map(String),
      qijia: 0,
    });
    const game = createGameStore();
    game.initOnlineGame({
      ws: { readyState: 0, send() {} } as unknown as WebSocket,
      qijia: 0,
      mySeat: 1,
      blindStart: {
        hands: { 0: [], 1: [], 2: [] }, firstZimo: '', paishu: 55, baopai: [], fubaopai: null,
      },
    });

    expect(game.hydrateOnlineProjection(captureSeatProjection(authority, 0))).toBe(false);
  });

  it('hydrates authoritative Kami-pochi and tied-high decisions', () => {
    const authority = createRoomAuthority({
      preShuffledPool: generateTilePool(defaultSanmaRule()).map(String),
      qijia: 0,
    });
    const canonical = authority.canonicalState();
    canonical.pendingKamiPochi = {
      winner: 0,
      context: 'fuyu',
      occurrenceKey: 'fuyu:0:0',
      candidates: ['p1', 'f1'],
      decisionOwners: [0],
      decisionOwnerIndex: 0,
      isRon: false,
      ronfrom: null,
    };
    canonical.pendingPochiSwap = {
      winner: 0,
      kind: 'white',
      candidates: [{ target: 'p2', expectedChip: 4, fanshu: 2, damanguan: 0 }],
      decisionOwners: [0],
      decisionOwnerIndex: 0,
      isRon: false,
      ronfrom: null,
    };
    const projection: any = captureSeatProjection(authority, 0);
    const game = createGameStore();
    game.initOnlineGame({
      ws: { readyState: 0, send() {} } as unknown as WebSocket,
      qijia: 0,
      mySeat: 0,
      blindStart: {
        hands: { 0: [], 1: [], 2: [] }, firstZimo: '', paishu: 55, baopai: [], fubaopai: null,
      },
    });

    expect(game.hydrateOnlineProjection(projection)).toBe(true);
    const hydrated = get(game);
    expect(hydrated.pendingKamiPochi).toEqual(canonical.pendingKamiPochi);
    expect(hydrated.pendingPochiSwap).toEqual(canonical.pendingPochiSwap);
  });
});
