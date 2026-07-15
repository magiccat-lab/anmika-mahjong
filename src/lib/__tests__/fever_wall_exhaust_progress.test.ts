// 2026-07-16 リョー報告: ソロのフィーバーで山を掘り切ると進行不能。
// continueFever の山切れ経路が roundEnded を立てるだけで pendingPingju を作らず、
// 流局パネルも次局導線も出なかった回帰を固定する。
import { describe, it, expect, beforeEach } from 'vitest';
import { get } from 'svelte/store';
import { game } from '../store';

describe('フィーバー山切れの進行', () => {
  beforeEach(() => {
    game.reset();
  });

  it('ロン和了フィーバー続行で山が空なら流局処理に入る [進行不能にならない]', () => {
    const s: any = get(game);
    s.game.feverActive[0] = true;
    (s.game.shan as any)._pai = [];
    s.pendingFeverContinue = { winner: 0, isRon: true };
    s.roundEnded = false;
    game.continueFever();
    const after: any = get(game);
    expect(after.pendingFeverContinue).toBeNull();
    expect(after.roundEnded).toBe(true);
    // 進行導線: pendingPingju が立って流局パネル+次局ボタンが出る
    expect(after.pendingPingju).toBe(true);
  });
});
