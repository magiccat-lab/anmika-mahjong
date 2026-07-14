import { describe, expect, it } from 'vitest';
import { isFeverWaitExhausted } from '../game3/feverLizhi';

function hand(
  bingpai: Record<string, number[]>,
  goldHand?: { p: number; s: number; z: number },
): any {
  return { _bingpai: bingpai, _fulou: [], _goldHand: goldHand };
}

describe('WSA-A3 fever wait visible-five counting', () => {
  it('does not count a red five twice when it is already included in bingpai[5]', () => {
    const players = new Map([[0, hand({ p: [1, 0, 0, 0, 0, 3] })]]);

    expect(isFeverWaitExhausted(['p5'], players, new Map(), [])).toBe(false);
  });

  it('does not count a gold five twice when it is already included in bingpai[5]', () => {
    const players = new Map([
      [0, hand({ s: [0, 0, 0, 0, 0, 3] }, { p: 0, s: 1, z: 0 })],
    ]);

    expect(isFeverWaitExhausted(['s5'], players, new Map(), [])).toBe(false);
  });

  it('keeps all four colored white fives in the shared z5 denominator', () => {
    const rivers = new Map([[0, { _pai: ['z5b', 'z5r', 'z5g'] }]]);

    expect(isFeverWaitExhausted(['z5'], new Map(), rivers, [])).toBe(false);
    expect(isFeverWaitExhausted(['z5'], new Map(), rivers, ['z5y'])).toBe(true);
  });
});
