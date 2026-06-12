import { describe, it, expect } from 'vitest';
import { saveSnapshot, restoreSnapshot } from '../game3/snapshot';

// 金北選択変更時の rollback 用 snapshot/restore の挙動 verify。
function makeRefs(overrides: Partial<any> = {}): any {
  return {
    defen: { 0: 35000, 1: 35000, 2: 35000 },
    chipLedger: { 0: 0, 1: 0, 2: 0 },
    akiUsedCount: { 0: 0, 1: 0, 2: 0 },
    feverActive: { 0: false, 1: false, 2: false },
    goldHand: { 0: { p: 1, s: 0, z: 0 }, 1: { p: 0, s: 1, z: 0 }, 2: { p: 0, s: 0, z: 1 } },
    pochiHand: {
      0: { blue: 1, red: 0, green: 0, yellow: 0 },
      1: { blue: 0, red: 1, green: 0, yellow: 0 },
      2: { blue: 0, red: 0, green: 1, yellow: 0 },
    },
    huapai: { 0: ['f1'], 1: ['f2'], 2: ['f3'] },
    nukidora: { 0: 1, 1: 0, 2: 0 },
    nukidoraGold: { 0: 0, 1: 1, 2: 0 },
    kinpeiTarget: { 0: 'haru', 1: null, 2: 'aki' },
    shan: {
      _pai: ['m7', 'm9', 'p1', 'p2'],
      _baopai: ['m7', 'p1'],
      _fubaopai: ['s1', 's2'],
      get baopai() { return this._baopai.slice(2); },
      get fubaopai() { return this._fubaopai.slice(2); },
    },
    ...overrides,
  };
}

describe('saveSnapshot', () => {
  it('defen / chip / aki / fever を deep copy する [参照独立]', () => {
    const refs = makeRefs();
    const snap = saveSnapshot(refs);
    refs.defen[0] = 99999;
    refs.chipLedger[1] = 88;
    refs.goldHand[0].p = 0;
    refs.pochiHand[1].red = 0;
    refs.huapai[2].push('f4');
    expect(snap.defen[0]).toBe(35000);
    expect(snap.chipLedger[1]).toBe(0);
    expect(snap.goldHand[0].p).toBe(1);
    expect(snap.pochiHand[1].red).toBe(1);
    expect(snap.huapai[2]).toEqual(['f3']);
  });

  it('baopai / fubaopai 長さを記録 [後の復元 用]', () => {
    const refs = makeRefs();
    const snap = saveSnapshot(refs);
    // baopai は slice(2)、 _baopai = ['m7','p1'] → baopai = []
    expect(snap.baopaiLen).toBe(0);
    expect(snap.fubaopaiLen).toBe(0);
  });
});

describe('restoreSnapshot', () => {
  it('null snap は no-op', () => {
    const refs = makeRefs();
    expect(() => restoreSnapshot(refs, null)).not.toThrow();
    expect(refs.defen[0]).toBe(35000);
  });

  it('defen / chip / aki / fever を snap 値に書き戻す [in-place mutate]', () => {
    const refs = makeRefs();
    const snap = saveSnapshot(refs);
    const beforeRef = refs.defen;
    refs.defen[0] = 99999;
    refs.chipLedger[1] = 50;
    refs.feverActive[2] = true;
    refs.goldHand[2].z = 0;
    refs.pochiHand[0].blue = 0;
    refs.huapai[0].push('f4');
    refs.nukidora[0] = 0;
    refs.nukidoraGold[1] = 0;
    refs.kinpeiTarget[2] = null;
    restoreSnapshot(refs, snap);
    expect(refs.defen[0]).toBe(35000);
    expect(refs.chipLedger[1]).toBe(0);
    expect(refs.feverActive[2]).toBe(false);
    expect(refs.goldHand[2].z).toBe(1);
    expect(refs.pochiHand[0].blue).toBe(1);
    expect(refs.huapai[0]).toEqual(['f1']);
    expect(refs.nukidora[0]).toBe(1);
    expect(refs.nukidoraGold[1]).toBe(1);
    expect(refs.kinpeiTarget[2]).toBe('aki');
    // mutate-in-place なので 参照同一
    expect(refs.defen).toBe(beforeRef);
  });

  it('baopai 増加分を pop して山末尾に戻す', () => {
    const refs = makeRefs();
    const snap = saveSnapshot(refs);
    // hule 後 baopai が増えた状態を 模擬: _baopai に 1 件 push → baopai len 1
    refs.shan._baopai.push('p3');
    expect(refs.shan.baopai.length).toBe(1);
    const shanLenBefore = refs.shan._pai.length;
    restoreSnapshot(refs, snap);
    expect(refs.shan.baopai.length).toBe(0);
    // 戻された tile は _pai 末尾に追加
    expect(refs.shan._pai.length).toBe(shanLenBefore + 1);
    expect(refs.shan._pai[refs.shan._pai.length - 1]).toBe('p3');
  });

  it('fubaopai も同様に pop + 山戻し', () => {
    const refs = makeRefs();
    const snap = saveSnapshot(refs);
    refs.shan._fubaopai.push('s9');
    expect(refs.shan.fubaopai.length).toBe(1);
    const shanLenBefore = refs.shan._pai.length;
    restoreSnapshot(refs, snap);
    expect(refs.shan.fubaopai.length).toBe(0);
    expect(refs.shan._pai.length).toBe(shanLenBefore + 1);
    expect(refs.shan._pai[refs.shan._pai.length - 1]).toBe('s9');
  });
});
