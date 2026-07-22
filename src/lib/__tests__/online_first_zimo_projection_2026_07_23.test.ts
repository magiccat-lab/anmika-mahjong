// [2026-07-23 Sol調査C P0] 第一ツモの canonical / projection / hydrate 不変条件
//
// 実障害: 試合開始直後 [nextMatch 後] に client 側だけ親の第一ツモが欠けて
// 「ツモを進めてください」で停止した。authority 起点 → projection → hydrate の
// どの層でも第一ツモが落ちない事を、局開始直後と nextMatch 後の両方で固定する。
import { get } from 'svelte/store';
import { describe, expect, it } from 'vitest';
import { createRoomAuthority } from '../../../server/authority';
import { captureSeatProjection } from '../../../server/ws_server';
import { createGameStore } from '../store';
import { defaultSanmaRule, generateTilePool } from '../shan3';

function pool(): string[] {
  return generateTilePool(defaultSanmaRule()).map(String);
}

function hydrateClient(seat: 0 | 1 | 2, projection: any) {
  const client = createGameStore();
  client.initOnlineGame({
    ws: { readyState: 0, send() {} } as unknown as WebSocket,
    qijia: (projection.gameState?.qijia ?? 0) as 0 | 1 | 2,
    mySeat: seat,
    blindStart: {
      hands: { 0: [], 1: [], 2: [] },
      firstZimo: '',
      paishu: projection.shan.paishu,
      baopai: projection.shan.baopai,
      fubaopai: null,
    },
  });
  const ok = client.hydrateOnlineProjection(projection);
  return { ok, state: get(client) as any };
}

describe('first zimo canonical/projection invariants [2026-07-23]', () => {
  it('局開始直後: canonical に親の第一ツモがあり、親席 client は hydrate 後に needsZimo にならない', () => {
    const authority = createRoomAuthority({ preShuffledPool: pool(), qijia: 0 });
    const dealer = authority.currentPlayer();
    const canonical: any = authority.canonicalState();

    // canonical invariant [ここが欠けると「ツモを進めてください」停止の起点]
    const canonicalZimo = canonical.game.shoupai.get(dealer)?._zimo;
    expect(canonicalZimo).toBeTruthy();
    expect(authority.lastZimo).not.toBeNull();
    expect(authority.game.shoupai.get(dealer)?._zimo).toBe(canonicalZimo);

    // 親席 projection → hydrate roundtrip
    const projection: any = captureSeatProjection(authority, dealer);
    expect(projection.privateHand?.zimo).toBe(canonicalZimo);
    const { ok, state } = hydrateClient(dealer, projection);
    expect(ok).toBe(true);
    const ownZimo = state.game.shoupai.get(dealer)?._zimo;
    expect(ownZimo).toBe(canonicalZimo);
    // needsZimo 相当 [App.svelte: 手番一致 + _zimo == null で停止] にならない事
    expect(state.game.lunbanToPlayerId(state.game.state.lunban)).toBe(dealer);
    expect(ownZimo != null).toBe(true);
  });

  it('非親席 client には親の実ツモ牌が漏れない [hidden marker のみ]', () => {
    const authority = createRoomAuthority({ preShuffledPool: pool(), qijia: 0 });
    const dealer = authority.currentPlayer();
    const realZimo = authority.game.shoupai.get(dealer)?._zimo;
    expect(realZimo).toBeTruthy();
    for (const seat of ([0, 1, 2] as const).filter((s) => s !== dealer)) {
      const { ok, state } = hydrateClient(seat, captureSeatProjection(authority, seat));
      expect(ok).toBe(true);
      const dealerSp = state.game.shoupai.get(dealer);
      // 実牌そのものは絶対に見えない [marker か null]
      expect(dealerSp?._zimo).not.toBe(realZimo);
    }
  });

  it('nextMatch 後 [回り親 qijia=1]: 新しい親に第一ツモが配られ、全3席の hydrate が通る', () => {
    const authority = createRoomAuthority({ preShuffledPool: pool(), qijia: 0 });
    const canonical: any = authority.canonicalState();
    // フル対局は再現せず、applyNextMatch の gate [canonical finished] を満たす最小状態を作る
    canonical.game.state.finished = true;
    canonical.roundEnded = true;
    authority.roundEnded = true;
    (authority.game.state as any).finished = true;

    const err = authority.validateAndApply(0, {
      type: 'nextMatch',
      preShuffledPool: pool(),
      qijia: 1,
      resetChip: false,
      finalize: true,
      cpuSeats: [],
    });
    expect(err).toBeNull();

    const after: any = authority.canonicalState();
    expect(after.game.state.qijia).toBe(1);
    expect(after.game.state.finished).toBeFalsy();
    const dealer = authority.currentPlayer();
    const newZimo = after.game.shoupai.get(dealer)?._zimo;
    expect(newZimo).toBeTruthy();
    expect(authority.game.shoupai.get(dealer)?._zimo).toBe(newZimo);

    for (const seat of [0, 1, 2] as const) {
      const { ok, state } = hydrateClient(seat, captureSeatProjection(authority, seat));
      expect(ok).toBe(true);
      if (seat === dealer) {
        expect(state.game.shoupai.get(dealer)?._zimo).toBe(newZimo);
        expect(state.game.lunbanToPlayerId(state.game.state.lunban)).toBe(dealer);
      } else {
        expect(state.game.shoupai.get(dealer)?._zimo).not.toBe(newZimo);
      }
    }
  });
});
