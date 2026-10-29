// 2026-10-29 リョー「フィーバー中の北抜きをオートにしといて」。
// 画面設定「自動抜き」が切でも、誰かのフィーバー中は北を自動で抜く。和了れる時は本人に任せる。
import { describe, it, expect } from 'vitest';
import { Game3 } from '../game3';
import { shouldAutoNukiBei } from '../store';
import type { PlayerId } from '../types';

function northDrawn(fever: 'none' | 'other' | 'self'): { g: Game3; me: PlayerId } {
  const g = new Game3();
  g.qipai();
  const me = g.lunbanToPlayerId(g.state.lunban);
  if (fever === 'other') g.feverActive[((me + 1) % 3) as PlayerId] = true;
  if (fever === 'self') g.feverActive[me] = true;
  const sp = g.shoupai.get(me) as any;
  sp._bingpai.z[4] = 1;
  sp._zimo = 'z4';
  return { g, me };
}

describe('フィーバー中の自動北抜き', () => {
  it('設定が切でも、他家のフィーバー中に北をツモったら抜く', () => {
    const { g, me } = northDrawn('other');
    expect(shouldAutoNukiBei(g, me, false)).toBe(true);
  });

  it('自分のフィーバー中も抜く', () => {
    const { g, me } = northDrawn('self');
    expect(shouldAutoNukiBei(g, me, false)).toBe(true);
  });

  it('フィーバーでなければ設定どおり [切なら抜かない、入なら抜く]', () => {
    const { g, me } = northDrawn('none');
    expect(shouldAutoNukiBei(g, me, false)).toBe(false);
    expect(shouldAutoNukiBei(g, me, true)).toBe(true);
  });

  it('和了れる時は抜かずに本人を待つ', () => {
    const { g, me } = northDrawn('other');
    g.canTsumo = () => true;
    expect(shouldAutoNukiBei(g, me, false)).toBe(false);
  });

  it('抜けない時 [北が無い] は何もしない', () => {
    const { g, me } = northDrawn('other');
    (g.shoupai.get(me) as any)._zimo = 'm1';
    expect(shouldAutoNukiBei(g, me, false)).toBe(false);
  });
});
