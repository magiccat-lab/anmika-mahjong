import { describe, it, expect } from 'vitest';
import { Game3 } from '../game3';
import type { PlayerId } from '../types';

// Game3 instance method saveSnapshot / restoreSnapshot を unit 固定。
// helper 層は別 test [snapshot.test.ts] でカバー済、 こちらは class 経由の wrap が正しく動くか。
describe('Game3 saveSnapshot / restoreSnapshot', () => {
  it('saveSnapshot で preHuleSnapshot に値が入る', () => {
    const g = new Game3();
    g.qipai();
    expect(g.preHuleSnapshot).toBeNull();
    g.saveSnapshot();
    expect(g.preHuleSnapshot).not.toBeNull();
    expect(g.preHuleSnapshot!.defen[0]).toBe(g.state.defen[0]);
  });

  it('saveSnapshot 後の state mutate + restoreSnapshot で defen / chip / fever 巻き戻し', () => {
    const g = new Game3();
    g.qipai();
    g.saveSnapshot();
    const original = { ...g.state.defen };
    const originalHuapai2 = [...g.huapai[2]];
    g.goldHand[0].p = 1;
    g.pochiHand[1].red = 1;
    g.huapai[2].push('f4');
    g.nukidora[0] = 1;
    g.nukidoraGold[1] = 1;
    g.kinpeiTarget[2] = 'fuyu';
    g.saveSnapshot();
    g.state.defen[0] = 99999;
    g.chipLedger[1] = 50;
    g.feverActive[2] = true;
    g.akiUsedCount[0] = 3;
    g.goldHand[0].p = 0;
    g.pochiHand[1].red = 0;
    g.huapai[2].push('f3');
    g.nukidora[0] = 0;
    g.nukidoraGold[1] = 0;
    g.kinpeiTarget[2] = null;
    g.restoreSnapshot();
    expect(g.state.defen[0]).toBe(original[0]);
    expect(g.chipLedger[1]).toBe(0);
    expect(g.feverActive[2]).toBe(false);
    expect(g.akiUsedCount[0]).toBe(0);
    expect(g.goldHand[0].p).toBe(1);
    expect(g.pochiHand[1].red).toBe(1);
    expect(g.huapai[2]).toEqual([...originalHuapai2, 'f4']);
    expect(g.nukidora[0]).toBe(1);
    expect(g.nukidoraGold[1]).toBe(1);
    expect(g.kinpeiTarget[2]).toBe('fuyu');
  });

  it('snapshot ナシで restoreSnapshot しても throw ナシ', () => {
    const g = new Game3();
    g.qipai();
    expect(() => g.restoreSnapshot()).not.toThrow();
  });

  it('saveSnapshot は deep copy [参照独立]', () => {
    const g = new Game3();
    g.qipai();
    g.saveSnapshot();
    const snapDefen = g.preHuleSnapshot!.defen;
    g.state.defen[0] = 12345;
    expect(snapDefen[0]).not.toBe(12345); // snapshot は独立
  });
});
