import { describe, expect, it } from 'vitest';
import { Game3, buildShoupai } from '../game3';
import type { PlayerId } from '../types';

// 2026-07-21 監査 D-09: 冬を含む一和了の途中で FEVER flag が落ち、冬より後に集計する
// 役満・面前チップだけ非 FEVER 倍率になっていた [めくり途中に正ぽっちで pending に
// なる経路とで倍率規則も分岐]。全チップを和了時点の FEVER 倍率で一貫させ、
// FEVER 終了は全チップ計算後に一度だけ行う。

function feverWinterYakumanGame(): { g: Game3; winner: PlayerId; result: any } {
  const g = new Game3({ qijia: 0 });
  g.qipai();
  const winner = 0 as PlayerId;
  g.feverActive[winner] = true;
  g.feverTier[winner] = 2; // ×2
  g.huapai[winner] = ['f4']; // 冬
  g.fuyuConsumed[winner] = true; // 冬使用確定 [D-08 の自動使用相当]
  const sp = buildShoupai(['m1', 'm2', 'm3', 'p1', 'p2', 'p3', 's7', 's8', 's9', 'z1', 'z1', 'p5', 'p5']);
  g.shoupai.set(winner, sp);
  // 役満相当の damanguan と面前フラグを持つ result を組む [チップ集計だけ検証]
  const result: any = {
    hupai: [{ name: '立直', fanshu: 1 }, { name: '清一色', fanshu: 6 }],
    fanshu: 13,
    fu: 40,
    defen: 16000,
    defen3: 16000,
    fenpei: [0, 0, 0, 0],
    damanguan: 1, // 役満 → 冬より後に集計されるチップ
  };
  return { g, winner, result };
}

describe('D-09: 一和了内の FEVER 倍率一貫', () => {
  it('冬より後の役満チップも和了時点の FEVER 倍率 [×2] で集計される', () => {
    const { g, winner, result } = feverWinterYakumanGame();
    const before = g.chipLedger[winner];
    g.applyChipsOnHule(result, winner, null);
    // 役満ツモ 5オール [tsumoChips=5] は冬より後に集計。FEVER tier2 なので ×2 = 10オール。
    // 本役満 10オールも ×2 = 20。冬完了で flag が落ちていた旧実装だと ×1 になっていた。
    const yakumanEntry = g.chipBreakdown.find((e) => e.label.includes('役満ツモ'));
    expect(yakumanEntry).toBeTruthy();
    expect(yakumanEntry!.multiplier).toBe(2);
    const honYakuman = g.chipBreakdown.find((e) => e.label.includes('本役満'));
    expect(honYakuman).toBeTruthy();
    expect(honYakuman!.multiplier).toBe(2);
    expect(g.chipLedger[winner]).toBeGreaterThan(before);
  });

  it('冬使用和了の後は FEVER が終了している [状態遷移は関数末尾で一度だけ]', () => {
    const { g, winner, result } = feverWinterYakumanGame();
    expect(g.feverActive[winner]).toBe(true);
    g.applyChipsOnHule(result, winner, null);
    // 全チップ計算後に FEVER 終了が反映される [旧実装と同じ downstream 状態]
    expect(g.feverActive[winner]).toBe(false);
  });

  it('冬を持たない FEVER 和了では FEVER は落ちない [継続]', () => {
    const g = new Game3({ qijia: 0 });
    g.qipai();
    const winner = 0 as PlayerId;
    g.feverActive[winner] = true;
    g.feverTier[winner] = 2;
    g.huapai[winner] = []; // 冬なし
    const sp = buildShoupai(['m1', 'm2', 'm3', 'p1', 'p2', 'p3', 's7', 's8', 's9', 'z1', 'z1', 'p5', 'p5']);
    g.shoupai.set(winner, sp);
    const result: any = {
      hupai: [{ name: '立直', fanshu: 1 }], fanshu: 1, fu: 40, defen: 2000, defen3: 2000, fenpei: [0, 0, 0, 0],
    };
    g.applyChipsOnHule(result, winner, null);
    expect(g.feverActive[winner]).toBe(true);
  });
});
