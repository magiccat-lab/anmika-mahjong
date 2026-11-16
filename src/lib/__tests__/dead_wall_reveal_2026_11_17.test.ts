// [2026-11-17 isg. 通報 20261117_1「この後の上がり時にツモが見えるなら、透明化のため王牌も出してほしい」]
// 局が終わった後、「この後のツモ」と同じ時だけ王牌 [嶺上の残り ・ 表ドラ表示 ・ 裏ドラ表示] を全員の投影に載せる。
import { describe, expect, it } from 'vitest';

import { createRoomAuthority } from '../../../server/authority';
import { computeDeadWallReveal } from '../../../server/next_draws';
import { captureSeatProjection } from '../../../server/ws_server';
import { createGameStore } from '../store';
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

function fresh() {
  const authority = createRoomAuthority({ preShuffledPool: pool(), qijia: 0, changshu: 1 });
  const state: any = authority.canonicalState();
  return { authority, state, shan: state.game.shan as any };
}

function endWithTsumo(state: any, winner: 0 | 1 | 2) {
  state.roundEnded = true;
  state.lastWinner = winner;
  state.lastHuleResult = { fanshu: 1 };
  state.ronResults = [];
  state.ronDeclaredPlayers = [];
}

describe('局の後の王牌', () => {
  it('局の途中は誰にも載せない', () => {
    const { authority } = fresh();
    for (const seat of [-1, 0, 1, 2]) {
      expect(captureSeatProjection(authority, seat), String(seat)).not.toHaveProperty('deadWall');
    }
  });

  it('局が終わったら全員に嶺上 ・ 表ドラ表示 ・ 裏ドラ表示の現物を全部載せる [裏はリーチ無しでも]', () => {
    const { authority, state, shan } = fresh();
    endWithTsumo(state, 0);
    const expected = {
      rinshan: [...shan._rinshan],
      baopai: [...shan._baopai],
      fubaopai: [...(shan._fubaopai ?? [])],
    };
    // 配牌の華の補充で嶺上は 16 から減っている事がある
    expect(expected.rinshan.length).toBe(16 - shan.rinshanUsed);
    expect(expected.baopai.length).toBe(2);
    for (const seat of [-1, 0, 1, 2]) {
      const p: any = captureSeatProjection(authority, seat);
      expect(p.deadWall, String(seat)).toEqual(expected);
      expect(p).toHaveProperty('nextDraws');
    }
    // 王牌と生きている山 [この後のツモ] は重ならず、合わせて局の始めの山の全部
    const p: any = captureSeatProjection(authority, -1);
    const shown = [
      ...[0, 1, 2].flatMap((s) => p.nextDraws[s]),
      ...p.deadWall.rinshan, ...p.deadWall.baopai, ...p.deadWall.fubaopai,
    ];
    expect(shown.length).toBe(shan.paishu + expected.rinshan.length + expected.baopai.length + expected.fubaopai.length);
  });

  it('嶺上を使った分は減り、カンでめくったドラ表示は増えて出る', () => {
    const { state, shan } = fresh();
    const before = shan._rinshan.length;
    const second = shan._rinshan[1];
    shan._rinshan.shift();
    shan.consumeRinshan();
    shan.drawNewDora(false);
    shan.drawNewDora(true);
    endWithTsumo(state, 1);
    const dw = computeDeadWallReveal(state)!;
    expect(dw.rinshan.length).toBe(before - 1);
    expect(dw.rinshan[0]).toBe(second);
    expect(dw.baopai.length).toBe(3);
    expect(dw.fubaopai.length).toBe(shan._fubaopai.length);
  });

  it('選択待ち ・ フィーバー続行待ちの間は載せない', () => {
    const { authority, state } = fresh();
    endWithTsumo(state, 0);
    for (const key of ['pendingFuyu', 'pendingKinpei', 'pendingKamiPochi', 'pendingPochiSwap', 'pendingFeverContinue']) {
      state[key] = { winner: 0 };
      expect(captureSeatProjection(authority, 0), key).not.toHaveProperty('deadWall');
      state[key] = null;
    }
  });

  it('打ち手の store が受け取り、局が進めば消える', () => {
    const { authority, state, shan } = fresh();
    const game = createGameStore();
    const start = captureSeatProjection(authority, 0);
    game.initOnlineGame({
      ws: { readyState: 0, send() {} } as unknown as WebSocket,
      qijia: 0,
      mySeat: 0,
      blindStart: { hands: { 0: [], 1: [], 2: [] }, firstZimo: '', paishu: start.shan.paishu, baopai: start.shan.baopai, fubaopai: null },
    } as any);
    let current: any;
    endWithTsumo(state, 1);
    expect(game.hydrateOnlineProjection(captureSeatProjection(authority, 0))).toBe(true);
    game.subscribe((s: any) => { current = s; })();
    expect(current.spectatorDeadWall).toEqual({
      rinshan: [...shan._rinshan], baopai: [...shan._baopai], fubaopai: [...(shan._fubaopai ?? [])],
    });
    state.roundEnded = false;
    state.lastWinner = null;
    state.lastHuleResult = null;
    expect(game.hydrateOnlineProjection(captureSeatProjection(authority, 0))).toBe(true);
    game.subscribe((s: any) => { current = s; })();
    expect(current.spectatorDeadWall).toBeNull();
  });
});
