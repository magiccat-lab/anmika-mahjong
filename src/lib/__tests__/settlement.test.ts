import { describe, expect, it } from 'vitest';
import { evaluateWinPoints, settleClaims } from '../game3/settlement';
import { Game3 } from '../game3';

describe('pure win settlement', () => {
  it('multiplies hand points, honba and tsumo bonus without touching deposits', () => {
    const claim = {
      result: { fu: 30, fanshu: 5 },
      winner: 1 as const,
      loser: 0 as const,
      oya: 0 as const,
      benbang: 1,
      pointMultiplier: 4,
    };
    const points = evaluateWinPoints(claim);
    expect(points.deltas).toEqual({ 0: -40000, 1: 40000, 2: 0 });

    const settled = settleClaims({
      defen: { 0: 35000, 1: 35000, 2: 35000 },
      lizhibang: 3,
      claims: [claim],
    });
    expect(settled.defen).toEqual({ 0: -5000, 1: 78000, 2: 35000 });
    expect(settled.lizhibang).toBe(0);
  });

  it('awards double-ron deposits to the first authoritative claim only', () => {
    const settled = settleClaims({
      defen: { 0: 35000, 1: 35000, 2: 35000 },
      lizhibang: 2,
      claims: [
        { result: { fu: 30, fanshu: 1 }, winner: 2, loser: 0, oya: 0, benbang: 0 },
        { result: { fu: 30, fanshu: 1 }, winner: 1, loser: 0, oya: 0, benbang: 0 },
      ],
    });
    expect(settled.defen[2] - 35000).toBe(3000);
    expect(settled.defen[1] - 35000).toBe(1000);
    expect(settled.defen[0] - 35000).toBe(-2000);
  });

  it('reverses only point movement', () => {
    const points = evaluateWinPoints({
      result: { fu: 30, fanshu: 5 },
      winner: 1,
      loser: null,
      oya: 0,
      benbang: 0,
      reverse: true,
    });
    expect(points.deltas).toEqual({ 0: 5000, 1: -8000, 2: 3000 });
  });

  it('integrates 夏夏金北 without multiplying riichi sticks', () => {
    const game = new Game3({ qijia: 0 });
    game.qipai();
    game.diyizimo = false;
    game.state.defen = { 0: 35000, 1: 35000, 2: 35000 };
    game.state.benbang = 0;
    game.state.lizhibang = 3;
    game.huapai[1] = ['f2', 'f2'];
    game.goldHand[1].z = 1;
    game.kinpeiTarget[1] = 'natsu';
    const result: any = { fu: 30, fanshu: 5, hupai: [] };
    game.applyHuapaiEffect(result, 1);

    game.applyHule(result, 1, 0);

    expect(game.state.defen).toEqual({ 0: 3000, 1: 70000, 2: 35000 });
    expect(result.defen3).toBe(32000);
    expect(game.state.lizhibang).toBe(0);
  });
});
