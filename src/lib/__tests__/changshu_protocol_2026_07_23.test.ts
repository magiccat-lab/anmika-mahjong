import { get } from 'svelte/store';
import { describe, expect, it } from 'vitest';
import { createRoomAuthority } from '../../../server/authority';
import { captureSeatProjection } from '../../../server/ws_server';
import { createGameStore } from '../store';
import { defaultSanmaRule, generateTilePool } from '../shan3';

// [2026-07-23 Sol設計 changshu protocol] 東風=1 / 半荘=2 を部屋設定として protocol 化。
// - RoomAuthorityInit.changshu → canonical Game3 + projection.gameConfig
// - resetMatch [nextMatch] は未指定なら現 changshu を維持 [default に戻る穴]
// - client hydrate は projection.gameConfig を source of truth にする [reconnect 穴]

function pool(): string[] {
  return generateTilePool(defaultSanmaRule()).map(String);
}

describe('changshu protocol', () => {
  it('authority init の changshu が canonical と projection.gameConfig に通る', () => {
    const a = createRoomAuthority({ preShuffledPool: pool(), qijia: 0, changshu: 2 });
    expect(a.canonicalState().game.changshu).toBe(2);
    const projection: any = captureSeatProjection(a, 1);
    expect(projection.gameConfig?.changshu).toBe(2);
  });

  it('未指定は東風 default [changshu=1]', () => {
    const a = createRoomAuthority({ preShuffledPool: pool(), qijia: 0 });
    expect(a.canonicalState().game.changshu).toBe(1);
    const projection: any = captureSeatProjection(a, 0);
    expect(projection.gameConfig?.changshu).toBe(1);
  });

  it('resetMatch [nextMatch] は changshu 未指定でも現在値を維持する', () => {
    const a = createRoomAuthority({ preShuffledPool: pool(), qijia: 0, changshu: 2 });
    a.resetMatch({ preShuffledPool: pool(), qijia: 1 });
    expect((a as any).game.changshu).toBe(2);
  });

  it('client hydrate は projection.gameConfig.changshu を採用する [reconnect 直後の default 引き]', () => {
    const a = createRoomAuthority({ preShuffledPool: pool(), qijia: 0, changshu: 2 });
    const recipient = 1 as const;
    const projection: any = captureSeatProjection(a, recipient);

    const game = createGameStore();
    // reconnect 直後を模擬: client 側は changshu を知らずに default 初期化
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
    expect((get(game) as any).game.changshu).toBe(1);
    expect(game.hydrateOnlineProjection(projection)).toBe(true);
    expect((get(game) as any).game.changshu).toBe(2);
  });

  it('client 側 store.reset [online pool 経路] は現 changshu を継承する', () => {
    const game = createGameStore();
    game.initOnlineGame({
      ws: { readyState: 0, send() {} } as unknown as WebSocket,
      qijia: 0,
      mySeat: 0,
      changshu: 2,
      preShuffledPool: pool(),
    });
    expect((get(game) as any).game.changshu).toBe(2);
    (game as any).reset({ preShuffledPool: pool(), qijia: 1 });
    expect((get(game) as any).game.changshu).toBe(2);
  });
});
