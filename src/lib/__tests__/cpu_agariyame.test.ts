// 2026-07-16 リョー指示: 親がアガリ止め可能な局面で親が CPU なら CPU 自身に判断させる。
// nextRound 呼び出し時に CPU 親がアガリ止め条件を満たしていれば半荘を終了する。
import { describe, it, expect, beforeEach } from 'vitest';
import { get } from 'svelte/store';
import { game } from '../store';

function setupAgariyameReady(oyaIsCpu: boolean): { oya: number } {
  game.reset();
  const s: any = get(game);
  // オーラス: changbang = changshu-1, jushu = 2 [canAgariyame の条件]
  s.game.state.changbang = s.game.changshu - 1;
  s.game.state.jushu = 2;
  const oya = s.game.currentOya as number;
  // 親がトップ + 40000 以上
  for (const p of [0, 1, 2]) s.game.state.defen[p] = p === oya ? 45000 : 30000;
  s.lastWinner = oya;
  s.roundEnded = true;
  s.cpu[oya] = oyaIsCpu;
  return { oya };
}

describe('CPU 親のアガリ止め判断', () => {
  beforeEach(() => {
    game.reset();
  });

  it('CPU 親がアガリ止め可能なら nextRound で半荘を終了する', () => {
    const { oya } = setupAgariyameReady(true);
    const before: any = get(game);
    expect(before.game.canAgariyame(oya)).toBe(true);
    game.nextRound();
    const after: any = get(game);
    expect(after.game.state.finished).toBe(true);
    expect(after.message).toContain('アガリ止め');
  });

  it('人間親なら自動アガリ止めせず次局へ進む', () => {
    setupAgariyameReady(false);
    game.nextRound();
    const after: any = get(game);
    expect(after.game.state.finished).toBeFalsy();
  });
});
