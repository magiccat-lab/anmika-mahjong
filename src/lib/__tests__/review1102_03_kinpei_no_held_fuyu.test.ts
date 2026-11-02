// クラウドレビュー 11-02 #3 [リョー裁定: 逆のやめ権は下家だけ。28da56c が d1a8ea0 に優先]
// 逆ぽっちフィーバーで下家が冬を保留した後、金北の選び手 [同卓者 2 人] の上家が冬を選ぶと
// fuyuConsumed が立ってフィーバーが終わり、下家のやめ権を覆せていた。
// 期待: 下家が保留した冬は誰の金北でも強化先にできない [候補から外し、selectKinpei('fuyu') も通らない]
import { describe, it, expect, beforeEach } from 'vitest';
import { get } from 'svelte/store';
import { game } from '../store';
import { buildShoupai } from '../game3';

function arm(hua: string[]): any {
  const s: any = get(game);
  const g = s.game;
  const cur = g.lunbanToPlayerId(g.state.lunban);
  g.huapai[cur] = hua;
  g.lizhi.add(cur);
  g.feverActive[cur] = true;
  g.feverDeclareTing[cur] = ['m5'];
  g.pochiMultiplier[cur] = { defen: -1, chip: -1 };
  g.pochiPaymentMode[cur] = true;
  const sp = buildShoupai(['p1', 'p2', 'p3', 'p4', 'p5', 'p6', 's7', 's8', 's9', 'z1', 'z1', 'z1', 'm5']);
  sp.zimo('m5');
  g.shoupai.set(cur, sp);
  s.lastZimo = 'm5';
  const wall = g.shan as any;
  // 乱数のドラ表示の華を消して決定的にする
  wall._baopai = ['m1']; wall._fubaopai = ['m2']; wall._committedBaopaiLen = 1; wall._committedFubaopaiLen = 1;
  wall._pai.push('m5', 'm3', 's5', 'p8', 'z2');
  for (let i = 0; i < 4; i++) wall._pai.push('m5');
  wall._pai.unshift('z1', 'z2');
  g.nukidoraGold[cur] = 1;
  for (const p of [0, 1, 2]) s.cpu[p] = false;
  const shimocha = (cur + 2) % 3;
  const kamicha = [0, 1, 2].find((p) => p !== cur && p !== shimocha)!;
  return { s, g, cur, shimocha, kamicha };
}

describe('review 11-02 #3: 逆で下家が保留した冬は、誰の金北でも強化先にできない', () => {
  beforeEach(() => { game.reset(); });

  it('全員人間 [冬 + 夏]: 下家が保留 → 金北の候補に冬が無く、冬を選んでも通らない', () => {
    const { cur, shimocha, kamicha } = arm(['f4', 'f2']);
    game.tsumo();
    const mid: any = get(game);
    expect(mid.pendingFuyu?.decisionOwners).toEqual([shimocha]);
    game.selectFuyu(false);
    const mid2: any = get(game);
    expect(mid2.pendingKinpei?.decisionOwners).toContain(kamicha);
    expect(mid2.pendingKinpei?.availableHuapai).not.toContain('f4');
    game.selectKinpei('fuyu');
    const after: any = get(game);
    expect(after.game.fuyuConsumed[cur]).toBe(false);
    expect(after.game.feverActive[cur]).toBe(true);
    expect(after.pendingKinpei).not.toBeNull();
    game.selectKinpei('natsu');
    const done: any = get(game);
    expect(done.pendingKinpei).toBeNull();
    expect(done.game.kinpeiTarget[cur]).toBe('natsu');
    expect(done.game.fuyuConsumed[cur]).toBe(false);
  });

  it('全員人間 [冬だけ]: 下家が保留 → 冬は使われない', () => {
    const { cur } = arm(['f4']);
    game.tsumo();
    game.selectFuyu(false);
    const mid: any = get(game);
    if (mid.pendingKinpei) {
      expect(mid.pendingKinpei.availableHuapai).not.toContain('f4');
      game.selectKinpei('fuyu');
    }
    const after: any = get(game);
    expect(after.game.fuyuConsumed[cur]).toBe(false);
    expect(after.game.kinpeiTarget[cur]).not.toBe('fuyu');
  });

  it('下家が「使う」なら冬は候補に残る [対照]', () => {
    const { cur } = arm(['f4', 'f2']);
    game.tsumo();
    game.selectFuyu(true);
    const mid: any = get(game);
    expect(mid.game.fuyuConsumed[cur]).toBe(true);
    if (mid.pendingKinpei) expect(mid.pendingKinpei.availableHuapai).toContain('f4');
  });
});
