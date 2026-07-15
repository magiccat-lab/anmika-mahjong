// 2026-07-16 リョー指示 [演出同期]: リーチ/ツモ等の cutin が積まれたら CPU 進行を
// 一旦止める。旧実装は cutin を無視して cpuStep ループが先へ進み、演出が
// 実局面より遅れて再生されていた。
import { describe, it, expect, beforeEach } from 'vitest';
import { get } from 'svelte/store';
import { game } from '../store';
import { buildShoupai } from '../game3';

describe('演出同期: cutin 中は CPU 進行を止める', () => {
  beforeEach(() => {
    game.reset();
  });

  it('CPU のリーチ宣言で cutin が積まれたらループを抜ける', () => {
    const s: any = get(game);
    const cur = s.game.lunbanToPlayerId(s.game.state.lunban);
    // 全員 CPU にして、リーチ宣言後もループが続けられる状況を作る
    for (const p of [0, 1, 2]) s.cpu[p] = true;
    s.game.shoupai.set(cur, buildShoupai([
      'p2', 'p3', 'p4',
      'p5', 'p6', 'p7',
      's2', 's3', 's4',
      's5', 's6',
      'm2', 'm2',
    ]));
    (s.game.shoupai.get(cur) as any).zimo('s9');
    s.lastZimo = 's9';
    game.cpuStep();
    const after: any = get(game);
    // リーチは成立し、cutin が残った状態でループが止まっている
    expect(after.game.lizhi.has(cur)).toBe(true);
    expect(after.cutin ?? null).not.toBeNull();
  });
});
