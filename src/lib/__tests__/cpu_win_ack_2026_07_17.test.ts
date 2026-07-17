// 2026-07-17 リョー指摘: CPU がリーチ白ツモで「勝手に上がって勝手に次に行った」。
// 旧実装は pendingSaiKoro 時のみ cpuWinAck=false で、サイコロ無しの素の
// CPU ツモ和了は App.svelte の 3 秒 auto-advance が判定表示ごと次局へ飛ばしていた。
// 局終了する CPU ツモ和了は常に cpuWinAck=false [人間の確認待ち] になることを固定する。
import { describe, it, expect, beforeEach } from 'vitest';
import { get } from 'svelte/store';
import { game } from '../store';
import { buildShoupai } from '../game3';

describe('CPU ツモ和了は人間の確認まで自動進行しない', () => {
  beforeEach(() => {
    game.reset();
  });

  it('サイコロ無しの素のツモ和了でも cpuWinAck=false になる', () => {
    const s: any = get(game);
    const cur = s.game.lunbanToPlayerId(s.game.state.lunban);
    for (const p of [0, 1, 2]) s.cpu[p] = true;
    s.game.shoupai.set(cur, buildShoupai([
      'p2', 'p3', 'p4',
      'p5', 'p6', 'p7',
      's2', 's3', 's4',
      's5', 's6',
      'm2', 'm2',
    ]));
    // 第一巡フラグを落とす [天和にするとサイコロが混ざる]。
    // ダマ禁止ルールで素の門前ツモは不可なのでリーチ状態にする [リョーの実例もリーチ白ツモ]
    s.game.diyizimo = false;
    s.game.lizhi.add(cur);
    (s.game.shoupai.get(cur) as any).zimo('s7');
    s.lastZimo = 's7';
    game.cpuStep();
    const after: any = get(game);
    expect(after.lastWinner).toBe(cur);
    expect(after.roundEnded).toBe(true);
    // ここが本題: サイコロが無くても確認待ちで止まる
    expect(after.pendingSaiKoro ?? null).toBeNull();
    expect(after.cpuWinAck).toBe(false);
  });
});
