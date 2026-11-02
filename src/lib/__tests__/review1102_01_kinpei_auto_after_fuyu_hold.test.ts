// クラウドレビュー 11-02 #1: 逆ぽっちフィーバーで和了者が人間・同卓者 2 人が CPU [isFeverPayAuto] の時、
// 冬の段 [下家 CPU の自動判定 → resolveFuyuSelection] の後の金北が人間の和了者に出ていた。
// 冬を選ぶと fuyuConsumed が立ち、下家 CPU の「保留」が覆っていた。
// 期待: 金北の選び手 [同卓者] が全員 CPU なので自動で決める。保留した冬は強化先にしない
import { describe, it, expect, beforeEach } from 'vitest';
import { get } from 'svelte/store';
import { game, fuyuOwnerChipDelta, fuyuWaitRemainCount, shimochaFuyuDecision } from '../store';
import { buildShoupai } from '../game3';

function arm(hua: string[] = ['f4']): any {
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
  for (const p of [0, 1, 2]) s.cpu[p] = p !== cur;
  return { s, g, cur };
}

describe('review 11-02 #1: 人の和了者 + 同卓者 2 人 CPU の逆フィーバーで、下家 CPU の冬の保留の後の金北', () => {
  beforeEach(() => { game.reset(); });

  it('下家 CPU は保留と判定する局面 [前提]', () => {
    const { s, g, cur } = arm();
    const useNow = fuyuOwnerChipDelta(s, cur, null, true)!;
    const holdNow = fuyuOwnerChipDelta(s, cur, null, false)!;
    const d = shimochaFuyuDecision({ useNow, holdNow, waitRemain: fuyuWaitRemainCount(g, cur), shanRemain: g.shan.paishu });
    expect(d.use).toBe(false);
  });

  it('金北の選択は人間の和了者に出ず自動で決まる [isFeverPayAuto]', () => {
    arm();
    game.tsumo();
    const after: any = get(game);
    expect(String(after.message)).toContain('保留');
    expect(after.pendingKinpei).toBeNull();
  });

  it('保留した冬は金北の強化先にならず、冬は使われない', () => {
    const { cur } = arm(['f4', 'f2']);
    game.tsumo();
    const after: any = get(game);
    expect(after.pendingKinpei).toBeNull();
    expect(after.lastWinner).toBe(cur);
    expect(after.game.fuyuConsumed[cur]).toBe(false);
    expect(after.game.kinpeiTarget[cur]).toBe('natsu');
  });
});
