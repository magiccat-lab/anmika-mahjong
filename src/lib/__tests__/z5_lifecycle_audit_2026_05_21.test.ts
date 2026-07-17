import { describe, it, expect } from 'vitest';
import { Game3, buildShoupai } from '../game3';
import type { PlayerId } from '../types';

// ぽっちサイコロ 2 系統 [リョー裁定 2026-07-17]:
//  A) ぽっちツモ + 祝儀 0 枚 → base70 [一発不要]
//  B) 即ぽっちツモ [一発] → base140 [祝儀と無関係]
// 符号は色で決まる: 青/緑=+、赤/黄=-。でかぽっちは 即1p=+35 / 即2p=-35

function rigPochiTsumo(pai: string, color: 'blue' | 'red' | 'green' | 'yellow' | null, opts: { yifa?: boolean; lizhi?: boolean } = {}) {
  const winner = 0 as PlayerId;
  const g = new Game3({ qijia: 0, changshu: 1 });
  g.qipai();
  const sp = buildShoupai(['m1', 'm1', 'm1', 'p2', 'p3', 'p4', 's2', 's3', 's4', 'z1', 'z1', 'z1', pai, pai]);
  (sp as any)._zimo = pai;
  g.shoupai.set(winner, sp);
  g.lastZimoInfo = { player: winner, pai, pochi: color, gold: false };
  g.yifaActive[winner] = opts.yifa !== false;
  if (opts.lizhi) g.lizhi.add(winner);
  g.chipLedger = { 0: 0, 1: 0, 2: 0 };
  g.chipBreakdown = [];
  g.huapai = { 0: [], 1: [], 2: [] };
  g.nukidora = { 0: 0, 1: 0, 2: 0 };
  g.nukidoraGold = { 0: 0, 1: 0, 2: 0 };
  return { g, winner };
}

describe('z5 lifecycle audit 2026-05-21 (2026-07-17 裁定反映)', () => {
  it('z5b 即ツモ + 祝儀 0 枚 → 祝儀0サイコロ[+70] と 即ツモサイコロ[+140] の両方が出る', () => {
    const { g, winner } = rigPochiTsumo('z5b', 'blue');
    const result: any = { fanshu: 1, fu: 30, hupai: [] };
    g.applyHule(result, winner, null);

    expect(result.saiKoroChances).toContainEqual(expect.objectContaining({
      awardKey: '白ぽっちツモ祝儀0',
      baseChip: 70,
      plusMinus: '+',
      mode: 'tsumo',
    }));
    expect(result.saiKoroChances).toContainEqual(expect.objectContaining({
      awardKey: '白ぽっち即ツモ',
      baseChip: 140,
      plusMinus: '+',
      mode: 'tsumo',
    }));
  });

  it('z5r [赤・逆] 即ツモ → 即ツモサイコロは -140 [マイナス]', () => {
    const { g, winner } = rigPochiTsumo('z5r', 'red');
    const result: any = { fanshu: 1, fu: 30, hupai: [] };
    g.applyHule(result, winner, null);

    const sokuTsumo = (result.saiKoroChances ?? []).find((c: any) => c.awardKey === '白ぽっち即ツモ');
    expect(sokuTsumo).toBeTruthy();
    expect(sokuTsumo.baseChip).toBe(140);
    expect(sokuTsumo.plusMinus).toBe('-');
  });

  it('後巡 [一発切れ] の z5g ツモ + 祝儀 0 枚 → 祝儀0サイコロ[70]のみ、即ツモサイコロは出ない', () => {
    const { g, winner } = rigPochiTsumo('z5g', 'green', { yifa: false });
    const result: any = { fanshu: 1, fu: 30, hupai: [] };
    g.applyHule(result, winner, null);

    expect(result.saiKoroChances).toContainEqual(expect.objectContaining({
      awardKey: '白ぽっちツモ祝儀0',
      baseChip: 70,
      plusMinus: '+',
    }));
    const sokuTsumo = (result.saiKoroChances ?? []).find((c: any) => c.awardKey === '白ぽっち即ツモ');
    expect(sokuTsumo).toBeUndefined();
  });

  it('でかぽっち: 即 1p ツモ=+35 / 即 2p ツモ=-35', () => {
    for (const [pai, sign] of [['p1', '+'], ['p2', '-']] as const) {
      const { g, winner } = rigPochiTsumo(pai, null, { lizhi: true });
      const result: any = { fanshu: 1, fu: 30, hupai: [{ name: 'でかぽっち', fanshu: 0 }] };
      g.applyHule(result, winner, null);

      const deka = (result.saiKoroChances ?? []).find((c: any) => c.awardKey === 'でかぽっち');
      expect(deka, `${pai} のでかぽっちサイコロ`).toBeTruthy();
      expect(deka.baseChip).toBe(35);
      expect(deka.plusMinus).toBe(sign);
    }
  });
});
