// [リョー裁定 2026-09-20 「フィーバーの待ち表示はちゃんと出して、王牌も含んだ枚数で」]
//
// 元の問題 (堅牢性レビュー 2026-09-20 のネタバレ経路 2 本目): 待ちの残り枚数を
// live wall の現物だけから数えていた。待ち牌が王牌 (嶺上 / ドラ表の裏 / 裏ドラ) に
// 落ちると残りが減るので、「山に無い = 王牌に居る」が引き算で分かってしまう。
//
// 裁定は「表示は出す。ただし王牌も含んだ枚数で」。数字の意味が
// 「まだ見えていない枚数」になり、王牌の中身は推定できなくなる。
import { describe, expect, it } from 'vitest';
import { feverWaitInfoFromLiveWall } from '../game3/feverLizhi';
import { Shan3, defaultSanmaRule } from '../shan3';

describe('FEVER 待ち表示の枚数 [王牌込み]', () => {
  it('同じ牌が山にあっても王牌にあっても合計が変わらない', () => {
    const waits = ['p5'];
    // 4 枚のうち 2 枚が live wall、2 枚が王牌に落ちている状態
    const liveOnly = feverWaitInfoFromLiveWall(waits, ['p5', 'p5', 'p3']);
    const withDeadWall = feverWaitInfoFromLiveWall(waits, ['p5', 'p5', 'p3', 'p5', 'p5']);

    expect(liveOnly[0].remain).toBe(2);
    // 王牌の 2 枚を足すと 4 枚。ここが「見えていない枚数」
    expect(withDeadWall[0].remain).toBe(4);
  });

  it('赤・金・虹の有無も王牌側の現物を拾う', () => {
    const rows = feverWaitInfoFromLiveWall(['p5'], ['p5', 'p0', 'gp']);
    expect(rows[0]).toEqual({ tile: 'p5', remain: 3, hasRed: true, hasGold: true, hasNiji: false });
  });
});

describe('Shan3.concealedDeadWall', () => {
  it('嶺上 + 未公開ドラ表 + 未公開裏ドラ の合計と一致する', () => {
    const shan = new Shan3(defaultSanmaRule());
    const hiddenBaopai = shan.baopai.length - shan.displayBaopai.length;
    const hiddenFubaopai = (shan.fubaopai?.length ?? 0) - (shan.displayFubaopai?.length ?? 0);

    expect(shan.concealedDeadWall.length).toBe(
      shan.rinshanRemaining + hiddenBaopai + hiddenFubaopai,
    );
  });

  it('公開済みのドラ表は含めない [見えている牌を残りと数えない]', () => {
    const shan = new Shan3(defaultSanmaRule());
    const dead = shan.concealedDeadWall;

    // 公開済みの表ドラそのもの (物理牌) が王牌側に二重に現れないこと。
    // displayBaopai は _baopai の先頭から確定枚数ぶんで、concealedDeadWall は
    // その後ろだけを取る
    const deadFromBaopai = shan.baopai.slice(shan.displayBaopai.length);
    for (const pai of shan.displayBaopai) {
      expect(deadFromBaopai).not.toContain(pai);
    }
    expect(dead.length).toBeGreaterThan(0);
  });

  it('blind [online の projection] は現物を持たないので空', () => {
    const blind = Shan3.createBlind({
      rule: defaultSanmaRule(),
      baopai: ['p1'],
      fubaopai: null,
      paishu: 40,
    });
    expect(blind.concealedDeadWall).toEqual([]);
  });
});
