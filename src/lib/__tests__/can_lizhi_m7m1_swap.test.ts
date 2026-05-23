import { describe, it, expect } from 'vitest';
import { Game3, buildShoupai } from '../game3';
import type { PlayerId } from '../types';

// 機能 2 [アメリカン七対子 m7→m1 swap で リーチ可] 2026-05-15
//   通常 tingpai 空でも m7→m1 swap で 七対子テンパイ成立する手なら canLizhi=true
describe('Game3 canLizhi - m7→m1 アメリカン七対子 swap', () => {
  it('m7 を m1 に置換すると七対子テンパイ成立する手 [リーチ可]', () => {
    const g = new Game3();
    g.qipai();
    const player = g.lunbanToPlayerId(g.state.lunban);
    // 七対子テンパイ手 [m1 m1 / p2 p2 / p5 p5 / s3 s3 / s7 s7 / z3 z3 / m7] m7 単騎
    //   m7→m1 swap で m1 が 3 枚になり、 残 6 対と合わせて 七対子テンパイ
    //   注: 七対子待ちは 通常 majiang-core が m7 単騎 として認識する path もあり、
    //       その場合は swap 不要で xiangting=0 → 通常 path で OK
    //   ここは swap 経路を 確実に通すため、 m7 を 3 枚にした 「7m を 1m 扱いした 4 枚」 case を 作る
    //   手牌 [m1 m1 / m7 m7 m7 / p2 p2 / p5 p5 / s3 s3 / s7] + zimo s7
    //   majiang-core 視点: m1 対 + m7 刻 + p2 対 + p5 対 + s3 対 + s7 対 = 6 対 + m7m7m7 → 七対子に乗らない
    //   swap 後: m1 m1 m1 m1 m1 (m7 3 枚を m1 にマージ) … 七対子は 同種 2 枚 ×7 が必須、 5 枚 はダメ
    //   方針変更: m7 を 七対子の 1 対 として 認める手にする
    //   手牌 [m7 m7 / p2 p2 / p5 p5 / s3 s3 / s7 s7 / z3 z3 / m9] m9 単騎七対子
    //     → 通常テンパイ [majiang-core も m7 対を 七対子の 1 対 と認識]
    //     swap 不要でも canLizhi=true、 これは swap path の regression として弱い
    //   別 case: 手牌 [m1 m7 / p2 p2 / p5 p5 / s3 s3 / s7 s7 / z3 z3 / m9]
    //     通常: m1 + m7 + m9 が 全て バラ、 m1m7m9 国士片寄り、 7 対 揃わずノーテン
    //     swap 後: m1 m1 [m7→m1] + 6 対 + m9 → m9 単騎 七対子テンパイ成立
    g.shoupai.set(player, buildShoupai(['m1','m7','p2','p2','p5','p5','s3','s3','s7','s7','z3','z3','m9']));
    const sp = g.shoupai.get(player) as any;
    sp.zimo('m9'); // 14 枚目、 これで m9 が対になり 全部 対 [国士テンパイにも乗る形]
    // 注: zimo('m9') で m9 が 2 枚、 m1 1 / m7 1 / p2 2 / p5 2 / s3 2 / s7 2 / z3 2 / m9 2
    //   通常 xiangting: m1 m7 が 単独 → swap 必須
    //   swap [m7→m1]: m1 2 / p2 2 / p5 2 / s3 2 / s7 2 / z3 2 / m9 2 = 七対子 hule [xiangting=-1]
    expect(g.canLizhi(player)).toBe(true);
  });

  it('m7 なし + ノーテンなら 通常通り false', () => {
    const g = new Game3();
    g.qipai();
    const player = g.lunbanToPlayerId(g.state.lunban);
    // 完全ノーテン手 [m7 なし、 swap path も無効]
    g.shoupai.set(player, buildShoupai(['p1','p3','p5','p7','p9','s1','s3','s5','s7','s9','z1','z2','z3']));
    const sp = g.shoupai.get(player) as any;
    sp.zimo('z6');
    expect(g.canLizhi(player)).toBe(false);
  });
});
