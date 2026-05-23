import { describe, it, expect } from 'vitest';
import { Game3, buildShoupai } from '../game3';
import type { PlayerId } from '../types';

describe('z5 lifecycle audit 2026-05-21', () => {
  it('z5b 即ツモ + 祝儀 0 枚でも 白ぽっち即ツモサイコロを出す', () => {
    const winner = 0 as PlayerId;
    const g = new Game3({ qijia: 0, changshu: 1 });
    g.qipai();
    const sp = buildShoupai(['m1', 'm1', 'm1', 'p2', 'p3', 'p4', 's2', 's3', 's4', 'z1', 'z1', 'z1', 'z5b', 'z5b']);
    (sp as any)._zimo = 'z5b';
    g.shoupai.set(winner, sp);
    g.lastZimoInfo = { player: winner, pai: 'z5b', pochi: 'blue', gold: false };
    g.yifaActive[winner] = true;
    g.chipLedger = { 0: 0, 1: 0, 2: 0 };
    g.chipBreakdown = [];

    const result: any = { fanshu: 1, fu: 30, hupai: [] };
    g.applyHule(result, winner, null);

    expect(result.saiKoroChances).toContainEqual(expect.objectContaining({
      name: '白ぽっち即ツモ祝儀 0 枚',
      baseChip: 70,
      mode: 'tsumo',
    }));
  });
});
