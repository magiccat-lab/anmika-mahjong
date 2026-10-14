// [2026-10-15 リョー fx6「全部採用しよう！」] 役の名前の帯 (V2) と、フィーバー中の連続和了の数 (V5)
import { describe, expect, it } from 'vitest';
import { enqueueCutinState, specialYakuOf, type StoreState } from '../store';

function st(over: Partial<any> = {}): StoreState {
  return {
    cutin: null, cutinQueue: [], ronResults: [], lastWinner: null, lastHuleResult: null, winStreak: null,
    game: { state: { changbang: 0, jushu: 0, benbang: 0 }, feverActive: [false, false, false] },
    ...over,
  } as any;
}
const ids = (s: StoreState) => [s.cutin, ...s.cutinQueue].filter(Boolean).map((c: any) => `${c.id}${c.label ? ':' + c.label : ''}${c.combo ? 'x' + c.combo : ''}`);

describe('specialYakuOf', () => {
  it('強い物を 1 つだけ選ぶ', () => {
    expect(specialYakuOf({ hupai: [{ name: '立直' }, { name: '一発' }] })).toEqual({ label: '一発', style: 'ippatsu' });
    expect(specialYakuOf({ hupai: [{ name: '一発' }, { name: '海底摸月' }] })).toEqual({ label: '海底摸月', style: 'haitei' });
    expect(specialYakuOf({ hupai: [{ name: '天和' }] })).toEqual({ label: '天和', style: 'tenhou' });
    expect(specialYakuOf({ hupai: [{ name: '立直' }, { name: 'ドラ' }] })).toBeNull();
    expect(specialYakuOf(null)).toBeNull();
  });
});

describe('enqueueCutinState: 役の帯と連続和了', () => {
  it('一発ツモは 役の帯 → ツモ の順に積む', () => {
    const s = st({ lastWinner: 1, lastHuleResult: { hupai: [{ name: '一発' }] } });
    expect(ids(enqueueCutinState(s, 'tsumo', 1))).toEqual(['yaku:一発', 'tsumo']);
  });
  it('ロンは ronResults のその人の役を見る', () => {
    const s = st({ ronResults: [{ player: 2, result: { hupai: [{ name: '河底撈魚' }] } }] });
    expect(ids(enqueueCutinState(s, 'ron', 2))).toEqual(['yaku:河底撈魚', 'ron']);
  });
  it('フィーバー中に同じ人が続けて和了ると 2 連続 ・ 3 連続、他の人の和了で戻る', () => {
    let s = st({ lastWinner: 0, lastHuleResult: { hupai: [] } });
    s.game.feverActive = [true, false, false];
    s = enqueueCutinState(s, 'tsumo', 0);
    s = enqueueCutinState(s, 'tsumo', 0);
    s = enqueueCutinState(s, 'tsumo', 0);
    expect(ids(s)).toEqual(['tsumo', 'tsumox2', 'tsumox3']);
    s = enqueueCutinState(s, 'ron', 1);
    expect(s.winStreak).toBeNull();
    s = enqueueCutinState(s, 'tsumo', 0);
    expect(ids(s).at(-1)).toBe('tsumo');
  });
  it('局が変わると数え直す ・ フィーバーでない和了は数えない', () => {
    let s = st({ lastWinner: 0, lastHuleResult: { hupai: [] } });
    s.game.feverActive = [true, false, false];
    s = enqueueCutinState(s, 'tsumo', 0);
    s.game.state.jushu = 1;
    s = enqueueCutinState(s, 'tsumo', 0);
    expect(ids(s)).toEqual(['tsumo', 'tsumo']);
    s.game.feverActive = [false, false, false];
    s = enqueueCutinState(s, 'tsumo', 0);
    s = enqueueCutinState(s, 'tsumo', 0);
    expect(ids(s)).toEqual(['tsumo', 'tsumo', 'tsumo', 'tsumo']);
  });
});
