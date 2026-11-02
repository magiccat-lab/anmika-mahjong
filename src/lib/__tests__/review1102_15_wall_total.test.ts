// [クラウドレビュー 11-02 #15] オンライン/画面リプレイで山の目盛りが減らない。
// hydrateProjectionState は投影のたびに新しい shan を作るので、shan の同一性で数え直すと
// total = 残り枚数 になり目盛りが一つも消えなかった。局の鍵で数え直す
import { describe, it, expect } from 'vitest';
import { nextWallTotal, type WallTotalState } from '../wallTotal';

describe('review1102 #15 wallTotal', () => {
  it('同じ局で残り枚数が減っても total は局の最大のまま (投影ごとに shan が替わっても)', () => {
    let s: WallTotalState = { roundKey: null, total: 0 };
    s = nextWallTotal(s, '0-0-0', 56);
    for (let p = 55; p >= 44; p--) s = nextWallTotal(s, '0-0-0', p);
    expect(s.total).toBe(56);
  });
  it('局が替わったら数え直す', () => {
    let s: WallTotalState = { roundKey: null, total: 0 };
    s = nextWallTotal(s, '0-0-0', 56);
    s = nextWallTotal(s, '0-0-0', 10);
    s = nextWallTotal(s, '0-1-0', 50);
    expect(s.total).toBe(50);
    s = nextWallTotal(s, '0-1-0', 40);
    expect(s.total).toBe(50);
  });
  it('途中から繋いだら残りより小さくならない', () => {
    let s: WallTotalState = { roundKey: null, total: 0 };
    s = nextWallTotal(s, '0-0-0', 30);
    s = nextWallTotal(s, '0-0-0', 35);
    expect(s.total).toBe(35);
  });
});
