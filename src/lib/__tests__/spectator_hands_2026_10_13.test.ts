// [2026-10-13 リョー「観戦の時みんなの手配見れないんだけどなんで」→「直してほしい」]
// 7/23 に観戦を作った時は全員の手牌を伏せていた。観戦 (seat -1、抜け番も同じ投影) には
// 3 人の手牌を publicHands.revealedHand で送る。打っている席には今まで通り他家の手牌を送らない。
import { describe, expect, it } from 'vitest';

import { createRoomAuthority } from '../../../server/authority';
import { captureSeatProjection } from '../../../server/ws_server';
import { defaultSanmaRule, generateTilePool } from '../shan3';

function pool(): string[] {
  const tiles = generateTilePool(defaultSanmaRule());
  let seed = 7;
  for (let i = tiles.length - 1; i > 0; i -= 1) {
    seed = (seed * 1103515245 + 12345) % 2147483648;
    const j = seed % (i + 1);
    [tiles[i], tiles[j]] = [tiles[j], tiles[i]];
  }
  return tiles;
}

describe('観戦は全員の手牌が見える', () => {
  const authority = createRoomAuthority({ preShuffledPool: pool(), qijia: 0, changshu: 1 });

  it('観戦の投影は 3 人とも revealedHand があり、privateHand は送らない', () => {
    const spectator: any = captureSeatProjection(authority, -1);
    expect(spectator.privateHand).toBeNull();
    for (const seat of [0, 1, 2]) {
      const hand = spectator.publicHands[seat];
      expect(hand.revealedHand, `seat ${seat}`).not.toBeNull();
      expect(hand.revealedHand.bingpai).toBeTruthy();
    }
  });

  it('打っている席には他家の手牌を送らない (自分の分は privateHand)', () => {
    for (const seat of [0, 1, 2] as const) {
      const projection: any = captureSeatProjection(authority, seat);
      expect(projection.privateHand).not.toBeNull();
      for (const other of [0, 1, 2].filter((p) => p !== seat)) {
        expect(projection.publicHands[other].revealedHand, `seat ${seat} sees ${other}`).toBeNull();
      }
    }
  });
});

// [2026-10-13 リョー「テンパイ時にテンパイ者の牌姿が見えるようにして」] 流局 (和了者なし) では
// テンパイの人の手牌だけを全席に見せる
describe('流局でテンパイの人の手牌が見える', () => {
  it('流局中はテンパイの席だけ revealedHand を送り、ノーテンは伏せる', () => {
    const authority = createRoomAuthority({ preShuffledPool: pool(), qijia: 0, changshu: 1 });
    const state: any = authority.canonicalState();
    const game: any = state.game;
    const realTing = game.getTingpaiList.bind(game);
    game.getTingpaiList = (p: number) => (p === 1 ? ['m1'] : []);
    try {
      state.pendingPingju = true;
      state.lastWinner = null;
      const seat0: any = captureSeatProjection(authority, 0);
      expect(seat0.publicHands[1].revealedHand).not.toBeNull();
      expect(seat0.publicHands[2].revealedHand).toBeNull();
      state.pendingPingju = false;
      const playing: any = captureSeatProjection(authority, 0);
      expect(playing.publicHands[1].revealedHand).toBeNull();
    } finally {
      game.getTingpaiList = realTing;
      state.pendingPingju = false;
    }
  });
});

// [2026-10-13 観戦の画面が「同期に失敗し続けています」] App は観戦の mySeat を undefined で渡す
// (席契約の recipientGameSeat が null のため)。spectator: true なら store が -1 で持ち、hydrate を通す
import { createGameStore } from '../store';

describe('観戦の画面が盤面を受け取れる', () => {
  it('spectator: true で mySeat 無しでも、観戦の projection を hydrate できる', () => {
    const authority = createRoomAuthority({ preShuffledPool: pool(), qijia: 0, changshu: 1 });
    const projection: any = captureSeatProjection(authority, -1);
    const game = createGameStore();
    game.initOnlineGame({
      ws: { readyState: 0, send() {} } as unknown as WebSocket,
      qijia: 0,
      mySeat: undefined,
      spectator: true,
      blindStart: { hands: { 0: [], 1: [], 2: [] }, firstZimo: '', paishu: projection.shan.paishu, baopai: projection.shan.baopai, fubaopai: null },
    } as any);
    expect(game.hydrateOnlineProjection(projection)).toBe(true);
  });
});
