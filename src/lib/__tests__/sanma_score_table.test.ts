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

describe('sanma fixed high-score table', () => {
  it('5x ron: child 40000, dealer 60000', () => {
    const child = freshGame();
    let before = { ...child.state.defen };
    child.applyHule({ fanshu: 18, fu: 30, hupai: [] }, 1 as PlayerId, 0 as PlayerId);
    expect(child.state.defen[1] - before[1]).toBe(40000);
    expect(child.state.defen[0] - before[0]).toBe(-40000);

    const dealer = freshGame();
    before = { ...dealer.state.defen };
    dealer.applyHule({ fanshu: 18, fu: 30, hupai: [] }, 0 as PlayerId, 1 as PlayerId);
    expect(dealer.state.defen[0] - before[0]).toBe(60000);
    expect(dealer.state.defen[1] - before[1]).toBe(-60000);
  });

  it('5x tsumo: child 11000-21000, dealer 21000 all', () => {
    const child = freshGame();
    let before = { ...child.state.defen };
    child.applyHule({ fanshu: 18, fu: 30, hupai: [] }, 1 as PlayerId, null);
    expect(child.state.defen[1] - before[1]).toBe(32000);
    expect(child.state.defen[0] - before[0]).toBe(-21000);
    expect(child.state.defen[2] - before[2]).toBe(-11000);

    const dealer = freshGame();
    before = { ...dealer.state.defen };
    dealer.applyHule({ fanshu: 18, fu: 30, hupai: [] }, 0 as PlayerId, null);
    expect(dealer.state.defen[0] - before[0]).toBe(42000);
    expect(dealer.state.defen[1] - before[1]).toBe(-21000);
    expect(dealer.state.defen[2] - before[2]).toBe(-21000);
  });

  it('6x ron: child 48000, dealer 72000', () => {
    const child = freshGame();
    let before = { ...child.state.defen };
    child.applyHule({ fanshu: 24, fu: 30, hupai: [] }, 1 as PlayerId, 0 as PlayerId);
    expect(child.state.defen[1] - before[1]).toBe(48000);
    expect(child.state.defen[0] - before[0]).toBe(-48000);

    const dealer = freshGame();
    before = { ...dealer.state.defen };
    dealer.applyHule({ fanshu: 24, fu: 30, hupai: [] }, 0 as PlayerId, 1 as PlayerId);
    expect(dealer.state.defen[0] - before[0]).toBe(72000);
    expect(dealer.state.defen[1] - before[1]).toBe(-72000);
  });

  it('6x tsumo: child 13000-25000, dealer 25000 all', () => {
    const child = freshGame();
    let before = { ...child.state.defen };
    child.applyHule({ fanshu: 24, fu: 30, hupai: [] }, 1 as PlayerId, null);
    expect(child.state.defen[1] - before[1]).toBe(38000);
    expect(child.state.defen[0] - before[0]).toBe(-25000);
    expect(child.state.defen[2] - before[2]).toBe(-13000);

    const dealer = freshGame();
    before = { ...dealer.state.defen };
    dealer.applyHule({ fanshu: 24, fu: 30, hupai: [] }, 0 as PlayerId, null);
    expect(dealer.state.defen[0] - before[0]).toBe(50000);
    expect(dealer.state.defen[1] - before[1]).toBe(-25000);
    expect(dealer.state.defen[2] - before[2]).toBe(-25000);
  });
});
