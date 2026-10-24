import { describe, expect, it, beforeEach } from 'vitest';
import { get } from 'svelte/store';
import { game, confirmPendingFeverBeforeDraw } from '../store';
import { buildShoupai } from '../game3';
import { toCorePai } from '../helpers';
import type { PlayerId } from '../types';

// 2026-10-24 リョー「裏ドラは上がるまで捲らないんだから山0まではめくるでしょ。ぽっちとかもあるかもだし」。
// 19:56 の東 3 局、ダブルフィーバー (7m ・ 3p のシャンポン) の 7m の最後の 1 枚が裏ドラの表示牌にあり、
// 宣言が通った所で流局していた。王牌の見えていない牌も残りに数え、ツモ山が尽きるまで続ける。

describe('フィーバーの待ちが王牌にだけ残っている時はツモ山が尽きるまで続ける', () => {
  beforeEach(() => {
    game.reset();
  });

  function arm(): any {
    const s: any = get(game);
    const g = s.game;
    const sp = buildShoupai(['m7', 'm7', 'p7', 'p7', 'p7', 's7', 's7', 's7', 'p3', 'p3', 'p4', 'p5', 'p6']);
    g.shoupai.set(1 as PlayerId, sp);
    g.lizhi.add(1 as PlayerId);
    g.feverActive[1] = true;
    g.feverDeclareTing[1] = ['m7', 'p3'];
    const shan = g.shan as any;
    const notWait = (p: string) => toCorePai(p).replace('0', '5') !== 'm7' && toCorePai(p).replace('0', '5') !== 'p3';
    for (const k of ['_pai', '_rinshan', '_fubaopai']) shan[k] = (shan[k] as string[] ?? []).filter(notWait);
    shan._baopai = (shan._baopai as string[]).map((p) => (notWait(p) ? p : 's1'));
    return s;
  }

  it('裏ドラの表示牌に 7m があれば宣言が通っても流局しない', () => {
    const s = arm();
    const shan = s.game.shan as any;
    shan._fubaopai = ['m7', ...((shan._fubaopai as string[]) ?? []).slice(1)];
    expect(s.game.isFeverWaitExhausted(1)).toBe(false);
    const after = confirmPendingFeverBeforeDraw(s);
    expect(after.pendingPingju || after.roundEnded).toBeFalsy();
  });

  it('嶺上 (華の補充が届かない深さ) にあっても続ける', () => {
    const s = arm();
    const shan = s.game.shan as any;
    shan._pai = (shan._pai as string[]).filter((p) => !String(p).startsWith('f'));
    shan._rinshan = [...(shan._rinshan as string[]), 'p3'];
    expect(s.game.isFeverWaitExhausted(1)).toBe(false);
  });

  it('ツモ山が 0 になったら王牌に待ちがあっても枯れ扱い [引けないので]', () => {
    const s = arm();
    const shan = s.game.shan as any;
    shan._fubaopai = ['m7', ...((shan._fubaopai as string[]) ?? []).slice(1)];
    shan._pai = [];
    expect(s.game.isFeverWaitExhausted(1)).toBe(true);
  });

  it('王牌にも山にも無ければ今までどおり流局', () => {
    const s = arm();
    expect(s.game.isFeverWaitExhausted(1)).toBe(true);
    const after = confirmPendingFeverBeforeDraw(s);
    expect(after.pendingPingju || after.roundEnded).toBe(true);
  });
});
