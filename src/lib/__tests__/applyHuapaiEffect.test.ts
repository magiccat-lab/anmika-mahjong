import { describe, it, expect } from 'vitest';
import { Game3 } from '../game3';
import type { PlayerId } from '../types';

// applyHuapaiEffect の挙動 [春/夏/秋/冬 + 金北効果] を unit 固定。
// hule result の hupai array を mutate するので、 result mock で 直接 verify。
describe('Game3 applyHuapaiEffect', () => {
  it('result が null や fanshu 未定義で no-op', () => {
    const g = new Game3();
    g.qipai();
    expect(() => g.applyHuapaiEffect(null, 0 as PlayerId)).not.toThrow();
    const result = {} as any;
    g.applyHuapaiEffect(result, 0 as PlayerId);
    expect(result.hupai).toBeUndefined();
  });

  it('秋 [f3] あり で hupai に 「秋 [ドラ表追加]」 entry 追加', () => {
    const g = new Game3();
    g.qipai();
    const player = 0 as PlayerId;
    g.huapai[player] = ['f3'];
    const result = { fanshu: 1, fu: 30, hupai: [] } as any;
    g.applyHuapaiEffect(result, player);
    expect(result.hupai.some((h: any) => h.name.startsWith('秋'))).toBe(true);
  });

  it('夏 [f2] あり で 打点 ランクアップ + fanshu 更新', () => {
    const g = new Game3();
    g.qipai();
    const player = 0 as PlayerId;
    g.huapai[player] = ['f2'];
    const result = { fanshu: 1, fu: 30, hupai: [] } as any;
    g.applyHuapaiEffect(result, player);
    expect(result.fanshu).toBeGreaterThan(1);
    expect(result.hupai.some((h: any) => h.name.includes('夏'))).toBe(true);
  });

  it('冬 [f4] あり で hupai に 「冬 [アリス祝儀のみ]」 entry 追加', () => {
    const g = new Game3();
    g.qipai();
    const player = 0 as PlayerId;
    g.huapai[player] = ['f4'];
    const result = { fanshu: 1, fu: 30, hupai: [] } as any;
    g.applyHuapaiEffect(result, player);
    expect(result.hupai.some((h: any) => h.name.startsWith('冬'))).toBe(true);
  });

  // [2026-09-14 リョー裁定「夏は向こうにあわせる」] 夏 1 枚に金北を当てても段は増えない。
  // 金北が夏に効くのは 夏 2 枚以上の時の ×4 だけ [旧: 夏金北単体 = 夏夏相当 2 段]
  it('夏金北 [natsu=1 + kinpeiTarget=natsu] は 夏 1 枚と同じ 1 段だけ', () => {
    const g = new Game3();
    g.qipai();
    const player = 0 as PlayerId;
    g.huapai[player] = ['f2'];
    g.kinpeiTarget[player] = 'natsu';
    g.goldHand[player] = { p: 0, s: 0, z: 1 };
    const result = { fanshu: 1, fu: 30, hupai: [] } as any;
    g.applyHuapaiEffect(result, player);
    // 1 翻 30 符 = 480 点 [満貫未満] なので 1 翻上がって 2 翻
    expect(result.fanshu).toBe(2);
    expect(result.hupai.some((h: any) => h.name.startsWith('夏'))).toBe(true);
  });

  it('夏夏金北 [natsu>=2 + kinpeiTarget=natsu] では打点 ランクアップ skip [base ×4 は別 path]', () => {
    const g = new Game3();
    g.qipai();
    const player = 0 as PlayerId;
    g.huapai[player] = ['f2', 'f2'];
    g.kinpeiTarget[player] = 'natsu';
    g.goldHand[player] = { p: 0, s: 0, z: 1 };
    const result = { fanshu: 1, fu: 30, hupai: [] } as any;
    g.applyHuapaiEffect(result, player);
    // natsuKinpeiActive=true で natsuEffect 適用 skip
    expect(result.fanshu).toBe(1); // 変化なし [applyChipsOnHule 側で base ×4]
  });

  // [2026-05-23 audit [10] regression] アンミカ rules: 夏夏単独は 2 ランクアップ、 ×4 ではない
  it('夏夏 [natsu=2、 金北なし] は 2 ランクアップ [打点 ×4 ではない]', () => {
    const g = new Game3();
    g.qipai();
    const player = 0 as PlayerId;
    g.huapai[player] = ['f2', 'f2'];
    g.kinpeiTarget[player] = null;
    g.goldHand[player] = { p: 0, s: 0, z: 0 };
    const result = { fanshu: 1, fu: 30, hupai: [] } as any;
    g.applyHuapaiEffect(result, player);
    // 1翻 [Lv1] → 2 ランクアップ → Lv3 = 3翻相当
    expect(result.fanshu).toBe(3);
    expect(result.hupai.some((h: any) => h.name.includes('夏夏'))).toBe(true);
  });

  // [2026-05-23 audit [10] regression] 夏単体 1 ランクアップ
  it('夏 [natsu=1、 金北なし] は 1 ランクアップ', () => {
    const g = new Game3();
    g.qipai();
    const player = 0 as PlayerId;
    g.huapai[player] = ['f2'];
    g.kinpeiTarget[player] = null;
    g.goldHand[player] = { p: 0, s: 0, z: 0 };
    const result = { fanshu: 1, fu: 30, hupai: [] } as any;
    g.applyHuapaiEffect(result, player);
    expect(result.fanshu).toBe(2);
    expect(result.hupai.some((h: any) => h.name.includes('夏'))).toBe(true);
  });

  // [2026-05-23 audit [10] regression] 夏金北 [夏 1 + 金北] = 2 ランクアップ
  it('満貫に届いたら翻ではなくランクが 1 段上がる [ルールブック 2-2 の梯子]', () => {
    const g = new Game3();
    g.qipai();
    const player = 0 as PlayerId;
    g.huapai[player] = ['f2'];
    // 5 翻 = 満貫 2000。夏 1 枚で 跳満 3000 へ
    const result = { fanshu: 5, fu: 30, hupai: [] } as any;
    g.applyHuapaiEffect(result, player);
    expect(result.fanshu).toBe(5);            // 翻は動かさない
    expect(result._basePointOverride).toBe(3000);
  });

  it('満貫未満は翻が 1 つ上がる [4 翻 25 符 = 1600 点は満貫ではない]', () => {
    const g = new Game3();
    g.qipai();
    const player = 0 as PlayerId;
    g.huapai[player] = ['f2'];
    const result = { fanshu: 4, fu: 25, hupai: [] } as any;
    g.applyHuapaiEffect(result, player);
    expect(result.fanshu).toBe(5);            // 5 翻 = 満貫
    expect(result._basePointOverride).toBeUndefined();
  });

  it('リーチ中なら fubaopai の華も hua candidate に含む', () => {
    const g = new Game3();
    g.qipai();
    const player = 0 as PlayerId;
    g.huapai[player] = [];
    g.lizhi.add(player);
    // fubaopai に f3 を仕込む
    (g.shan as any)._fubaopai = ['x', 'y', 'f3'];
    const result = { fanshu: 1, fu: 30, hupai: [] } as any;
    g.applyHuapaiEffect(result, player);
    expect(result.hupai.some((h: any) => h.name.startsWith('秋'))).toBe(true);
  });
});
