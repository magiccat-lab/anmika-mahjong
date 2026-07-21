import { describe, expect, it } from 'vitest';
import { Game3 } from '../game3';
import type { PlayerId } from '../types';

// 2026-07-21 監査 D-03: hule() 評価中の直接祝儀 [オールオールスター/八華/四華四北] は
// result._directChipAwards に積み、applyHule [settle 確定時] に一度だけ適用する。
// 旧実装は hule() が ledger を直接動かし、ダブロンの次候補評価前 snapshot restore で
// 先評価者の直接祝儀が消えていた。
// 注: this.chipBreakdown はアガリ毎に reset されるため、検証は result.chipBreakdown
// [result へ保存される表示用内訳] と chipLedger 差分で行う。

function minimalHuleResult(awards: Array<{ n: number; opts?: any }>): any {
  return {
    hupai: [{ name: '立直', fanshu: 1 }],
    fanshu: 1,
    fu: 30,
    defen: 1000,
    defen3: 1000,
    fenpei: [0, 0, 0, 0],
    _directChipAwards: awards,
  };
}

describe('D-03: 直接祝儀の applyHule 一括適用', () => {
  it('applyHule で直接祝儀が result.chipBreakdown と ledger に入る', () => {
    const g = new Game3({ qijia: 0 });
    g.qipai();
    const before = { ...g.chipLedger };
    const result = minimalHuleResult([{ n: 77, opts: { label: 'オールオールスター 77枚' } }]);
    g.applyHule(result, 0 as PlayerId, null);
    const entries = (result.chipBreakdown ?? []).filter((e: any) => e.label.includes('オールオールスター'));
    expect(entries.length).toBe(1);
    expect(entries[0].base).toBe(77);
    expect(result._directChipAwardsApplied).toBe(true);
    // 77 オール [倍率なし]: winner +154。通常祝儀 [qipai ランダムの春等] が乗る可能性が
    // あるため下限で確認する
    expect(g.chipLedger[0] - before[0]).toBeGreaterThanOrEqual(154);
    // chipTotal [表示用合計] にも直接祝儀分が入る
    expect(result.chipTotal).toBeGreaterThanOrEqual(154);
  });

  it('同一 result への applyHule 再入でも直接祝儀は二重適用されない', () => {
    const g = new Game3({ qijia: 0 });
    g.qipai();
    const before = g.chipLedger[0];
    const result = minimalHuleResult([{ n: 300, opts: { bypassShuvari: true, label: '八華四北 300枚オール' } }]);
    g.applyHule(result, 0 as PlayerId, null);
    const inc1 = g.chipLedger[0] - before;
    g.applyHule(result, 0 as PlayerId, null);
    const inc2 = g.chipLedger[0] - before - inc1;
    // 2 回目の増分には 300 オール分 [+600] が含まれない
    expect(inc1 - inc2).toBe(600);
  });

  it('ダブロン相当: snapshot restore を挟んでも settle 時の適用で祝儀が残る', () => {
    const g = new Game3({ qijia: 0 });
    g.qipai();
    const before = { ...g.chipLedger };
    // 1 人目評価 [旧実装ならここで ledger が動き、下の restore で消えていた]
    const first = minimalHuleResult([{ n: 77, opts: { label: 'オールオールスター 77枚' } }]);
    g.saveSnapshot();
    g.restoreSnapshot(); // 2 人目評価前の巻き戻し
    // settle: kamicha 順で両者 applyHule
    g.applyHule(first, 1 as PlayerId, 0 as PlayerId);
    const second = minimalHuleResult([]);
    g.applyHule(second, 2 as PlayerId, 0 as PlayerId);
    const entries = (first.chipBreakdown ?? []).filter((e: any) => e.label.includes('オールオールスター'));
    expect(entries.length).toBe(1);
    // 77 オール分 [+154] が最終 ledger に残っている [2 人目の settle で消えない]
    expect(g.chipLedger[1] - before[1]).toBeGreaterThanOrEqual(154);
  });
});
