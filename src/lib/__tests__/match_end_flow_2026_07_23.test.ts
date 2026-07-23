import { get } from 'svelte/store';
import { describe, expect, it } from 'vitest';
import { createRoomAuthority } from '../../../server/authority';
import { captureSeatProjection } from '../../../server/ws_server';
import { createGameStore } from '../store';
import { defaultSanmaRule, generateTilePool } from '../shan3';

// [2026-07-23 リョー指示 5周チェック 1周目] 試合終了フロー:
// canonical finished → projection → client hydrate → 成績ウィンドウ [GameEndPanel] の
// データ [getFinalScore/getRanking] が blind 手牌の client でも壊れず出ること。
// finished の遷移自体は solo 共有 reducer [store nextRound → isGameEnd] で、
// online 固有なのはこの 配信/復元/表示データ の層

function pool(): string[] {
  return generateTilePool(defaultSanmaRule()).map(String);
}

function finishedAuthority() {
  const a = createRoomAuthority({ preShuffledPool: pool(), qijia: 0 });
  const state = a.canonicalState();
  // 半荘終了状態を模擬 [finished 遷移は solo 共有 reducer のテスト圏]
  state.game.state.finished = true;
  state.roundEnded = true;
  state.game.state.defen[0] = 41000;
  state.game.state.defen[1] = 25000;
  state.game.state.defen[2] = 9000;
  state.game.chipLedger[0] = 12;
  state.game.chipLedger[1] = -4;
  state.game.chipLedger[2] = -8;
  return a;
}

describe('試合終了フロー [online]', () => {
  it('finished が projection.gameState に乗り、全席の hydrate で復元される', () => {
    const a = finishedAuthority();
    for (const seat of [0, 1, 2] as const) {
      const projection: any = captureSeatProjection(a, seat);
      expect(projection.gameState.finished).toBe(true);
      const game = createGameStore();
      game.initOnlineGame({
        ws: { readyState: 0, send() {} } as unknown as WebSocket,
        qijia: 0,
        mySeat: seat,
        blindStart: {
          hands: { 0: [], 1: [], 2: [] },
          firstZimo: '',
          paishu: projection.shan.paishu,
          baopai: projection.shan.baopai,
          fubaopai: null,
        },
      });
      expect(game.hydrateOnlineProjection(projection)).toBe(true);
      const s: any = get(game);
      // GameEndPanel の render 条件 [state.finished] と表示データ
      expect(s.game.state.finished).toBe(true);
      const ranking = s.game.getRanking();
      expect(ranking).toHaveLength(3);
      expect(ranking.find((r: any) => r.player === 0)?.rank).toBe(1);
      const finalScore = s.game.getFinalScore();
      expect(finalScore).toHaveLength(3);
      // finalScore は chipLedger ベースの精算 [blind 手牌でも算出できる]
      for (const row of finalScore) {
        expect(Number.isFinite(row.total)).toBe(true);
      }
    }
  });

  it('観戦 [seat=-1] でも finished と成績データが見える', () => {
    const a = finishedAuthority();
    const projection: any = captureSeatProjection(a, -1);
    expect(projection.gameState.finished).toBe(true);
    const game = createGameStore();
    game.initOnlineGame({
      ws: { readyState: 0, send() {} } as unknown as WebSocket,
      qijia: 0,
      mySeat: -1,
      blindStart: {
        hands: { 0: [], 1: [], 2: [] },
        firstZimo: '',
        paishu: projection.shan.paishu,
        baopai: projection.shan.baopai,
        fubaopai: null,
      },
    });
    expect(game.hydrateOnlineProjection(projection)).toBe(true);
    const s: any = get(game);
    expect(s.game.state.finished).toBe(true);
    expect(s.game.getRanking()).toHaveLength(3);
  });

  it('nextMatch 後は finished が解除され、新しい試合が配られる [回り親込み]', () => {
    const a = finishedAuthority();
    const reason = a.validateAndApply(0, {
      type: 'nextMatch',
      finalize: true,
      resetChip: false,
      qijia: 1,
      preShuffledPool: pool(),
    }, [
      { seat: 0, is_cpu: false },
      { seat: 1, is_cpu: false },
      { seat: 2, is_cpu: false },
    ]);
    expect(reason).toBeNull();
    const state = a.canonicalState();
    expect(state.game.state.finished).toBe(false);
    expect(state.game.state.qijia).toBe(1);
    // 新しい配牌 [13枚] が canonical にある
    for (const seat of [0, 1, 2] as const) {
      const sp = state.game.shoupai.get(seat);
      const count = ['m', 'p', 's', 'z'].reduce(
        (t, su) => t + (sp?._bingpai?.[su] ?? []).reduce((x: number, n: number) => x + n, 0),
        0,
      );
      expect(count).toBeGreaterThanOrEqual(13);
    }
  });
});
