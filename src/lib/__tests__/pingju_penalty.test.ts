import { describe, it, expect } from 'vitest';
import { game, applyPingjuTransition } from '../store';
import { buildShoupai } from '../game3';
import { get } from 'svelte/store';

// アンミカルール 2026-05-23 audit: ノーテン流局なし。
// 流局時はテンパイ/ノーテンに関わらず点数移動なし [罰符 0]。
describe('流局 点数移動なし [ノーテン罰符 廃止]', () => {
  it('1人テンパイ 2人ノーテン でも全員 35000 のまま', () => {
    game.reset();
    const s: any = get(game);
    s.game.shoupai.set(0, buildShoupai(['p1','p1','p1','p2','p2','p2','p3','p3','p3','s7','s7','s7','s8']));
    s.game.shoupai.set(1, buildShoupai(['p1','p3','p5','p7','p9','s1','s3','s5','s7','s9','z1','z2','z3']));
    s.game.shoupai.set(2, buildShoupai(['m7','m9','p1','p3','p5','s1','s3','s5','s7','z1','z2','z3','z6']));
    s.game.he.get(0)._pai = ['p2'];
    s.game.he.get(1)._pai = ['p2'];
    s.game.he.get(2)._pai = ['p2'];

    applyPingjuTransition(s, '');

    expect(s.game.state.defen[0]).toBe(35000);
    expect(s.game.state.defen[1]).toBe(35000);
    expect(s.game.state.defen[2]).toBe(35000);
    expect(s.message).toContain('点数移動なし');
  });

  it('2人テンパイ 1人ノーテン でも全員 35000 のまま', () => {
    game.reset();
    const s: any = get(game);
    const tenpai = ['p1','p1','p1','p2','p2','p2','p3','p3','p3','s7','s7','s7','s8'];
    s.game.shoupai.set(0, buildShoupai(tenpai));
    s.game.shoupai.set(1, buildShoupai(tenpai));
    s.game.shoupai.set(2, buildShoupai(['m7','m9','p1','p3','p5','s1','s3','s5','s7','z1','z2','z3','z6']));
    s.game.he.get(0)._pai = ['p2'];
    s.game.he.get(1)._pai = ['p2'];
    s.game.he.get(2)._pai = ['p2'];

    applyPingjuTransition(s, '');

    expect(s.game.state.defen[0]).toBe(35000);
    expect(s.game.state.defen[1]).toBe(35000);
    expect(s.game.state.defen[2]).toBe(35000);
    expect(s.message).toContain('点数移動なし');
  });
});
