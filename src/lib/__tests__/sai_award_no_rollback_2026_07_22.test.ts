// 2026-07-22 リョー報告: 金北で4華のどれかを強化すると四華サイコロが2回出る。
// 機序: 金北変更の再計算が saveHuleSnapshot→restoreSnapshot を通り、
// 支払い済みサイコロ記録 [feverSaiAwarded] ごと巻き戻して同じ award が再発火。
// 対策: restore で feverSaiAwarded を巻き戻さない [振ったサイコロは巻き戻らない]。
import { describe, it, expect } from 'vitest';
import { Game3 } from '../game3';

describe('feverSaiAwarded は snapshot restore で巻き戻らない', () => {
  it('save → award 記録 → restore しても記録が残る', () => {
    const g = new Game3();
    g.qipai();
    g.saveSnapshot();
    g.feverSaiAwarded[0] = ['四華'];
    g.restoreSnapshot();
    expect(g.feverSaiAwarded[0]).toEqual(['四華']);
  });

  it('局リセットでは消える [正規の消去点]', () => {
    const g = new Game3();
    g.qipai();
    g.feverSaiAwarded[0] = ['四華'];
    g.nextRound({ winner: 0 as any });
    expect(g.feverSaiAwarded[0]).toEqual([]);
  });
});
