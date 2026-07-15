// 2026-07-16 リョー報告: CPU が 7 の暗刻持ちでもフィーバーリーチを宣言しない
// [declareLizhi() を素で呼んでいて fever オプションが渡らない]。
import { describe, it, expect, beforeEach } from 'vitest';
import { get } from 'svelte/store';
import { game } from '../store';
import { buildShoupai } from '../game3';

describe('CPU フィーバーリーチ宣言', () => {
  beforeEach(() => {
    game.reset();
  });

  it('7 暗刻持ちテンパイの CPU はフィーバーリーチを宣言する', () => {
    const s: any = get(game);
    const cur = s.game.lunbanToPlayerId(s.game.state.lunban);
    s.cpu[cur] = true;
    // m7 暗刻 [フィーバー種] + s2/s5 待ちテンパイ。s9 ツモ切りでリーチ形
    s.game.shoupai.set(cur, buildShoupai([
      'm7', 'm7', 'm7',
      'p2', 'p3', 'p4',
      'p5', 'p6', 'p7',
      's3', 's4',
      'm2', 'm2',
    ]));
    (s.game.shoupai.get(cur) as any).zimo('s9');
    s.lastZimo = 's9';
    expect(s.game.canFeverLizhi(cur).ok).toBe(true);
    game.cpuStep();
    const after: any = get(game);
    expect(after.game.lizhi.has(cur)).toBe(true);
    expect(after.game.feverActive[cur]).toBe(true);
  });
});
