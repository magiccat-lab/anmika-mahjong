import { get } from 'svelte/store';
import { describe, expect, it } from 'vitest';
import { createRoomAuthority } from '../../../server/authority';
import { captureSeatProjection } from '../../../server/ws_server';
import { createGameStore } from '../store';
import { defaultSanmaRule, generateTilePool } from '../shan3';

// [2026-10-09 遊真 A3] 「次の試合へ」は席に座っている全員が送れる [旧: host の client だけ]。
// 観戦 [席なし] だけ止める。試合結果の保存は server 側になったので client は POST しない

function finishedAuthority() {
  const a = createRoomAuthority({ preShuffledPool: generateTilePool(defaultSanmaRule()).map(String), qijia: 0 });
  const state = a.canonicalState();
  state.game.state.finished = true;
  state.roundEnded = true;
  state.game.state.defen[0] = 41000;
  state.game.state.defen[1] = 25000;
  state.game.state.defen[2] = 9000;
  return a;
}

function clientAt(seat: 0 | 1 | 2, opts: { isHost: boolean; spectator?: boolean }) {
  const a = finishedAuthority();
  const projection: any = captureSeatProjection(a, seat);
  const sent: any[] = [];
  const ws = { readyState: 1, send: (raw: string) => { sent.push(JSON.parse(raw)); } } as unknown as WebSocket;
  const game = createGameStore();
  game.initOnlineGame({
    ws,
    qijia: 0,
    mySeat: seat,
    isHost: opts.isHost,
    spectator: opts.spectator,
    blindStart: {
      hands: { 0: [], 1: [], 2: [] },
      firstZimo: '',
      paishu: projection.shan.paishu,
      baopai: projection.shan.baopai,
      fubaopai: null,
    },
  });
  expect(game.hydrateOnlineProjection(projection)).toBe(true);
  expect((get(game) as any).game.state.finished).toBe(true);
  return { game, sent };
}

describe('A3: online の nextMatch を送れる人', () => {
  it('host でない席 [seat 1] も nextMatch を server に送る', () => {
    const { game, sent } = clientAt(1, { isHost: false });
    game.nextMatch({ finalize: true, resetChip: false });
    const actions = sent.filter((m) => m.type === 'action' && m.action?.type === 'nextMatch');
    expect(actions).toHaveLength(1);
    expect(actions[0].action.finalize).toBe(true);
  });

  it('host の席も従来どおり送る', () => {
    const { game, sent } = clientAt(0, { isHost: true });
    game.nextMatch({ finalize: false, resetChip: true });
    const actions = sent.filter((m) => m.type === 'action' && m.action?.type === 'nextMatch');
    expect(actions).toHaveLength(1);
    expect(actions[0].action.resetChip).toBe(true);
  });

  it('観戦 [spectator] は送らない', () => {
    const { game, sent } = clientAt(2, { isHost: false, spectator: true });
    game.nextMatch({ finalize: true, resetChip: false });
    expect(sent.filter((m) => m.type === 'action')).toHaveLength(0);
  });

  it('切断して入り直した後は spectator の印を引きずらない', () => {
    const first = clientAt(2, { isHost: false, spectator: true });
    first.game.disconnectOnline();
    const second = clientAt(2, { isHost: false });
    second.game.nextMatch({ finalize: true, resetChip: false });
    expect(second.sent.filter((m) => m.type === 'action' && m.action?.type === 'nextMatch')).toHaveLength(1);
  });
});
