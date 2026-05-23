import { describe, it, expect } from 'vitest';
import { Game3, buildShoupai } from '../game3';

describe('Game3 countDoraFromIndicator', () => {
  it('shoupai null / indicator 空 で 0', () => {
    const g = new Game3();
    g.qipai();
    const sp = buildShoupai(['p1','p2','p3']);
    expect(g.countDoraFromIndicator(null as any, 'p1')).toBe(0);
    expect(g.countDoraFromIndicator(sp, '')).toBe(0);
  });

  it('数牌: p1 indicator → p2 が ドラ、 p2 を 2 枚持ちで 2 カウント', () => {
    const g = new Game3();
    g.qipai();
    const sp = buildShoupai(['p2','p2','p3','p4','p5','p6','p7','p8','p9','s1','s2','s3','s4']);
    expect(g.countDoraFromIndicator(sp, 'p1')).toBe(2);
  });

  it('p9 indicator → 循環で p1 が ドラ', () => {
    const g = new Game3();
    g.qipai();
    const sp = buildShoupai(['p1','p1','p1','p2','p3','p4','p5','p6','s1','s2','s3','s4','s5']);
    expect(g.countDoraFromIndicator(sp, 'p9')).toBe(3);
  });

  it('字牌 1-4 循環: z4 indicator → z1 が ドラ', () => {
    const g = new Game3();
    g.qipai();
    const sp = buildShoupai(['z1','z1','p1','p2','p3','p4','p5','p6','s1','s2','s3','s4','s5']);
    expect(g.countDoraFromIndicator(sp, 'z4')).toBe(2);
  });

  it('字牌 5-7 循環: z7 indicator → z5 が ドラ', () => {
    const g = new Game3();
    g.qipai();
    const sp = buildShoupai(['z5','z5','p1','p2','p3','p4','p5','p6','s1','s2','s3','s4','s5']);
    expect(g.countDoraFromIndicator(sp, 'z7')).toBe(2);
  });

  it('金牌 indicator [gp/gs/gN] は通常牌に正規化される', () => {
    const g = new Game3();
    g.qipai();
    const sp = buildShoupai(['p6','p6','p1','p2','p3','p4','p5','s1','s2','s3','s4','s5','s6']);
    // gp [= p5 indicator] → p6 が ドラ
    expect(g.countDoraFromIndicator(sp, 'gp')).toBe(2);
  });

  it('色付き z5 indicator [z5b 等] は z5 として 正規化、 z6 が ドラ', () => {
    const g = new Game3();
    g.qipai();
    const sp = buildShoupai(['z6','z6','p1','p2','p3','p4','p5','s1','s2','s3','s4','s5','s6']);
    expect(g.countDoraFromIndicator(sp, 'z5b')).toBe(2);
  });

  it('華牌 indicator [f1-4] は ドラ計算外 0 [fix: s !== mpsz で 早期 return]', () => {
    const g = new Game3();
    g.qipai();
    const sp = buildShoupai(['p1','p2','p3','p4','p5','p6','p7','p8','p9','s1','s2','s3','s4']);
    expect(g.countDoraFromIndicator(sp, 'f1')).toBe(0);
    expect(g.countDoraFromIndicator(sp, 'f4')).toBe(0);
  });
});
