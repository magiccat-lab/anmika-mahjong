import { describe, it, expect } from 'vitest';
import { Game3, buildShoupai } from '../game3';
import type { PlayerId } from '../types';

// ぽっちサイコロ 2 系統 [リョー裁定 2026-07-17、65アンミカルール §4-1]:
//  A) ぽっちツモ + 祝儀 0 枚 [一発不要] / B) 即ぽっちツモ [一発、祝儀と無関係]
// base はどちらも 70 固定。色の増減 [青=+140 / 赤=-140 / 緑=+70 / 黄=-70] は
// pochiMultiplier [chip 倍率、符号込み] が applyChipOall で自動適用する。
// award 側に 140 や '-' を焼き込むと二重掛けになる [280 事故] ので、
// このテストは「award は常に base70/35 + '+'」と「倍率経由の実効値」の両方を縛る。

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
  it('z5b 即ツモ + 祝儀 0 枚 → 祝儀0サイコロと即ツモサイコロの両方が base70 で出る', () => {
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
      baseChip: 70,
      plusMinus: '+',
      mode: 'tsumo',
    }));
  });

  it('z5r [赤] 即ツモ → award は base70 のまま [140 や - を焼き込まない]', () => {
    const { g, winner } = rigPochiTsumo('z5r', 'red');
    const result: any = { fanshu: 1, fu: 30, hupai: [] };
    g.applyHule(result, winner, null);

    const sokuTsumo = (result.saiKoroChances ?? []).find((c: any) => c.awardKey === '白ぽっち即ツモ');
    expect(sokuTsumo).toBeTruthy();
    expect(sokuTsumo.baseChip).toBe(70);
    expect(sokuTsumo.plusMinus).toBe('+');
  });

  it('後巡 [一発切れ] の z5g ツモ + 祝儀 0 枚 → 祝儀0サイコロのみ、即ツモサイコロは出ない', () => {
    const { g, winner } = rigPochiTsumo('z5g', 'green', { yifa: false });
    const result: any = { fanshu: 1, fu: 30, hupai: [] };
    g.applyHule(result, winner, null);

    expect(result.saiKoroChances).toContainEqual(expect.objectContaining({
      awardKey: '白ぽっちツモ祝儀0',
      baseChip: 70,
    }));
    const sokuTsumo = (result.saiKoroChances ?? []).find((c: any) => c.awardKey === '白ぽっち即ツモ');
    expect(sokuTsumo).toBeUndefined();
  });

  it('でかぽっち: 即 1p/2p ツモとも award は base35 [2p の -35 は倍率が担う]', () => {
    for (const pai of ['p1', 'p2'] as const) {
      const { g, winner } = rigPochiTsumo(pai, null, { lizhi: true });
      const result: any = { fanshu: 1, fu: 30, hupai: [{ name: 'でかぽっち', fanshu: 0 }] };
      g.applyHule(result, winner, null);

      const deka = (result.saiKoroChances ?? []).find((c: any) => c.awardKey === 'でかぽっち');
      expect(deka, `${pai} のでかぽっちサイコロ`).toBeTruthy();
      expect(deka.baseChip).toBe(35);
      expect(deka.plusMinus).toBe('+');
    }
  });

  it('色倍率の実効値: 赤=-140 / 青=+140 / 黄=-70 [base70 × pochiMultiplier]', () => {
    const cases = [
      { color: 'red' as const, expectWinner: -280, expectOther: 140 },   // 70×(-2): winner が 140 ずつ払う
      { color: 'blue' as const, expectWinner: 280, expectOther: -140 },  // 70×(+2): winner が 140 ずつ貰う
      { color: 'yellow' as const, expectWinner: -140, expectOther: 70 }, // 70×(-1)
    ];
    for (const c of cases) {
      const g = new Game3({ qijia: 0, changshu: 1 });
      g.qipai();
      g.chipLedger = { 0: 0, 1: 0, 2: 0 };
      g.chipBreakdown = [];
      (g as any).applyPochiColorMultiplier(0, c.color);
      g.applyChipOall(0, 70, { bypassShuvari: true, mode: 'tsumo' });
      expect(g.chipLedger[0], `${c.color} winner`).toBe(c.expectWinner);
      expect(g.chipLedger[1], `${c.color} other`).toBe(c.expectOther);
    }
  });
});
