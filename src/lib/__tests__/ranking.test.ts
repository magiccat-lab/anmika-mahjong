import { describe, it, expect } from 'vitest';
import { Game3 } from '../game3';

// getRanking の sort 安定性と rank 付与を unit 固定。
describe('Game3 getRanking', () => {
  it('defen 降順で sort + rank 1/2/3 付与', () => {
    const g = new Game3();
    g.qipai();
    g.state.defen = { 0: 30000, 1: 50000, 2: 20000 };
    const r = g.getRanking();
    expect(r[0].player).toBe(1);
    expect(r[0].rank).toBe(1);
    expect(r[1].player).toBe(0);
    expect(r[1].rank).toBe(2);
    expect(r[2].player).toBe(2);
    expect(r[2].rank).toBe(3);
  });

  it('全 player 同点 でも 3 件返却 + rank 1/2/3', () => {
    const g = new Game3();
    g.qipai();
    g.state.defen = { 0: 35000, 1: 35000, 2: 35000 };
    const r = g.getRanking();
    expect(r).toHaveLength(3);
    expect(r.map((x) => x.rank)).toEqual([1, 2, 3]);
  });

  it('マイナス点でも sort 正しい', () => {
    const g = new Game3();
    g.qipai();
    g.state.defen = { 0: -5000, 1: 50000, 2: 60000 };
    const r = g.getRanking();
    expect(r[0].player).toBe(2);
    expect(r[1].player).toBe(1);
    expect(r[2].player).toBe(0);
    expect(r[2].defen).toBe(-5000);
  });

  it('返却 array に player / defen / rank フィールドが全件存在', () => {
    const g = new Game3();
    g.qipai();
    const r = g.getRanking();
    for (const row of r) {
      expect(row.player).toBeTypeOf('number');
      expect(row.defen).toBeTypeOf('number');
      expect(row.rank).toBeTypeOf('number');
    }
  });
});
