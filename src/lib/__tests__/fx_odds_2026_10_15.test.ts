import { describe, expect, it } from 'vitest';
import { diceBallRows, diceReachRows, pochiOpeningRows, pochiOutcomes, pochiStepRows, pochiTeaserGlowRows, pct } from '../fxOdds';
import { freezeRoll } from '../pochiFx';

// 演出一覧のページの数 (2026-10-15)。決まりの関数から数えた数が、決まりに書いた割合と合うか
const sum = (rows: { rate: number }[]) => rows.reduce((a, r) => a + r.rate, 0);

describe('演出一覧の数', () => {
  it('白ぽっちの形の割合は全部で 1', () => {
    expect(pochiOutcomes().reduce((a, o) => a + o.p, 0)).toBeCloseTo(1, 9);
  });
  it('引いた瞬間の演出はどれか 1 つが必ず出る (無予告は無い)', () => {
    expect(sum(pochiOpeningRows())).toBeCloseTo(1, 9);
  });
  it('フリーズとプレミアは当たりの確定、白黒は 25% と 6% のガセ', () => {
    const rows = Object.fromEntries(pochiOpeningRows().map((r) => [r.name, r]));
    expect(rows['フリーズ (暗転)'].hit).toBe(1);
    expect(rows['フリーズ (暗転)'].rate).toBeCloseTo(0.5 * 0.03, 9);
    expect(rows['フリーズ (止め絵)'].rate).toBeCloseTo(0.5 * 0.06, 9);
    expect(rows['プレミア (サビ)'].hit).toBe(1);
    // 当たりの 0.91 × 虹 0.3 × 1 割
    expect(rows['プレミア (サビ)'].rate).toBeCloseTo(0.5 * 0.91 * 0.3 * 0.1, 9);
    // 白黒: 当たり 0.5 × 0.91 × (1 - 0.03) × 0.25 と 外れ 0.5 × 0.06
    const goodMono = 0.5 * 0.91 * (1 - 0.3 * 0.1) * 0.25;
    expect(rows['予告「白黒」'].rate).toBeCloseTo(goodMono + 0.5 * 0.06, 9);
    expect(rows['予告「白黒」'].hit).toBeCloseTo(goodMono / (goodMono + 0.03), 9);
  });
  it('光りの最高段: 虹は確定、白のままは外れ確定 (無演出)', () => {
    const rows = Object.fromEntries(pochiStepRows().map((r) => [r.name, r]));
    expect(sum(pochiStepRows())).toBeCloseTo(1, 9);
    expect(rows['虹まで'].hit).toBe(1);
    expect(rows['白のまま (光りが上がらない)'].hit).toBe(0);
    expect(rows['白のまま (光りが上がらない)'].none).toBe(true);
  });
  it('予告の光りの色は割合の合計が 1', () => {
    expect(sum(pochiTeaserGlowRows())).toBeCloseTo(1, 9);
  });
  it('フリーズは外れでは出ない', () => {
    for (let i = 0; i < 1000; i += 1) expect(freezeRoll(false, (i + 0.5) / 1000)).toBeNull();
  });
  it('サイコロ: 当たりは 36 通り中 2、リーチは 20、虹の玉は当たりの確定', () => {
    const balls = Object.fromEntries(diceBallRows().map((r) => [r.name, r]));
    expect(sum(diceBallRows())).toBeCloseTo(1, 9);
    expect(balls['玉 虹'].hit).toBe(1);
    expect(balls['玉 虹'].rate).toBeCloseTo((2 / 36) * 0.3, 9);
    const reach = Object.fromEntries(diceReachRows().map((r) => [r.name, r]));
    expect(reach['リーチ (宣言した目が 1 個目に出る)'].rate).toBeCloseTo(20 / 36, 9);
    expect(reach['リーチ (宣言した目が 1 個目に出る)'].hit).toBeCloseTo(0.1, 9);
    expect(reach['リーチ無し'].hit).toBe(0);
  });
  it('% の書き方', () => {
    expect(pct(0.0015)).toBe('0.15%');
    expect(pct(0.155)).toBe('15.5%');
    expect(pct(1)).toBe('100%');
    expect(pct(null)).toBe('—');
  });
});
