import { describe, it, expect } from 'vitest';
import { Game3, buildShoupai } from '../game3';
import type { PlayerId } from '../types';

// 2026-07-17 リョー報告: 秋抜き中にドラ表が勝手に増える。
// 原因: hule() [評価] 内の秋カスケードが物理的に drawNewDora する設計で、
// 投機評価の巻き戻しが snapshotLocked 中に skip され、めくりが漏れていた。
// evaluateHuleDry はロック状態に関係なく必ず巻き戻す。

function rigAkiWinner() {
  const winner = 0 as PlayerId;
  const g = new Game3({ qijia: 0, changshu: 1 });
  g.qipai();
  const sp = buildShoupai(['m7', 'm7', 'm7', 'p2', 'p3', 'p4', 's2', 's3', 's4', 'z1', 'z1', 'z1', 'p6', 'p6']);
  (sp as any)._zimo = 'p6';
  g.shoupai.set(winner, sp);
  g.huapai[winner] = ['f3']; // 秋抜き済み
  g.lizhi.add(winner);
  g.chipLedger = { 0: 0, 1: 0, 2: 0 };
  g.chipBreakdown = [];
  return { g, winner };
}

describe('aki dora leak (2026-07-17)', () => {
  it('snapshotLocked 中の投機評価でもドラ表が増えない', () => {
    const { g, winner } = rigAkiWinner();
    g.snapshotLocked = true;
    g.preHuleSnapshot = null as any;
    const before = g.shan.baopai.length;
    const res = (g as any).evaluateHuleDry(winner);
    expect(res).toBeTruthy(); // 和了形として評価できている
    expect(g.shan.baopai.length).toBe(before); // 物理めくりが漏れない
  });

  it('通常状態の投機評価でもドラ表と山が完全に巻き戻る', () => {
    const { g, winner } = rigAkiWinner();
    const beforeBaopai = g.shan.baopai.length;
    const beforePaishu = g.shan.paishu;
    (g as any).evaluateHuleDry(winner);
    expect(g.shan.baopai.length).toBe(beforeBaopai);
    expect(g.shan.paishu).toBe(beforePaishu);
  });
});
