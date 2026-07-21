// 2026-07-21 裁定7 リョー: 子が FEVER で和了した後に山切れした局は親流れ。
// [アガリがあれば流れます] 従来は流局 nextRound が一律 親維持だった。
import { describe, it, expect } from 'vitest';
import { Game3 } from '../game3';

describe('子 FEVER 和了後の山切れ流局は親流れ [裁定7]', () => {
  it('子 [P1] の feverWinCount>0 で流局 nextRound → jushu が進む [親流れ]', () => {
    const g = new Game3({ qijia: 0 }); // 親 = P0
    g.state.jushu = 0;
    g.feverWinCount[1] = 1; // 子 P1 が今局 FEVER 和了した記録
    g.nextRound({}); // 流局 [winner なし]
    expect(g.state.jushu).toBe(1); // 親流れ
    expect(g.state.benbang).toBe(0);
  });

  it('親 [P0] のみ FEVER 和了の流局は親維持 + 本場+1', () => {
    const g = new Game3({ qijia: 0 });
    g.state.jushu = 0;
    g.state.benbang = 0;
    g.feverWinCount[0] = 1; // 親のみ和了
    g.nextRound({});
    expect(g.state.jushu).toBe(0); // 親維持
    expect(g.state.benbang).toBe(1);
  });

  it('無和了の通常流局は従来どおり親維持 + 本場+1', () => {
    const g = new Game3({ qijia: 0 });
    g.state.jushu = 0;
    g.state.benbang = 2;
    g.nextRound({});
    expect(g.state.jushu).toBe(0);
    expect(g.state.benbang).toBe(3);
  });
});
