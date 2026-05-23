import { describe, expect, it } from 'vitest';
import { buildShoupai } from '../game3';
import { canTsumoWithPochiSwap } from '../game3/tingpai';

describe('pochi allmighty American chitoi', () => {
  it('allows z5 to swap into the missing pair of an American chitoi hand', () => {
    const sp = buildShoupai(['p1','p1','p1','p1','p2','p2','p3','p3','p4','p4','p5','p5','p6']);
    sp.zimo('z5');
    expect(canTsumoWithPochiSwap(sp)).toBe(true);
  });
});
