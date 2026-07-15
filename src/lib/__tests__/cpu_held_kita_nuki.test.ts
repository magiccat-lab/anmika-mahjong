// 2026-07-16 リョー指示: CPU が配牌由来で手牌に抱えた北 [z4] を抜かずに滞留させていた。
// cpuStep が手牌の北も declareNukiBei で抜くことを固定する。
import { describe, it, expect, beforeEach } from 'vitest';
import { get } from 'svelte/store';
import { game } from '../store';
import { buildShoupai } from '../game3';

describe('CPU 手牌滞留の北抜き', () => {
  beforeEach(() => {
    game.reset();
  });

  it('配牌の z4 を持つ CPU は手番で北を抜く', () => {
    const s: any = get(game);
    const cur = s.game.lunbanToPlayerId(s.game.state.lunban);
    s.cpu[cur] = true;
    s.game.shoupai.set(cur, buildShoupai([
      'z4',
      'p2', 'p3', 'p4',
      'p5', 'p6', 'p7',
      's2', 's3', 's4',
      's5', 's6',
      'm2',
    ]));
    (s.game.shoupai.get(cur) as any).zimo('m3');
    s.lastZimo = 'm3';
    const before = s.game.nukidora[cur] ?? 0;
    game.cpuStep();
    const after: any = get(game);
    expect(after.game.nukidora[cur]).toBeGreaterThan(before);
    expect(after.game.shoupai.get(cur)?._bingpai?.z?.[4] ?? 0).toBe(0);
  });
});
