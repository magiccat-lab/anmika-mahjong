// 2026-10-16 通報 20261016_0「冬冬金北がチップに反映されてないんじゃない？演出はあるけど」[solo、CPU の冬冬金北ツモ]。
//
// 冬のめくりで正ぽっち [z5b / z5g] が出ると applyFuyuChip は pending で止まり、
// 祝儀は applyHule の後の resumeFuyuKamiPochi で ledger に入る。
// 旧実装は applyHule で焼き込んだ chipTransfer ・ chipTotal ・ chipBreakdown を直さず、
// 結果の板 [と戦績の hule event] には冬の分が出ていなかった [通報の局: 表示 +18、ledger は +92]。
import { describe, it, expect } from 'vitest';
import { Game3, buildShoupai } from '../game3';
import type { PlayerId } from '../types';

function buildWinner(wallHead: string[]): Game3 {
  const g = new Game3({ qijia: 0, changshu: 1 } as any);
  g.qipai();
  (g as any).diyizimo = false;
  // 通報の局の p2: p67 s333 s66 s789 + 鳴いた東、金 5p ツモ、華 冬冬春夏、金北は冬に
  const sp2 = buildShoupai(['p6', 'p7', 's3', 's3', 's3', 's6', 's6', 's7', 's8', 's9']);
  sp2._fulou = ['z111-'];
  (sp2 as any)._anmikaFulou = [{ from: 1, mianzi: 'z111-', taken: 'z1' }];
  (sp2 as any)._anmikaFulouPhysical = [{ consumed: [], mianzi: 'z111-' }];
  sp2.zimo('gp');
  g.shoupai.set(2, sp2);
  g.huapai = { 0: ['f1'], 1: ['f3', 'f2', 'f3'], 2: ['f4', 'f1', 'f4', 'f2'] } as any;
  g.nukidora = { 0: 0, 1: 2, 2: 0 } as any;
  g.nukidoraGold = { 0: 0, 1: 0, 2: 1 } as any;
  g.kinpeiTarget = { 0: null, 1: null, 2: 'fuyu' } as any;
  g.goldHand[2] = { p: 1, s: 0, z: 0 } as any;
  g.chipLedger = { 0: 42, 1: 36, 2: -78 } as any;
  const shan: any = g.shan;
  shan._pai.unshift(...wallHead);
  shan._baopai.length = 0;
  shan._baopai.push('p8', 'm7', 'p5');
  for (let l = 0; l < 3; l++) if (g.lunbanToPlayerId(l as any) === 2) g.state.lunban = l as any;
  return g;
}

function settle(g: Game3, withResult: boolean) {
  const result = g.hule(2 as PlayerId);
  expect(result).toBeTruthy();
  g.applyHule(result, 2 as PlayerId, null);
  const bakedDelta = result.chipTransfer.delta[2];
  for (let guard = 0; guard < 8; guard++) {
    const pending = g.getPendingFuyuKamiPochi(2 as PlayerId);
    if (!pending?.occurrenceKey) break;
    const best = g.bestFuyuKamiPochiTarget(2 as PlayerId);
    const pick = pending.candidates.includes(best) ? best : pending.candidates[0];
    const advance = g.resumeFuyuKamiPochi(2 as PlayerId, pending.occurrenceKey, pick, withResult ? result : null);
    if (!advance || advance.status === 'complete') break;
  }
  return { result, bakedDelta };
}

describe('冬冬金北: めくりで正ぽっちが出た時の祝儀を結果に焼き込む [通報 20261016_0]', () => {
  it('正ぽっちで止まった冬の祝儀が chipTransfer ・ chipTotal ・ chipBreakdown に入る', () => {
    // 1 組目の上段が緑ぽっち [神ぽっち]、下段 s6。2 組目は外れ
    const g = buildWinner(['z5g', 's6', 'm1', 'm1']);
    const { result, bakedDelta } = settle(g, true);
    const fuyuRows = (result.chipBreakdown ?? []).filter((e: any) => String(e.label).startsWith('冬 '));
    expect(fuyuRows).toHaveLength(1);
    const fuyuChip = fuyuRows[0].total as number;
    expect(fuyuChip).toBeGreaterThan(0);
    // 冬の前 [金 5 ・ 抜きドラ ・ 春] は 9 オール = +18。冬の分が後から足される
    expect(bakedDelta).toBe(18);
    expect(result.chipTransfer.delta[2]).toBe(18 + 2 * fuyuChip);
    expect(result.chipTransfer.delta[0]).toBe(-9 - fuyuChip);
    expect(result.chipTransfer.after).toEqual({ 0: g.chipLedger[0], 1: g.chipLedger[1], 2: g.chipLedger[2] });
    expect(result.chipTotal).toBe(result.chipTransfer.delta[2]);
    // 戦績の hule event も同じ値
    const ev = (g.events as any[]).filter((e) => e.type === 'hule').at(-1);
    expect(ev.chipTransfer.delta[2]).toBe(result.chipTransfer.delta[2]);
  });

  it('result を渡さない呼び方は今まで通り [ledger だけ動く]', () => {
    const g = buildWinner(['z5g', 's6', 'm1', 'm1']);
    const { result } = settle(g, false);
    expect(result.chipTransfer.delta[2]).toBe(18);
    expect(g.chipLedger[2] - -78).toBeGreaterThan(18);
  });

  it('正ぽっちが出ない冬は applyHule の時点で入っていて、値は変わらない', () => {
    const g = buildWinner(['s3', 's6', 'm1', 'm1']);
    const { result, bakedDelta } = settle(g, true);
    expect(result.chipTransfer.delta[2]).toBe(bakedDelta);
    expect(result.chipTransfer.after).toEqual({ 0: g.chipLedger[0], 1: g.chipLedger[1], 2: g.chipLedger[2] });
  });
});
