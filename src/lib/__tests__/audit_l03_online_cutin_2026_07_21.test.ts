import { describe, expect, it } from 'vitest';
import { get } from 'svelte/store';
import { createRoomAuthority } from '../../../server/authority';
import { captureSeatProjection } from '../../../server/ws_server';
import { createGameStore, enqueueCutinState } from '../store';
import { defaultSanmaRule, generateTilePool } from '../shan3';
import type { PlayerId } from '../types';

// 2026-07-21 監査 L-03: オンライン projection に cutin/cutinQueue が無く、演出が
// 表示されなかった。projection に演出 cutin を権威イベントとして載せ、client は
// ts で dedup して再生する。server は broadcast 後に canonical から drain して蓄積を防ぐ。

function authority() {
  return createRoomAuthority({
    preShuffledPool: generateTilePool(defaultSanmaRule()).map(String),
    qijia: 0,
  });
}

describe('L-03: オンライン演出 cutin の配信', () => {
  it('projection に cutin/cutinQueue が含まれる', () => {
    const a = authority();
    // canonical store に演出を積む [applyHule 等が通常やる操作を直接再現]
    const s: any = a.canonicalState();
    enqueueCutinState(s, 'reach', 0 as PlayerId);
    const projection: any = captureSeatProjection(a, 1);
    expect(projection.store).toHaveProperty('cutin');
    expect(projection.store).toHaveProperty('cutinQueue');
    // reach cutin が cutin か cutinQueue のどこかに乗っている
    const all = [
      ...(projection.store.cutin ? [projection.store.cutin] : []),
      ...(projection.store.cutinQueue ?? []),
    ];
    expect(all.some((c: any) => c?.id === 'reach')).toBe(true);
  });

  it('takePendingCutins で canonical から drain され蓄積しない', () => {
    const a = authority();
    const s: any = a.canonicalState();
    enqueueCutinState(s, 'reach', 0 as PlayerId);
    enqueueCutinState(s, 'fever', 1 as PlayerId);
    const taken = a.takePendingCutins();
    expect(taken.length).toBeGreaterThanOrEqual(2);
    // drain 後は projection に cutin が残らない
    const after: any = captureSeatProjection(a, 1);
    const remaining = [
      ...(after.store.cutin ? [after.store.cutin] : []),
      ...(after.store.cutinQueue ?? []),
    ];
    expect(remaining.length).toBe(0);
  });

  it('client hydrate が cutin を ts で dedup して二重再生しない', () => {
    const a = authority();
    const s: any = a.canonicalState();
    enqueueCutinState(s, 'reach', 0 as PlayerId);
    const projection: any = captureSeatProjection(a, 1);

    const game = createGameStore();
    game.initOnlineGame({
      ws: { readyState: 0, send() {} } as unknown as WebSocket,
      qijia: 0,
      mySeat: 1,
      blindStart: {
        hands: { 0: [], 1: [], 2: [] }, firstZimo: '',
        paishu: projection.shan.paishu, baopai: projection.shan.baopai, fubaopai: null,
      },
    });
    game.hydrateOnlineProjection(projection);
    const st1: any = get(game);
    const played1 = (st1.cutin ? 1 : 0) + (st1.cutinQueue?.length ?? 0);
    expect(played1).toBeGreaterThanOrEqual(1);

    // 同じ projection [同じ ts] を再 hydrate しても二重に積まれない
    game.hydrateOnlineProjection(projection);
    const st2: any = get(game);
    const played2 = (st2.cutin ? 1 : 0) + (st2.cutinQueue?.length ?? 0);
    expect(played2).toBe(played1);
  });
});
