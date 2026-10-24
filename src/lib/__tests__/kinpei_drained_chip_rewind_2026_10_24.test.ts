import { describe, expect, it } from 'vitest';
import { Game3 } from '../game3';
import { computeRoomChipDelta, mergeRoomChipDelta } from '../../../server/rotation';

// [2026-10-24 リョー「現ハンチャンまでの全部のアガリとかチップとか再計算してズレないかみといてね」]
// ZOGE の監査で、金北の選び直し [selectKinpei] が部屋チップを二重に数えていた。
// ロンの精算は ws が command ごとに drain して部屋チップに焼く。選び直しは restoreSnapshot で
// 持ちチップを戻すが、drain 済みの effect は戻らず、選び直しのアガリの精算が上に乗っていた。
// snapshot より後に drain した分は打ち消しの effect を積み、部屋チップの動き = 持ちチップの動きにする。

const mapping = { gameToRoom: [0, 2, 3] as [number, number, number], inactiveRoomSeat: 1 };
const roomMove = (effectsPerCommand: Parameters<typeof computeRoomChipDelta>[0][]) => {
  let acc: Record<string, number> | null = null;
  for (const effects of effectsPerCommand) acc = mergeRoomChipDelta(acc, computeRoomChipDelta(effects, mapping as any));
  return Object.fromEntries(Object.entries(acc ?? {}).filter(([, v]) => v !== 0));
};

describe('金北の選び直しで drain 済みのチップ精算を打ち消す', () => {
  it('ロン → drain → 選び直し [restore + 再精算] で部屋の動きが持ちチップの動きと合う', () => {
    const g = new Game3({ qijia: 0 });
    g.qipai();
    g.saveSnapshot();
    g.applyChipFromLoser(0, 1, 5, { label: 'ロンの祝儀' });
    const first = g.takeChipEffects(); // ロンの command に焼かれる
    expect(g.chipLedger).toMatchObject({ 0: 5, 1: -5 });

    g.restoreSnapshot(); // selectKinpei
    expect(g.chipLedger).toMatchObject({ 0: 0, 1: 0 });
    g.applyChipFromLoser(0, 1, 2, { label: '選び直しの祝儀' });
    const second = g.takeChipEffects();
    expect(second.map((e) => e.label)).toEqual(['ロンの祝儀 [取り消し]', '選び直しの祝儀']);

    // 部屋: game 0 → room 0, game 1 → room 2
    expect(roomMove([first, second])).toEqual({ 0: 2, 2: -2 });
  });

  it('drain を挟まない巻き戻し [投機評価] は今まで通り截断だけ', () => {
    const g = new Game3({ qijia: 0 });
    g.qipai();
    g.applyChipOall(0, 1, { label: '確定分' });
    const snap = g.captureSnapshot();
    g.applyChipOall(1, 3, { label: '投機' });
    g.applySnapshot(snap);
    expect(g.chipEffects.map((e) => e.label)).toEqual(['確定分']);
  });

  it('同じ snapshot に 2 回戻しても打ち消しは 1 回分', () => {
    const g = new Game3({ qijia: 0 });
    g.qipai();
    g.saveSnapshot();
    g.applyChipOall(2, 3, { label: 'ツモ' });
    const first = g.takeChipEffects();
    g.restoreSnapshot();
    g.restoreSnapshot();
    const second = g.takeChipEffects();
    expect(second).toHaveLength(1);
    expect(roomMove([first, second])).toEqual({});
  });
});
