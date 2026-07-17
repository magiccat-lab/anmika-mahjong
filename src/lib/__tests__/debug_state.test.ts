import { describe, it, expect } from 'vitest';
import { buildDebugState } from '../store/debug';
import { diffInventory } from '../game3/inventory';

describe('buildDebugState [debug 配牌]', () => {
  it('forceP0 [13 牌] で P0 手牌 set + lastZimo 1 件', () => {
    const hand = ['p1','p2','p3','p4','p5','p6','p7','p8','p9','s1','s2','s3','s4'];
    const s = buildDebugState(hand);
    expect(s.game.shoupai.get(0)).toBeTruthy();
    expect(s.lastZimo).toBeTruthy();
    expect(s.message).toBe('debug 配牌で開始');
    expect(s.roundEnded).toBe(false);
  });

  it('forceP0 に gp / gs / gN 含めると goldHand 反映', () => {
    const s = buildDebugState(['gp','gs','gN','p1','p2','p3','p4','p5','p6','s1','s2','s3','s4']);
    expect(s.game.goldHand[0].p).toBe(1);
    expect(s.game.goldHand[0].s).toBe(1);
    expect(s.game.goldHand[0].z).toBe(1);
  });

  it('forceP0 に色付き z5* で pochiHand 反映、 generic z5 は加算ナシ', () => {
    const s = buildDebugState(['z5b','z5g','z5','p1','p2','p3','p4','p5','p6','s1','s2','s3','s4']);
    expect(s.game.pochiHand[0].blue).toBe(1);
    expect(s.game.pochiHand[0].green).toBe(1);
    // generic 'z5' は色未確定で 加算ナシ
    expect(s.game.pochiHand[0].red).toBe(0);
    expect(s.game.pochiHand[0].yellow).toBe(0);
  });

  it('opts.goldNbei = true で 金北 + nukidora=1 セット', () => {
    const s = buildDebugState(['p1','p2','p3','p4','p5','p6','p7','p8','p9','s1','s2','s3','s4'], [], { goldNbei: true });
    expect(s.game.goldHand[0].z).toBe(1);
    expect(s.game.nukidora[0]).toBe(1);
  });

  it('opts.forceShan で 次ツモ順を固定 [先頭が次 zimo]', () => {
    const hand = ['p1','p2','p3','p4','p5','p6','p7','p8','p9','s1','s2','s3','s4'];
    const s = buildDebugState(hand, [], { forceShan: ['m7'] });
    // 最初のツモが m7 になる
    expect(s.lastZimo).toBe('m7');
  });

  it('forceHua [華牌] が huapai に追加', () => {
    const s = buildDebugState(
      ['p1','p2','p3','p4','p5','p6','p7','p8','p9','s1','s2','s3','s4'],
      ['f1','f2'],
    );
    expect(s.game.huapai[0]).toContain('f1');
    expect(s.game.huapai[0]).toContain('f2');
  });

  it('全初期 state が None [pending* / awaiting* false]', () => {
    const s = buildDebugState(['p1','p2','p3','p4','p5','p6','p7','p8','p9','s1','s2','s3','s4']);
    expect(s.pendingFuyu).toBeNull();
    expect(s.pendingKinpei).toBeNull();
    expect(s.pendingFeverContinue).toBeNull();
    expect(s.pendingSaiKoro).toBeNull();
    expect(s.pendingPingju).toBe(false);
    expect(s.awaitingRonDecision).toBe(false);
    expect(s.awaitingFulou).toBe(false);
    expect(s.ponCandidates).toEqual([]);
    expect(s.kanCandidates).toEqual([]);
  });

  it('ドラ表示牌をlive wallへ複製せず全物理牌の在庫を保つ', () => {
    const s = buildDebugState([
      'p1','p2','p3','p4','p5','p6','p7','p8','p9','s1','s2','s3','s4',
    ]);
    const shan = s.game.shan as any;
    const live = new Set<string>(shan._pai);

    // 値が同じ牌は複数あるので、決定的な検証は全在庫diffで行う。
    expect(shan._baopai).toHaveLength(2);
    expect(shan._fubaopai).toHaveLength(2);
    expect(shan._rinshan).toHaveLength(16);
    expect(live.size).toBeGreaterThan(0);
    expect(diffInventory(s.game)).toEqual([]);
  });
});
