// [2026-09-20 堅牢性レビュー 4.2-1] online のリーチ取消が authority に無く、
// 宣言牌を選び直そうとした瞬間に `unknown action type cancelLizhi` で reject され、
// client は宣言待ちのまま詰んでいた (09-02 のメモに「未着手」とあったもの)。
//
// lizhi は 2 段階で、宣言牌を打つまで engine 側は何も確定していない。
// だから取消は pending を畳むだけで戻る。client の reducer と同じ検査を server にも張る。
import { describe, expect, it, vi } from 'vitest';
import { createRoomAuthority, type RoomAuthority } from '../../../server/authority';
import { defaultSanmaRule, generateTilePool } from '../shan3';
import { toCorePai } from '../helpers';

const members = [
  { seat: 0, is_cpu: false },
  { seat: 1, is_cpu: false },
  { seat: 2, is_cpu: false },
];

function authority(): RoomAuthority {
  return createRoomAuthority({
    preShuffledPool: generateTilePool(defaultSanmaRule()).map(String),
    qijia: 0,
  });
}

/** 立直を宣言させる。authority は検証用 mirror と canonical reducer で別の Game3 を
 *  持ち、command のたびに mirror を作り直すので、宣言の直前に毎回 spy を張り直す。 */
function declareLizhi(a: RoomAuthority, opts: Record<string, boolean> = {}): 0 | 1 | 2 {
  const current = a.currentPlayer();
  vi.spyOn(a.game, 'canLizhi').mockReturnValue(true);
  vi.spyOn(a.canonicalState().game, 'canLizhi').mockReturnValue(true);
  expect(a.validateAndApply(current, { type: 'lizhi', opts }, members)).toBeNull();
  expect(a.canonicalState().lizhiPending).toBe(current);
  return current;
}

function firstNonBeiDiscard(a: RoomAuthority): string {
  const sp = a.game.shoupai.get(a.currentPlayer());
  const candidates = (sp?.get_dapai(false) ?? []) as string[];
  return candidates.find((pai) => toCorePai(pai) !== 'z4') ?? candidates[0];
}

describe('authority cancelLizhi [進行不能の穴 4.2-1]', () => {
  it('宣言牌を打つ前なら本人の取消が通り、pending が畳まれる', () => {
    const a = authority();
    const current = declareLizhi(a);

    expect(a.validateAndApply(current, { type: 'cancelLizhi' }, members)).toBeNull();

    expect(a.canonicalState().lizhiPending).toBeNull();
    // 取消のあとは普通の打牌に戻れる = 詰まない
    expect(a.validateAndApply(current, { type: 'discard', pai: firstNonBeiDiscard(a) }, members)).toBeNull();
  });

  it('他家からの取消は通らない [本人の宣言を落とされない]', () => {
    const a = authority();
    const current = declareLizhi(a);
    const other = ((current + 1) % 3) as 0 | 1 | 2;

    expect(a.validateAndApply(other, { type: 'cancelLizhi' }, members)).toContain('not current player');
    expect(a.canonicalState().lizhiPending).toBe(current);
  });

  it('pending が無い時の取消は reject する [二重送信で状態を壊さない]', () => {
    const a = authority();
    const current = a.currentPlayer();

    expect(a.validateAndApply(current, { type: 'cancelLizhi' }, members)).toContain('no pending lizhi');
  });

  it('取消を 2 回送っても 1 回目だけ通る', () => {
    const a = authority();
    const current = declareLizhi(a);

    expect(a.validateAndApply(current, { type: 'cancelLizhi' }, members)).toBeNull();
    expect(a.validateAndApply(current, { type: 'cancelLizhi' }, members)).toContain('no pending lizhi');
    expect(a.canonicalState().lizhiPending).toBeNull();
  });

  it('open / shuvari の宣言も取消して、そのあと宣言し直せる', () => {
    for (const opts of [{ open: true }, { shuvari: true }]) {
      const a = authority();
      const current = declareLizhi(a, opts);

      expect(a.validateAndApply(current, { type: 'cancelLizhi' }, members)).toBeNull();
      expect(a.canonicalState().lizhiPending).toBeNull();

      // 取消のあとに宣言し直せる = 「選び直したいだけ」が成立する
      expect(declareLizhi(a, opts)).toBe(current);
    }
  });

  it('宣言牌を打ったあとに遅れて来た取消は reject する', () => {
    const a = authority();
    const current = declareLizhi(a);
    // 宣言中の打牌は立直候補牌でなければならない。両方の Game3 に同じ候補を見せる
    const pai = firstNonBeiDiscard(a);
    vi.spyOn(a.game, 'getLizhiCandidates').mockReturnValue([pai]);
    vi.spyOn(a.canonicalState().game, 'getLizhiCandidates').mockReturnValue([pai]);

    expect(a.validateAndApply(current, { type: 'discard', pai }, members)).toBeNull();
    expect(a.canonicalState().lizhiPending).toBeNull();
    // 打牌で宣言が確定しているので、ここから巻き戻してはいけない
    expect(a.validateAndApply(current, { type: 'cancelLizhi' }, members)).not.toBeNull();
  });

  it('reject した時は手番が動かない', () => {
    const a = authority();
    const current = a.currentPlayer();

    expect(a.validateAndApply(current, { type: 'cancelLizhi' }, members)).toContain('no pending lizhi');
    expect(a.currentPlayer()).toBe(current);
    expect(a.canonicalState().lizhiPending).toBeNull();
  });

  it('unknown action type で弾かれないこと [この修正の本体]', () => {
    const a = authority();
    const current = declareLizhi(a);

    // 修正前はここが `unknown action type cancelLizhi` で、client が宣言待ちのまま詰んだ
    const reason = a.validateAndApply(current, { type: 'cancelLizhi' }, members);
    expect(reason).toBeNull();
  });
});
