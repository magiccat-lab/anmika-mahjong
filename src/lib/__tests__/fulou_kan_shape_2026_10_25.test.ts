// [2026-10-25 リョー「カンの時の牌の表示の形変だよね。あんかんもかかんも」]
import { describe, expect, it } from 'vitest';
import { applyAnmikaFulouIdentity, fulouTileFaceDown, parseMianzi } from '../fulouDisplay';

describe('カンの見た目', () => {
  it('暗槓は両端の 2 枚を伏せる', () => {
    const m = parseMianzi('m1111');
    expect([0, 1, 2, 3].map((i) => fulouTileFaceDown(m, i))).toEqual([true, false, false, true]);
  });
  it('赤 5 の入った暗槓は赤を表の真ん中に寄せる', () => {
    const m = applyAnmikaFulouIdentity('p5550', parseMianzi('p5550'));
    expect(m.tiles).toEqual(['p5', 'p0', 'p5', 'p5']);
    const two = applyAnmikaFulouIdentity('s5500', parseMianzi('s5500'));
    expect(two.tiles).toEqual(['s5', 's0', 's0', 's5']);
  });
  it('加槓 ・ ポン ・ 大明槓は伏せない', () => {
    for (const s of ['m555+5', 'm555+', 'm5555-']) {
      const m = parseMianzi(s);
      expect(m.tiles.some((_, i) => fulouTileFaceDown(m, i)), s).toBe(false);
    }
    expect(parseMianzi('m555+5').kakanTile).toBe('m5');
  });
});
