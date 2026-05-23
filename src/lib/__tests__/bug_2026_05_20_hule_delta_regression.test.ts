import { describe, expect, it } from 'vitest';
import { Game3 } from '../game3';
import type { PlayerId } from '../types';

function freshGame(): Game3 {
  const g = new Game3();
  g.qipai();
  g.diyizimo = false;
  g.state.benbang = 0;
  g.state.lizhibang = 0;
  g.state.qijia = 0;
  g.state.jushu = 0;
  return g;
}

function lastHule(g: Game3): any {
  return [...g.events].reverse().find((e: any) => e.type === 'hule');
}

function defenDelta(g: Game3, before: Record<PlayerId, number>): [number, number, number] {
  return [0, 1, 2].map((p) => g.state.defen[p as PlayerId] - before[p as PlayerId]) as [number, number, number];
}

describe('bug 2026-05-20 hule event defen delta regression', () => {
  it('子ロン: event.delta は winner +ronPay / loser -ronPay / 他 0', () => {
    const g = freshGame();
    const before = { ...g.state.defen };
    g.applyHule({ fanshu: 2, fu: 30, hupai: [] }, 1 as PlayerId, 2 as PlayerId);

    expect(lastHule(g).delta).toEqual({ 0: 0, 1: 2000, 2: -2000 });
    expect(lastHule(g).delta).toEqual(Object.fromEntries(defenDelta(g, before).map((v, p) => [p, v])));
  });

  it('親ロン: event.delta は winner +6*base / loser -6*base', () => {
    const g = freshGame();
    g.applyHule({ fanshu: 4, fu: 30, hupai: [] }, 0 as PlayerId, 1 as PlayerId);

    expect(lastHule(g).delta).toEqual({ 0: 12000, 1: -12000, 2: 0 });
  });

  it('子ツモ: event.delta は親払い + 他子払いを合算する', () => {
    const g = freshGame();
    g.applyHule({ fanshu: 2, fu: 30, hupai: [] }, 1 as PlayerId, null);

    expect(lastHule(g).delta).toEqual({ 0: -2000, 1: 3500, 2: -1500 });
  });

  it('供託あり: lizhibang*1000 が winner gain に乗る', () => {
    const g = freshGame();
    g.state.lizhibang = 2;
    g.applyHule({ fanshu: 2, fu: 30, hupai: [] }, 1 as PlayerId, 2 as PlayerId);

    expect(lastHule(g).delta).toEqual({ 0: 0, 1: 4000, 2: -2000 });
    expect(g.state.lizhibang).toBe(0);
  });

  it('ダブロン: 各 hule event は個別 delta を持ち、後段 winner の before は前段適用後', () => {
    const g = freshGame();
    g.saveSnapshot();
    g.snapshotLocked = true;

    g.applyHule({ fanshu: 2, fu: 30, hupai: [] }, 1 as PlayerId, 0 as PlayerId);
    const afterFirst = { ...g.state.defen };
    g.applyHule({ fanshu: 3, fu: 30, hupai: [] }, 2 as PlayerId, 0 as PlayerId);

    const hules = g.events.filter((e: any) => e.type === 'hule') as any[];
    expect(hules).toHaveLength(2);
    expect(hules[0].delta).toEqual({ 0: -2000, 1: 2000, 2: 0 });
    expect(hules[1].defenBefore).toEqual(afterFirst);
    expect(hules[1].delta).toEqual({ 0: -3900, 1: 0, 2: 3900 });
  });

  it('金北 modal 経由: snapshotLocked 中の saveSnapshot は同一 hule の snapshot を上書きしない', () => {
    const g = freshGame();
    g.saveSnapshot();
    const originalSnapshotDefen = { ...g.preHuleSnapshot!.defen };
    g.snapshotLocked = true;

    g.applyHule({ fanshu: 2, fu: 30, hupai: [] }, 1 as PlayerId, 2 as PlayerId);
    g.saveSnapshot();

    expect(g.preHuleSnapshot!.defen).toEqual(originalSnapshotDefen);
    expect(lastHule(g).delta).toEqual({ 0: 0, 1: 2000, 2: -2000 });
  });
});
