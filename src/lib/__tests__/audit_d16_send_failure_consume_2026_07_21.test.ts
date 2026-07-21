import { describe, expect, it } from 'vitest';
import { get } from 'svelte/store';
import { createGameStore } from '../store';
import { createRoomAuthority } from '../../../server/authority';
import { captureSeatProjection } from '../../../server/ws_server';
import { defaultSanmaRule, generateTilePool } from '../shan3';

// 2026-07-21 監査 D-16: online 中に WebSocket.send / JSON 化が例外を投げた時、
// 旧実装は sendOnlineAction が false を返し、呼び出し側が同じ打牌をローカル
// Game3 にだけ適用してサーバーと desync していた。送信失敗でも consume し、
// ローカル適用せず resync を要求する。

function onlineStoreAtOwnTurn() {
  const authority = createRoomAuthority({
    preShuffledPool: generateTilePool(defaultSanmaRule()).map(String),
    qijia: 0,
  });
  // 自席 0 が現在手番になるまで projection を取る [qijia=0 は席0が親]
  const recipient = 0 as const;
  const projection: any = captureSeatProjection(authority, recipient);
  const game = createGameStore();
  const sendCalls: any[] = [];
  let throwOnAction = true;
  const ws = {
    readyState: 1, // OPEN
    send(raw: string) {
      const msg = JSON.parse(raw);
      sendCalls.push(msg);
      if (throwOnAction && msg.type === 'action') throw new Error('simulated send failure');
    },
  } as unknown as WebSocket;

  game.initOnlineGame({
    ws,
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
  game.hydrateOnlineProjection(projection);
  return { game, sendCalls, get2: () => get(game) as any };
}

describe('D-16: online 送信失敗でもローカル適用しない', () => {
  it('discard の send が例外でも local Game3 は変化せず resync を要求する', () => {
    const { game, sendCalls, get2 } = onlineStoreAtOwnTurn();
    const before = get2();
    const heBefore = [...(before.game.he.get(0)?._pai ?? [])];
    const zimoBefore = before.game.shoupai.get(0)?._zimo;

    // 現手番の打牌を試みる [send が action で throw する]
    const own = before.game.shoupai.get(0);
    const anyTile = ['m', 'p', 's', 'z'].flatMap((suit) =>
      (own._bingpai[suit] ?? []).map((n: number, i: number) => (n > 0 ? `${suit}${i}` : null)),
    ).find(Boolean) as string | undefined;
    if (anyTile) game.discard(anyTile.replace(/([mps])0/, '$15'));

    const after = get2();
    const heAfter = [...(after.game.he.get(0)?._pai ?? [])];
    // ローカル河は増えていない [サーバー適用待ち]
    expect(heAfter.length).toBe(heBefore.length);
    expect(after.game.shoupai.get(0)?._zimo).toEqual(zimoBefore);
    // action 送信を試み、失敗後に resync を要求している
    expect(sendCalls.some((m) => m.type === 'action')).toBe(true);
    expect(sendCalls.some((m) => m.type === 'resync')).toBe(true);
  });
});
