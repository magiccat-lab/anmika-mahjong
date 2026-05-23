import { describe, expect, it } from 'vitest';
import { Game3, buildShoupai } from '../game3';
import type { PlayerId } from '../types';

describe('fuyu kami-pochi target selection', () => {
  function buildFuyuGame(huapai: string[], fuyuPai: string[]): Game3 {
    const g = new Game3();
    g.qipai();
    const winner = 0 as PlayerId;
    g.shoupai.set(winner, buildShoupai([]));
    g.huapai[winner] = [...huapai];
    (g.shan as any)._pai = [...fuyuPai];
    return g;
  }

  it('counts huapai as the positive z5 target during fuyu reveal', () => {
    const g = new Game3();
    g.qipai();
    const winner = 0 as PlayerId;
    g.shoupai.set(winner, buildShoupai(['p1','p2','p3','p4','p5','p6','p7','p8','p9','s1','s2','s3','m9']));
    g.huapai[winner] = ['f2', 'f2'];
    (g.shan as any)._pai = ['z5b'];

    g.applyFuyuChip(winner, null, 1, false);

    expect((g.shan as any)._fuyuRevealed).toEqual(['z5b']);
    expect(g.chipLedger[winner]).toBe(12);
    expect(g.chipLedger[1]).toBe(-6);
    expect(g.chipLedger[2]).toBe(-6);
  });

  for (const hua of ['f1', 'f2', 'f3', 'f4']) {
    it(`counts kami-pochi swap-produced ${hua} as one extra hua chip`, () => {
      const g = buildFuyuGame([hua], ['z5b']);
      const winner = 0 as PlayerId;

      g.applyFuyuChip(winner, null, 1, false);

      const fuyuEntry = g.chipBreakdown.find((e) => e.label?.startsWith('冬'));
      expect(fuyuEntry?.base).toBe(4);
      expect(g.chipLedger[winner]).toBe(8);
      expect(g.chipLedger[1]).toBe(-4);
      expect(g.chipLedger[2]).toBe(-4);
    });
  }

  it('counts two natural hua plus two kami-pochi swap-produced hua as four total hua chips', () => {
    const g = buildFuyuGame(['f1', 'f2'], ['z5g', 'z5b']);
    const winner = 0 as PlayerId;

    g.applyFuyuChip(winner, null, 1, false);

    const fuyuEntry = g.chipBreakdown.find((e) => e.label?.startsWith('冬'));
    expect(fuyuEntry?.base).toBe(8);
    expect(g.chipLedger[winner]).toBe(16);
    expect(g.chipLedger[1]).toBe(-8);
    expect(g.chipLedger[2]).toBe(-8);
  });
});
