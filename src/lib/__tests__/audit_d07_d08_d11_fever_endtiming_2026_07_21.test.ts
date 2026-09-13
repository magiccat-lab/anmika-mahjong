import { describe, expect, it } from 'vitest';
import { settleAfterWin, clearSaiKoroStage, type WinPipelineState } from '../store/winPipeline';
import { autoConsumeFuyuIfFeverExhausted } from '../store';
import { Game3, buildShoupai } from '../game3';
import type { PlayerId } from '../types';

// 2026-07-21 監査 D-07/D-08/D-11 の endFever タイミング回帰。
// D-07: FEVER 最後の待ちで和了しサイコロ chance が残る間は endFever を遅延する
//       [clearSaiKoroStage で終了]。旧実装は queue 直後に終了しサイコロが tier1 化。
// D-08: 待ち残山0+冬の自動使用で hule 前に endFever していた誤りを撤去 [settleAfterWin が担当]。
// D-11: autoConsumeFuyuIfFeverExhausted を CPU ツモ経路にも適用。

type MinimalWinPipe = {
  game: Game3;
  pendingFuyu: any; pendingKinpei: any; pendingKamiPochi: any; pendingPochiSwap: any;
  pendingSaiKoro: any; pendingFeverContinue: any; pendingPingju: boolean; roundEnded: boolean;
};

function pipe(game: Game3, over: Partial<MinimalWinPipe> = {}): MinimalWinPipe {
  return {
    game,
    pendingFuyu: null, pendingKinpei: null, pendingKamiPochi: null, pendingPochiSwap: null,
    pendingSaiKoro: null, pendingFeverContinue: null, pendingPingju: false, roundEnded: false,
    ...over,
  };
}

function feverExhaustedGame(): { g: Game3; player: PlayerId } {
  const g = new Game3({ qijia: 0 });
  g.qipai();
  const player = 0 as PlayerId;
  g.feverActive[player] = true;
  g.feverTier[player] = 2;
  g.feverDeclareTing[player] = ['s9'];
  // 待ち牌 s9 を山から完全に除去して待ち枯れ状態にする
  (g.shan as any)._pai = ((g.shan as any)._pai as string[]).filter((p) => p !== 's9');
  return { g, player };
}

describe('D-07: サイコロ残存中は endFever を遅延', () => {
  it('pendingSaiKoro があれば settleAfterWin で endFever せず flag だけ立てる', () => {
    const { g, player } = feverExhaustedGame();
    const s = pipe(g, { pendingSaiKoro: { winner: player, chances: [{ name: 'x', baseChip: 70, shuvariApplicable: true, count: 1, plusMinus: '+' }], currentIdx: 0, selectedCombo: null, rolls: [], finalized: false, summary: null } });
    settleAfterWin(s as any, { winner: player, isRon: false });
    expect(g.feverActive[player]).toBe(true); // まだ終了していない
    expect(g.feverEndPendingAfterEffects[player]).toBe(true);
    // サイコロ完了で終了する
    clearSaiKoroStage(s as any);
    expect(g.feverActive[player]).toBe(false);
    expect(g.feverEndPendingAfterEffects[player]).toBe(false);
  });

  it('サイコロが無ければ従来どおり即終了する', () => {
    const { g, player } = feverExhaustedGame();
    const s = pipe(g);
    settleAfterWin(s as any, { winner: player, isRon: false });
    expect(g.feverActive[player]).toBe(false);
    expect(s.roundEnded).toBe(true);
  });
});

describe('D-08/D-11: 待ち枯れ FEVER の冬自動使用', () => {
  it('autoConsumeFuyuIfFeverExhausted は待ち残山0+冬持ちで fuyuConsumed を立てるが endFever しない', () => {
    const { g, player } = feverExhaustedGame();
    // 冬 f4 を手持ちに
    g.huapai[player] = ['f4'];
    const s = { game: g } as any;
    autoConsumeFuyuIfFeverExhausted(s, player);
    expect(g.fuyuConsumed[player]).toBe(true);
    // 精算前なので FEVER はまだ生きている [倍率が今回の和了に乗る]
    expect(g.feverActive[player]).toBe(true);
  });

  it('冬を持たない場合は何もしない', () => {
    const { g, player } = feverExhaustedGame();
    g.huapai[player] = [];
    const s = { game: g } as any;
    autoConsumeFuyuIfFeverExhausted(s, player);
    expect(g.fuyuConsumed[player]).toBe(false);
  });

  it('待ちが枯れていなければ冬を自動使用しない', () => {
    const g = new Game3({ qijia: 0 });
    g.qipai();
    const player = 0 as PlayerId;
    g.feverActive[player] = true;
    g.feverDeclareTing[player] = ['s9'];
    g.huapai[player] = ['f4'];
    if (!((g.shan as any)._pai as string[]).includes('s9')) (g.shan as any)._pai.push('s9');
    const s = { game: g } as any;
    autoConsumeFuyuIfFeverExhausted(s, player);
    expect(g.fuyuConsumed[player]).toBe(false);
  });
});
