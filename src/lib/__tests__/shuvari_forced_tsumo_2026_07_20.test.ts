// 2026-07-20 リョー報告: シュバポツモがキャンセルできてしまっている。
// シュバリ中は見逃し不可 [ロン側は既に guard 済] なので、ツモ和了可能な状態の
// 打牌 = ツモのキャンセル も reject する。通常リーチは従来どおり見逃せる。
import { describe, it, expect, beforeEach } from 'vitest';
import { game } from '../store';
import { get } from 'svelte/store';

// m234 / p234 / s234 / z1z1 + p6p7 の p5 待ち [ツモればテンパイ即和了]
const TENPAI_P5_WAIT = [
  'm2', 'm3', 'm4', 'p2', 'p3', 'p4', 's2', 's3', 's4', 'z1', 'z1', 'p6', 'p7',
];

function setupTsumoReady(opts: { shuvari: boolean }) {
  game.resetDebug(TENPAI_P5_WAIT, [], { forceShan: ['p5'] });
  const s = get(game);
  s.game.lizhi.add(0);
  if (opts.shuvari) s.game.shuvariActive[0] = true;
  return s;
}

describe('シュバリ中のツモ和了は見逃せない [シュバポツモ強制]', () => {
  beforeEach(() => {
    game.reset();
  });

  it('前提: p5 をツモって canTsumo=true になる', () => {
    const s = setupTsumoReady({ shuvari: false });
    expect(s.lastZimo).toBe('p5');
    expect(s.game.canTsumo(0)).toBe(true);
  });

  it('シュバリ中はツモ牌を打牌できない [ツモ宣言を強制]', () => {
    setupTsumoReady({ shuvari: true });
    game.discard('p5');
    const after = get(game);
    // 打牌は成立していない: 河は空のまま、ツモ牌も手牌に残る
    expect(after.lastDapai).toBeNull();
    expect(after.game.discardLog[0].length).toBe(0);
    expect(after.message).toContain('見逃し不可');
    expect(after.game.canTsumo(0)).toBe(true);
  });

  it('シュバリ中でもツモ宣言そのものは通る', () => {
    setupTsumoReady({ shuvari: true });
    game.tsumo();
    const after = get(game);
    expect(after.lastWinner).toBe(0);
  });

  it('通常リーチ [シュバなし] のツモは従来どおり見逃せる', () => {
    setupTsumoReady({ shuvari: false });
    game.discard('p5');
    const after = get(game);
    expect(after.game.discardLog[0].length).toBe(1);
    expect(after.game.discardLog[0][0].pai).toBe('p5');
  });

  it('シュバリでもツモ和了できない局面の打牌は通る', () => {
    // 和了牌ではない牌をツモった場合、シュバリでもツモ切りできる
    game.resetDebug(TENPAI_P5_WAIT, [], { forceShan: ['z7'] });
    const s = get(game);
    s.game.lizhi.add(0);
    s.game.shuvariActive[0] = true;
    expect(s.game.canTsumo(0)).toBe(false);
    game.discard('z7');
    const after = get(game);
    expect(after.game.discardLog[0].length).toBe(1);
  });
});
