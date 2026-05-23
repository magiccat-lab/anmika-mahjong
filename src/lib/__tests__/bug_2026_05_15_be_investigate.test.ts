import { describe, it, expect } from 'vitest';
import { Game3, buildShoupai } from '../game3';
import type { PlayerId } from '../types';

// 2026-05-15 bug B / E 真因切り分け用 investigation test
//   B: 8000以下打点 100の位 切り上げになってない [リョー報告]
//      → applyHule 内 ceil100(base*N) は 各 pay 単位で 切り上げ済、 一見 正常
//      → ロン total = ronPay + benbang*2000 で benbang=0 なら 100単位 守る、 確認
//   E: 副露ありロン + 夏 lv up + 冬 [アリス祝儀] で defen ゼロサム不成立
//      → applyHule + applyChipsOnHule [chip = chipLedger 別管理] 後、 state.defen 合計が 0 か確認
//
// このファイルは 「真因 / fix 仕様判断保留」 を 明示的に 確認するため、 期待値に
// それぞれ 注釈を 入れる。 不一致 [bug 再現] したら fix 指針が 確定。

function makeGame(): { g: Game3 } {
  const g = new Game3();
  g.qipai();
  g.diyizimo = false;
  return { g };
}

describe('bug B: 8000以下打点 100単位切り上げ', () => {
  it('子 30符 2翻 ロン: ronPay = 2000 [base 480 → 1920 → ceil100 = 2000]', () => {
    const { g } = makeGame();
    const beforeDefen = { ...g.state.defen };
    const winner = 0 as PlayerId;
    const loser = 1 as PlayerId;
    g.state.benbang = 0;
    g.state.lizhibang = 0;
    // 親は P0 以外 [winner=0 を 子 にする]
    g.state.qijia = 1;
    g.state.jushu = 0;
    g.applyHule({ fanshu: 2, fu: 30, hupai: [] }, winner, loser);
    expect(g.state.defen[winner] - beforeDefen[winner]).toBe(2000);
    expect(g.state.defen[loser] - beforeDefen[loser]).toBe(-2000);
  });

  it('子 40符 1翻 ロン: ronPay = 1300 [base 320 → 1280 → ceil100 = 1300]', () => {
    const { g } = makeGame();
    const beforeDefen = { ...g.state.defen };
    const winner = 0 as PlayerId;
    const loser = 1 as PlayerId;
    g.state.benbang = 0;
    g.state.lizhibang = 0;
    g.state.qijia = 1;
    g.state.jushu = 0;
    g.applyHule({ fanshu: 1, fu: 40, hupai: [] }, winner, loser);
    expect(g.state.defen[winner] - beforeDefen[winner]).toBe(1300);
    expect(g.state.defen[loser] - beforeDefen[loser]).toBe(-1300);
  });

  it('子 30符 2翻 ツモ: 親 1000 + 子 500 = 1500 winner gain', () => {
    const { g } = makeGame();
    const beforeDefen = { ...g.state.defen };
    const winner = 0 as PlayerId;
    g.state.benbang = 0;
    g.state.lizhibang = 0;
    g.state.qijia = 1;
    g.state.jushu = 0;
    g.applyHule({ fanshu: 2, fu: 30, hupai: [] }, winner, null);
    // 親 koPay = ceil100(480*2) + 0 + 1000 = 1000 + 1000 = 2000
    // 子 koPay = ceil100(480*1) + 0 + 1000 = 500 + 1000 = 1500
    // winnerGain = 2000 + 1500 = 3500
    expect(g.state.defen[winner] - beforeDefen[winner]).toBe(3500);
  });
});

describe('bug E: 副露あり ロン + 夏 1 で defen ゼロサム', () => {
  it('副露あり 子 ロン 4翻30符 + 夏 1 [Lv4→6] [11→13翻 boost]: 全 defen delta 合計 = 0', () => {
    const { g } = makeGame();
    g.state.benbang = 0;
    g.state.lizhibang = 0;
    g.state.qijia = 0;
    g.state.jushu = 0;
    // winner=1 [子]、 loser=0 [親]
    const winner = 1 as PlayerId;
    const loser = 0 as PlayerId;
    // 副露ありを偽装
    const sp = g.shoupai.get(winner) as any;
    sp._fulou = ['p123-'];
    g.huapai[winner] = ['f2']; // 夏 1 つ
    g.kinpeiTarget[winner] = null;
    const beforeDefen = { ...g.state.defen };
    // 夏効果は applyHuapaiEffect で fanshu boost、 hupai に「夏 [打点ランクアップ ...翻相当]」 push
    const result: any = { fanshu: 4, fu: 30, hupai: [{ name: '抜きドラ', fanshu: 1 }] };
    g.applyHuapaiEffect(result, winner);
    g.applyHule(result, winner, loser);
    g.applyChipsOnHule(result, winner, loser);
    const sumDelta = ([0, 1, 2] as PlayerId[])
      .map((p) => g.state.defen[p] - beforeDefen[p])
      .reduce((a, b) => a + b, 0);
    // 期待: ゼロサム [defen は 通常打点のみ、 chip は別 ledger]
    expect(sumDelta).toBe(0);
  });
});
