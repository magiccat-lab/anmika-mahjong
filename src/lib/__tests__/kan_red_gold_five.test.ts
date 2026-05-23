import { describe, expect, it } from 'vitest';
import { Game3, buildShoupai } from '../game3';
import type { PlayerId } from '../types';

describe('5 tile kan candidates with red/gold markers', () => {
  it('keeps the core s5500 candidate instead of filtering it out', () => {
    const g = new Game3();
    g.qipai();
    const player = 0 as PlayerId;
    const sp = buildShoupai(['s5','s5','s0','s0','p1','p2','p3','p4','p5','p6','p7','p8','p9']);
    sp.zimo('z5');
    g.shoupai.set(player, sp);
    expect(g.getKanCandidates(player)).toContain('s5500');
  });
});
