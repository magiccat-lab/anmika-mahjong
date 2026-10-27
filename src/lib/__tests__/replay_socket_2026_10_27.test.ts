// [2026-10-27 修] 対局画面の牌譜再生 [ReplaySocket]。局の見出し ・ 飛んだ先の盤面 ・ 流す順 ・ 送られた物の扱いを見る
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ReplaySocket, replayRounds, syncAt, type ReplayFrame } from '../replaySocket';

const state = (changbang: number, jushu: number, benbang: number, tag: string) => ({ gameState: { changbang, jushu, benbang }, tag });
const action = (revision: number, type: string, at: string, st: any): ReplayFrame => ({
  at,
  msg: { type: 'action', revision, matchId: 3, roundId: 1, recipientRoomSeat: 1, activeMapping: null, roomChipLedger: { '0': revision }, action: { type, _state: st } },
});
const FRAMES: ReplayFrame[] = [
  { at: '2026-10-26T12:00:00.000Z', msg: { type: 'sync', recipientRoomSeat: 1, snapshot: { revision: 10, matchId: 3, state: state(0, 0, 0, 'start') } } },
  action(11, 'dapai', '2026-10-26T12:00:01.000Z', state(0, 0, 0, 'a')),
  { at: '2026-10-26T12:00:01.500Z', msg: { type: 'stamp' } },
  action(12, 'nextRound', '2026-10-26T12:00:30.000Z', state(0, 1, 1, 'b')),
  action(13, 'dapai', '2026-10-26T12:00:31.000Z', state(0, 1, 1, 'c')),
];

describe('replayRounds', () => {
  it('最初の sync と nextRound の所が局の頭', () => {
    expect(replayRounds(FRAMES)).toEqual([{ index: 0, label: '東1局' }, { index: 3, label: '東2局 1本場' }]);
  });
  it('試合の終わりの nextRound [最後の frame] は局にしない', () => {
    expect(replayRounds(FRAMES.slice(0, 4))).toEqual([{ index: 0, label: '東1局' }]);
  });
});

describe('syncAt', () => {
  it('その手を受けた後の投影と revision ・ 部屋チップで sync を作る', () => {
    const msg = syncAt(FRAMES, 2);
    expect(msg.type).toBe('sync');
    expect(msg.snapshot.revision).toBe(11);
    expect(msg.snapshot.state.tag).toBe('a');
    expect(msg.snapshot.roomChipLedger).toEqual({ '0': 11 });
  });
  it('頭は最初の sync そのまま', () => {
    expect(syncAt(FRAMES, 0)).toBe(FRAMES[0].msg);
  });
});

describe('ReplaySocket', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  function open(opts: ConstructorParameters<typeof ReplaySocket>[1] = {}) {
    const got: any[] = [];
    const socket = new ReplaySocket(FRAMES, opts);
    socket.onmessage = (ev) => got.push(JSON.parse(ev.data));
    return { socket, got };
  }

  it('開いたら頭の sync と最初の手を出し、後は記録の間合い [長考は 4 秒まで] で順に流す', () => {
    const { socket, got } = open();
    vi.advanceTimersToNextTimer();
    vi.advanceTimersToNextTimer();
    expect(socket.readyState).toBe(1);
    expect(got.map((m) => m.type)).toEqual(['sync', 'action']);
    expect(got.at(-1).revision).toBe(11);
    vi.advanceTimersByTime(499);
    expect(got.length).toBe(2);
    vi.advanceTimersByTime(1);
    expect(got.at(-1).type).toBe('stamp');
    // 次の局へ進む手の前は 8 秒まで待つ [和了 ・ 精算の板を読む間]
    vi.advanceTimersByTime(7999);
    expect(got.length).toBe(3);
    vi.advanceTimersByTime(1);
    expect(got.at(-1).revision).toBe(12);
    vi.advanceTimersByTime(1000);
    expect(got.at(-1).revision).toBe(13);
    expect(socket.playing).toBe(false);
  });

  it('演出の最中 [busy] は次を待つ', () => {
    let busy = true;
    const { got } = open({ busy: () => busy });
    vi.advanceTimersByTime(5000);
    expect(got.length).toBe(1);
    expect(got[0].type).toBe('sync');
    busy = false;
    vi.advanceTimersByTime(200);
    expect(got.at(-1).revision).toBe(11);
  });

  it('seek はその所の sync を出して、次の手から続ける。resync には今の所の sync を返す', () => {
    const { socket, got } = open({ autoplay: false });
    vi.advanceTimersByTime(0);
    socket.seek(3);
    expect(got.at(-1).snapshot.state.tag).toBe('b');
    socket.step();
    expect(got.at(-1).revision).toBe(13);
    socket.send(JSON.stringify({ type: 'dapai' }));
    vi.advanceTimersByTime(0);
    expect(got.at(-1).revision).toBe(13);
    socket.send(JSON.stringify({ type: 'resync' }));
    vi.advanceTimersByTime(0);
    expect(got.at(-1).type).toBe('sync');
    expect(got.at(-1).snapshot.state.tag).toBe('c');
  });

  it('2 倍速は間合いが半分', () => {
    const { socket, got } = open({ autoplay: false });
    vi.advanceTimersByTime(0);
    socket.setSpeed(2);
    socket.play();
    vi.advanceTimersByTime(0);
    expect(got.at(-1).revision).toBe(11);
    vi.advanceTimersByTime(250);
    expect(got.at(-1).type).toBe('stamp');
    vi.advanceTimersByTime(4000);
    expect(got.at(-1).revision).toBe(12);
  });

  it('stopAt の手前で止まる', () => {
    const { socket, got } = open({ stopAt: 3 });
    vi.advanceTimersByTime(60_000);
    expect(got.at(-1).type).toBe('stamp');
    expect(socket.playing).toBe(false);
    expect(socket.index).toBe(3);
  });
});
