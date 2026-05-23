import { describe, it, expect } from 'vitest';
import { saveSnapshot, restoreSnapshot } from '../game3/snapshot';

// 金北選択変更時の rollback 用 snapshot/restore の挙動 verify。
function makeRefs(overrides: Partial<any> = {}): any {
  return {
    defen: { 0: 35000, 1: 35000, 2: 35000 },
    chipLedger: { 0: 0, 1: 0, 2: 0 },
    akiUsedCount: { 0: 0, 1: 0, 2: 0 },
    feverActive: { 0: false, 1: false, 2: false },
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
    expect(snap.defen[0]).toBe(35000);
    expect(snap.chipLedger[1]).toBe(0);
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
    restoreSnapshot(refs, snap);
    expect(refs.defen[0]).toBe(35000);
    expect(refs.chipLedger[1]).toBe(0);
    expect(refs.feverActive[2]).toBe(false);
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
