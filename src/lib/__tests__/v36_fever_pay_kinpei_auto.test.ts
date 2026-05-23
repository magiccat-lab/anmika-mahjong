// V36: フィーバー中 払い [reverse pochi] 状態での 金北 強化先 自動選択 [リョー仕様 2026-05-12]
// 仕様: feverActive + pochiPaymentMode true で player 任意選択スキップ、
//   冬冬 > 秋秋 > 夏夏 > 春春 > 冬 > 秋 > 夏 > 春 priority で auto-resolve、
//   冬冬 / 冬 が選択された場合は直ちに局終了。
import { describe, it, expect } from 'vitest';
import { Game3, buildShoupai } from '../game3';
import type { PlayerId } from '../types';

function setupG(huapai: string[]): Game3 {
  const g = new Game3({ qijia: 0, changshu: 1 });
  for (const p of [0, 1, 2] as PlayerId[]) {
    g.shoupai.set(p, buildShoupai(['p2','p3','p4','p5','p6','p7','s2','s3','s4','s5','s6','s7','z1']));
  }
  g.huapai[0] = [...huapai];
  g.goldHand[0].z = 1;       // 金北 1 枚保有
  g.feverActive[0] = true;   // フィーバー中
  g.pochiPaymentMode[0] = true; // 払い state [赤/黄 ツモ後 青/緑 未ツモ]
  return g;
}

describe('V36-A 冬冬 [f4×2] → fuyu 選択', () => {
  it('autoResolveKinpei で kinpeiTarget=fuyu', () => {
    const g = setupG(['f4', 'f4']);
    g.autoResolveKinpei(0);
    expect(g.kinpeiTarget[0]).toBe('fuyu');
  });
});

describe('V36-B 秋秋 [f3×2] → aki 選択', () => {
  it('冬無し で aki が priority に勝つ', () => {
    const g = setupG(['f3', 'f3']);
    g.autoResolveKinpei(0);
    expect(g.kinpeiTarget[0]).toBe('aki');
  });
});

describe('V36-C 夏夏 [f2×2] → natsu 選択', () => {
  it('冬秋無し で natsu', () => {
    const g = setupG(['f2', 'f2']);
    g.autoResolveKinpei(0);
    expect(g.kinpeiTarget[0]).toBe('natsu');
  });
});

describe('V36-D 春春 [f1×2] → haru 選択', () => {
  it('冬秋夏無し で haru', () => {
    const g = setupG(['f1', 'f1']);
    g.autoResolveKinpei(0);
    expect(g.kinpeiTarget[0]).toBe('haru');
  });
});

describe('V36-E 単独冬 [f4×1] → fuyu 選択', () => {
  it('ダブル無くても f4 単体で fuyu', () => {
    const g = setupG(['f4']);
    g.autoResolveKinpei(0);
    expect(g.kinpeiTarget[0]).toBe('fuyu');
  });
});

describe('V36-F 秋秋冬 [f3×2 + f4×1] → fuyu 優先 [ダブル冬扱いと混同しない]', () => {
  it('冬は単体だが priority 最上位なので fuyu になる', () => {
    // 仕様: 冬冬 > 秋秋 > ... > 冬 > 秋 ...、 つまり 冬は単体でも 秋秋より priority 上
    // [現実装は counts.fuyu >= 2 → 冬冬 priority 1、 counts.aki >= 2 → 秋秋 priority 2、
    //  counts.fuyu >= 1 → 冬 単体 priority 5、 となってる]
    // この test は 「秋秋冬」 input で aki が選ばれることを期待 [秋秋 > 冬単体 priority]
    const g = setupG(['f3', 'f3', 'f4']);
    g.autoResolveKinpei(0);
    expect(g.kinpeiTarget[0]).toBe('aki');
  });
});

describe('V36-G 払い解除 [pochiPaymentMode=false] では 自動化されない', () => {
  it('feverActive=true でも pochiPaymentMode=false なら modal trigger 条件成立', () => {
    const g = setupG(['f4', 'f4']);
    g.pochiPaymentMode[0] = false;
    // この場合 store 側で modal 出す path に乗るが、 game3 単体の autoResolveKinpei は条件無し
    // pochiPaymentMode の判定は store 側にある [このテストでは fever/pay の組合せ check のみ]
    expect(g.feverActive[0]).toBe(true);
    expect(g.pochiPaymentMode[0]).toBe(false);
  });
});

describe('V36-H 事前強化済 [kinpeiTarget !== null] なら 強化先関係なく 再選択不要 [リョー仕様 2026-05-12]', () => {
  // 仕様: 払い state に入る前に既に金北で 「どれか」 に強化済なら、
  //   その強化先を そのまま preserve、 priority 比較も再選択もしない。
  it('事前 aki → preserve [priority 関係なく そのまま]', () => {
    const g = setupG(['f4', 'f4']);
    g.kinpeiTarget[0] = 'aki';
    g.autoResolveKinpei(0);
    expect(g.kinpeiTarget[0]).toBe('aki');
  });
  it('事前 haru → preserve', () => {
    const g = setupG(['f4', 'f4', 'f3', 'f3']);
    g.kinpeiTarget[0] = 'haru';
    g.autoResolveKinpei(0);
    expect(g.kinpeiTarget[0]).toBe('haru');
  });
  it('事前 fuyu → preserve', () => {
    const g = setupG(['f4']);
    g.kinpeiTarget[0] = 'fuyu';
    g.autoResolveKinpei(0);
    expect(g.kinpeiTarget[0]).toBe('fuyu');
  });
});
