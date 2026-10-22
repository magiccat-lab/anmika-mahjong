// [2026-10-22 リョー「観戦モードに限りそのあとのそれぞれのツモ見れるようにするとかできない？」]
// 局が終わったあと、観戦 [seat -1、抜け番も同じ投影] にだけ「続けたら各席が引いたはずの牌」を送る。
// 打ち手 [0-2] には局の途中も終わった後も送らない。観戦でも局の途中は送らない。
import { describe, expect, it } from 'vitest';

import { createRoomAuthority } from '../../../server/authority';
import { computeSpectatorNextDraws, nextSeatInTurnOrder } from '../../../server/next_draws';
import { captureSeatProjection } from '../../../server/ws_server';
import { createGameStore } from '../store';
import { defaultSanmaRule, generateTilePool } from '../shan3';

function pool(): string[] {
  const tiles = generateTilePool(defaultSanmaRule());
  let seed = 11;
  for (let i = tiles.length - 1; i > 0; i -= 1) {
    seed = (seed * 1103515245 + 12345) % 2147483648;
    const j = seed % (i + 1);
    [tiles[i], tiles[j]] = [tiles[j], tiles[i]];
  }
  return tiles;
}

function fresh() {
  const authority = createRoomAuthority({ preShuffledPool: pool(), qijia: 0, changshu: 1 });
  const state: any = authority.canonicalState();
  const live: string[] = [...(state.game.shan as any)._pai];
  return { authority, state, live };
}

/** 局が終わった形を直接作る [実際の和了の評価は本題でない。山の残りと手番だけ見る] */
function endWithTsumo(state: any, winner: 0 | 1 | 2) {
  state.roundEnded = true;
  state.lastWinner = winner;
  state.lastHuleResult = { fanshu: 1 };
  state.ronResults = [];
  state.ronDeclaredPlayers = [];
}
function endWithRon(state: any, winner: 0 | 1 | 2, discarder: 0 | 1 | 2) {
  state.roundEnded = true;
  state.lastWinner = winner;
  state.lastHuleResult = { fanshu: 1 };
  state.lastDapai = { player: discarder, pai: 'm1' };
  state.ronResults = [{ player: winner, result: { fanshu: 1 } }];
  state.ronDeclaredPlayers = [winner];
}

/** 山の末尾から [通常ツモは pop] 並べ直した期待値 */
function expectedDraws(live: string[], first: number): Record<number, string[]> {
  const out: Record<number, string[]> = { 0: [], 1: [], 2: [] };
  let seat = first;
  for (let i = live.length - 1; i >= 0; i -= 1) {
    out[seat].push(live[i]);
    seat = (seat + 2) % 3;
  }
  return out;
}

