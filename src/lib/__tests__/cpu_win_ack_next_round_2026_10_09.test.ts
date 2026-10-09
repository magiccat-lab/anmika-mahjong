// 2026-10-09 リョー報告「これCPUじゃなくてプレイヤーだし」: CPU の素のツモ和了で立つ確認待ち
// [cpuWinAck=false] が「次局へ」で戻らず次の局へ持ち越され、次に人間がサイコロ付きで上がると
// 「CPU のサイコロチャンスを見る」が出てサイコロの板が開かなかった。次局で確認待ちを戻す
import { describe, it, expect, beforeEach } from 'vitest';
import { get } from 'svelte/store';
import { game } from '../store';
import { buildShoupai } from '../game3';

describe('CPU 和了の確認待ちは次の局へ持ち越さない', () => {
  beforeEach(() => {
    game.reset();
  });

  it('CPU ツモ和了の後に「次局へ」を押すと cpuWinAck が戻る', () => {
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
    s.game.diyizimo = false;
    s.game.lizhi.add(cur);
    (s.game.shoupai.get(cur) as any).zimo('s7');
    s.lastZimo = 's7';
    game.cpuStep();
    const won: any = get(game);
    expect(won.roundEnded).toBe(true);
    expect(won.cpuWinAck).toBe(false);
    // 人間は確認ボタンではなく板の「次局へ」で進めた
    game.nextRound();
    const next: any = get(game);
    expect(next.roundEnded).toBe(false);
    expect(next.cpuWinAck).toBe(true);
  });
});
