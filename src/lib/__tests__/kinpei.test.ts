import { describe, it, expect } from 'vitest';
import { Game3 } from '../game3';
import type { PlayerId } from '../types';

// setKinpeiChoice / autoResolveKinpei [金北強化選択] を unit 固定。
describe('Game3 setKinpeiChoice', () => {
  it('既選択済 player は false', () => {
    const g = new Game3();
    g.qipai();
    g.kinpeiTarget[0] = 'haru';
    g.goldHand[0] = { p: 0, s: 0, z: 1 };
    g.huapai[0] = ['f1'];
    expect(g.setKinpeiChoice(0 as PlayerId, 'natsu')).toBe(false);
    expect(g.kinpeiTarget[0]).toBe('haru'); // 変更ナシ
  });

  it('gN 持ち [goldHand.z=1] + 対象華牌持ち で 選択成功', () => {
    const g = new Game3();
    g.qipai();
    g.kinpeiTarget[0] = null;
    g.goldHand[0] = { p: 0, s: 0, z: 1 };
    g.huapai[0] = ['f4']; // 冬
    expect(g.setKinpeiChoice(0 as PlayerId, 'fuyu')).toBe(true);
    expect(g.kinpeiTarget[0]).toBe('fuyu');
  });

  it('gN ナシ + nukidoraGold ナシ で false', () => {
    const g = new Game3();
    g.qipai();
    g.kinpeiTarget[0] = null;
    g.goldHand[0] = { p: 0, s: 0, z: 0 };
    g.nukidoraGold[0] = 0;
    g.huapai[0] = ['f4'];
    expect(g.setKinpeiChoice(0 as PlayerId, 'fuyu')).toBe(false);
  });

  it('nukidoraGold あれば [goldHand.z=0 でも] 選択 OK', () => {
    const g = new Game3();
    g.qipai();
    g.kinpeiTarget[0] = null;
    g.goldHand[0] = { p: 0, s: 0, z: 0 };
    g.nukidoraGold[0] = 1;
    g.huapai[0] = ['f3']; // 秋
    expect(g.setKinpeiChoice(0 as PlayerId, 'aki')).toBe(true);
    expect(g.kinpeiTarget[0]).toBe('aki');
  });

  it('対応華牌持ってない target は false', () => {
    const g = new Game3();
    g.qipai();
    g.kinpeiTarget[0] = null;
    g.goldHand[0] = { p: 0, s: 0, z: 1 };
    g.huapai[0] = ['f1']; // 春のみ持ち
    expect(g.setKinpeiChoice(0 as PlayerId, 'fuyu')).toBe(false); // f4 ナシ
    expect(g.kinpeiTarget[0]).toBe(null);
  });
});

describe('Game3 autoResolveKinpei', () => {
  it('既選択済は no-op', () => {
    const g = new Game3();
    g.qipai();
    g.kinpeiTarget[0] = 'haru';
    g.goldHand[0] = { p: 0, s: 0, z: 1 };
    g.huapai[0] = ['f4', 'f4'];
    g.autoResolveKinpei(0 as PlayerId);
    expect(g.kinpeiTarget[0]).toBe('haru');
  });

  it('gN + 抜き 完全ナシ なら no-op [kinpeiTarget=null のまま]', () => {
    const g = new Game3();
    g.qipai();
    g.kinpeiTarget[0] = null;
    g.goldHand[0] = { p: 0, s: 0, z: 0 };
    g.nukidoraGold[0] = 0;
    g.autoResolveKinpei(0 as PlayerId);
    expect(g.kinpeiTarget[0]).toBeNull();
  });

  it('優先順 fuyu>=2 が最優先', () => {
    const g = new Game3();
    g.qipai();
    g.kinpeiTarget[0] = null;
    g.goldHand[0] = { p: 0, s: 0, z: 1 };
    g.huapai[0] = ['f1','f1','f4','f4'];
    g.autoResolveKinpei(0 as PlayerId);
    expect(g.kinpeiTarget[0]).toBe('fuyu');
  });

  it('優先順 aki>=2 で 秋', () => {
    const g = new Game3();
    g.qipai();
    g.kinpeiTarget[0] = null;
    g.goldHand[0] = { p: 0, s: 0, z: 1 };
    g.huapai[0] = ['f1','f3','f3'];
    g.autoResolveKinpei(0 as PlayerId);
    expect(g.kinpeiTarget[0]).toBe('aki');
  });

  it('1 件のみ pool でも fuyu>aki>natsu>haru の priority で選択', () => {
    const g = new Game3();
    g.qipai();
    g.kinpeiTarget[0] = null;
    g.goldHand[0] = { p: 0, s: 0, z: 1 };
    g.huapai[0] = ['f1','f2']; // 春 1 + 夏 1
    g.autoResolveKinpei(0 as PlayerId);
    // 夏 [f2] 優先 [natsu > haru]
    expect(g.kinpeiTarget[0]).toBe('natsu');
  });
});