describe('観戦の「この後のツモ」', () => {
  it('手番は席番号の降順 [P0 → P2 → P1]', () => {
    expect(nextSeatInTurnOrder(0)).toBe(2);
    expect(nextSeatInTurnOrder(2)).toBe(1);
    expect(nextSeatInTurnOrder(1)).toBe(0);
  });

  it('ツモ和了: 和了者の次の席から、生きている山の末尾 → 先頭の順に配る', () => {
    for (const winner of [0, 1, 2] as const) {
      const { authority, state, live } = fresh();
      endWithTsumo(state, winner);
      const projection: any = captureSeatProjection(authority, -1);
      expect(projection.nextDraws).toEqual(expectedDraws(live, (winner + 2) % 3));
      const total = [0, 1, 2].reduce((n, seat) => n + projection.nextDraws[seat].length, 0);
      expect(total).toBe(live.length);
      // 王牌 [嶺上 ・ ドラ表] は含まない
      const shan: any = state.game.shan;
      expect(total).toBe(shan.paishu);
    }
  });

  it('ロン: 放銃者の次の席から配る [和了者の次ではない]', () => {
    const { authority, state, live } = fresh();
    // 和了者 1、放銃者 0 → 放銃者の次 = 2 [和了者の次なら 0]
    endWithRon(state, 1, 0);
    const projection: any = captureSeatProjection(authority, -1);
    expect(projection.nextDraws).toEqual(expectedDraws(live, 2));
    expect(projection.nextDraws).not.toEqual(expectedDraws(live, 0));
    expect(projection.nextDraws[2][0]).toBe(live[live.length - 1]);
    expect(projection.nextDraws[1][0]).toBe(live[live.length - 2]);
    expect(projection.nextDraws[0][0]).toBe(live[live.length - 3]);
  });

  it('ツモ和了で前の打牌が残っていても、和了者の次から [前の打牌者を使わない]', () => {
    const { authority, state, live } = fresh();
    endWithTsumo(state, 2);
    state.lastDapai = { player: 0, pai: 'm1' };
    const projection: any = captureSeatProjection(authority, -1);
    expect(projection.nextDraws).toEqual(expectedDraws(live, 1));
  });

  it('流局で山が残っていれば最後に打った人の次から、山が空なら各席とも空', () => {
    const { authority, state, live } = fresh();
    state.pendingPingju = true;
    state.lastWinner = null;
    state.lastDapai = { player: 1, pai: 'm1' };
    expect((captureSeatProjection(authority, -1) as any).nextDraws).toEqual(expectedDraws(live, 0));
    (state.game.shan as any)._pai = [];
    expect((captureSeatProjection(authority, -1) as any).nextDraws).toEqual({ 0: [], 1: [], 2: [] });
  });

  it('打ち手 [席 0-2] には局が終わった後も key ごと送らない', () => {
    const { authority, state } = fresh();
    endWithTsumo(state, 0);
    for (const seat of [0, 1, 2]) {
      const projection: any = captureSeatProjection(authority, seat);
      expect(projection).not.toHaveProperty('nextDraws');
      expect(JSON.stringify(projection)).not.toContain('nextDraws');
    }
    endWithRon(state, 1, 0);
    for (const seat of [0, 1, 2]) {
      expect(captureSeatProjection(authority, seat)).not.toHaveProperty('nextDraws');
    }
    state.roundEnded = false;
    state.pendingPingju = true;
    state.lastWinner = null;
    for (const seat of [0, 1, 2]) {
      expect(captureSeatProjection(authority, seat)).not.toHaveProperty('nextDraws');
    }
  });

  it('観戦でも局の途中は送らない [打牌中 ・ ロン待ち ・ 選択待ち ・ フィーバー続行待ち]', () => {
    const { authority, state } = fresh();
    expect(captureSeatProjection(authority, -1)).not.toHaveProperty('nextDraws');
    endWithTsumo(state, 0);
    expect(captureSeatProjection(authority, -1)).toHaveProperty('nextDraws');
    state.awaitingRonDecision = true;
    expect(captureSeatProjection(authority, -1)).not.toHaveProperty('nextDraws');
    state.awaitingRonDecision = false;
    for (const key of ['pendingFuyu', 'pendingKinpei', 'pendingKamiPochi', 'pendingPochiSwap', 'pendingFeverContinue']) {
      state[key] = { winner: 0 };
      expect(captureSeatProjection(authority, -1), key).not.toHaveProperty('nextDraws');
      state[key] = null;
    }
    expect(captureSeatProjection(authority, -1)).toHaveProperty('nextDraws');
  });

  it('保存される state には何も足さない [投影の時に導出するだけ]', () => {
    const { state } = fresh();
    endWithTsumo(state, 0);
    expect(computeSpectatorNextDraws(state)).not.toBeNull();
    expect(Object.keys(state)).not.toContain('nextDraws');
    expect(Object.keys(state.game)).not.toContain('nextDraws');
  });
});

describe('観戦の画面 [store]', () => {
  function spectatorStore(projection: any) {
    const game = createGameStore();
    game.initOnlineGame({
      ws: { readyState: 0, send() {} } as unknown as WebSocket,
      qijia: 0,
      mySeat: undefined,
      spectator: true,
      blindStart: { hands: { 0: [], 1: [], 2: [] }, firstZimo: '', paishu: projection.shan.paishu, baopai: projection.shan.baopai, fubaopai: null },
    } as any);
    return game;
  }

  it('観戦の store は nextDraws を受け取り、局が進めば消える', () => {
    const { authority, state, live } = fresh();
    const game = spectatorStore(captureSeatProjection(authority, -1));
    let current: any;
    game.subscribe((s: any) => { current = s; })();
    expect(game.hydrateOnlineProjection(captureSeatProjection(authority, -1))).toBe(true);
    game.subscribe((s: any) => { current = s; })();
    expect(current.spectatorNextDraws).toBeNull();

    endWithTsumo(state, 1);
    expect(game.hydrateOnlineProjection(captureSeatProjection(authority, -1))).toBe(true);
    game.subscribe((s: any) => { current = s; })();
    expect(current.spectatorNextDraws).toEqual(expectedDraws(live, 0));

    state.roundEnded = false;
    state.lastWinner = null;
    state.lastHuleResult = null;
    state.ronResults = [];
    expect(game.hydrateOnlineProjection(captureSeatProjection(authority, -1))).toBe(true);
    game.subscribe((s: any) => { current = s; })();
    expect(current.spectatorNextDraws).toBeNull();
  });

  it('旧 server の投影 [nextDraws なし] でも観戦の store は壊れない', () => {
    const { authority } = fresh();
    const projection: any = captureSeatProjection(authority, -1);
    const game = spectatorStore(projection);
    expect(game.hydrateOnlineProjection(projection)).toBe(true);
  });
});
