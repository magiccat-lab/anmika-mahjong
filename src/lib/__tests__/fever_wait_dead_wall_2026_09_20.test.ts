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
  it('嶺上 + 未公開ドラ表 + 裏ドラ の合計と一致する', () => {
    const shan = new Shan3(defaultSanmaRule());
    const hiddenBaopai = shan.baopai.length - shan.displayBaopai.length;
    // 裏ドラは局の途中では表にしないので全部 [2026-10-24 リョー「裏ドラは上がるまで捲らない」]
    const hiddenFubaopai = shan.fubaopai?.length ?? 0;

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

// [通報 20261118_2 部屋 207N rev 66〜84「裏ドラがめくれたらフィーバーの待ち消してあげてね」]
// フィーバーのツモ和了で裏ドラ (s4 ・ z1) を全員に見せた後も、続行中の待ちの残りに数えていた
describe('和了で見せた裏ドラは待ちの残りから外す', () => {
  it('revealFubaopai の後は裏ドラ表が concealedDeadWall に居ない', () => {
    const shan = new Shan3(defaultSanmaRule());
    const ura = [...(shan.fubaopai ?? [])];
    expect(ura.length).toBeGreaterThan(0);
    const before = shan.concealedDeadWall.length;

    shan.revealFubaopai();

    expect(shan.concealedDeadWall.length).toBe(before - ura.length);
  });

  it('snapshot / restore で見せた枚数が戻る。無い旧 snapshot は 0', () => {
    const shan = new Shan3(defaultSanmaRule());
    shan.revealFubaopai();
    const snap = shan.snapshot();
    const other = new Shan3(defaultSanmaRule());
    other.restore(snap);
    expect(other.revealedFubaopaiLen).toBe(shan.fubaopai?.length ?? 0);

    const { revealedFubaopaiLen: _drop, ...legacy } = snap;
    other.restore(legacy as any);
    expect(other.revealedFubaopaiLen).toBe(0);
  });

  it('リーチ者の applyHule で表にし、リーチでない和了では表にしない', async () => {
    const { Game3 } = await import('../game3');
    const g = new Game3({ qijia: 0 });
    g.qipai();
    const fu = g.shan.fubaopai?.length ?? 0;
    expect(fu).toBeGreaterThan(0);
    g.applyHule({ fanshu: 2, fu: 30, hupai: [] }, 1, 0);
    expect(g.shan.revealedFubaopaiLen).toBe(0);
    g.lizhi.add(1);
    g.applyHule({ fanshu: 2, fu: 30, hupai: [] }, 1, 0);
    expect(g.shan.revealedFubaopaiLen).toBe(fu);
  });
});
