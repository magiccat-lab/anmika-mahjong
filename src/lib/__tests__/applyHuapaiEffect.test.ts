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

  it('夏金北 [natsu=1 + kinpeiTarget=natsu] で 夏 2 段相当', () => {
    const g = new Game3();
    g.qipai();
    const player = 0 as PlayerId;
    g.huapai[player] = ['f2'];
    g.kinpeiTarget[player] = 'natsu';
    g.goldHand[player] = { p: 0, s: 0, z: 1 };
    const result = { fanshu: 1, fu: 30, hupai: [] } as any;
    g.applyHuapaiEffect(result, player);
    // 夏単体 1 → 夏金北で natsu=2 相当 = 2 段ランクアップ
    // fanshu 1 → Lv1 → Lv3 [3 翻]
    expect(result.fanshu).toBe(3);
    expect(result.hupai.some((h: any) => h.name.includes('夏金北'))).toBe(true);
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
