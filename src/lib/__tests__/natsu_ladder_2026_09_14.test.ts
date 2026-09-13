// 2026-09-14 リョー裁定「夏は向こうにあわせる」。
// ルールブック 2-2:「夏 = 打点ワンランクアップ（1ハン→2ハン→…→満貫→跳満→倍満→三倍満→役満→五倍満→六倍満）」
// 旧実装は fanshuLevel [4 翻なら符に関係なく満貫扱い] を通していたので、
// 4 翻 25 符 [1600 点 = 満貫未満] を満貫と見て 1 段多く上げていた。
// norosh1 の牌譜 2,820 局面で 基本点の差 199 → 138、完全一致 517 → 529。
import { describe, it, expect } from 'vitest';
import { Game3 } from '../game3';
import type { PlayerId } from '../types';

function apply(fanshu: number, fu: number, hua: string[], kinpei = false): any {
  const g = new Game3();
  g.qipai();
  const p = 0 as PlayerId;
  g.huapai[p] = [...hua];
  if (kinpei) {
    g.kinpeiTarget[p] = 'natsu';
    g.goldHand[p] = { p: 0, s: 0, z: 1 };
  }
  const result = { fanshu, fu, hupai: [] } as any;
  g.applyHuapaiEffect(result, p);
  return result;
}

describe('夏の梯子 [ルールブック 2-2]', () => {
  it('満貫未満は 1 翻ずつ上がる', () => {
    expect(apply(1, 30, ['f2']).fanshu).toBe(2);
    expect(apply(2, 30, ['f2']).fanshu).toBe(3);
  });

  it('4 翻 25 符 [1600 点] は満貫ではないので翻が上がる', () => {
    const r = apply(4, 25, ['f2']);
    expect(r.fanshu).toBe(5);
    expect(r._basePointOverride).toBeUndefined();
  });

  it('4 翻 30 符 [1920 点 = 切上満貫] はランクが上がる', () => {
    const r = apply(4, 30, ['f2']);
    expect(r.fanshu).toBe(4);
    expect(r._basePointOverride).toBe(3000);
  });

  it('満貫以上はランクが 1 段ずつ [満貫→跳満→倍満]', () => {
    expect(apply(5, 30, ['f2'])._basePointOverride).toBe(3000);
    expect(apply(6, 30, ['f2'])._basePointOverride).toBe(4000);
    expect(apply(11, 30, ['f2'])._basePointOverride).toBe(8000);
  });

  it('夏 2 枚は 2 段', () => {
    expect(apply(5, 30, ['f2', 'f2'])._basePointOverride).toBe(4000);
  });

  it('六倍満で頭打ち', () => {
    expect(apply(24, 30, ['f2', 'f2'])._basePointOverride).toBe(12000);
  });

  it('夏 1 枚に金北を当てても段は増えない [向こうに合わせる]', () => {
    const withKinpei = apply(5, 30, ['f2'], true);
    const plain = apply(5, 30, ['f2']);
    expect(withKinpei._basePointOverride).toBe(plain._basePointOverride);
  });
});
