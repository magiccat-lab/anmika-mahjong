// 2026-07-19 リョー報告「フィーバーの続行関係で止まる事多い」の網羅チェック用回帰ネット。
// 続行 [continueFever] の主要経路が実際に次手番へ進むことを固定する。
// ここが緑のまま止まる報告が再発したら、UI 側 [ボタン表示条件 / CPU driver / cutin] を疑う。
import { describe, it, expect, beforeEach } from 'vitest';
import { get } from 'svelte/store';
import { game } from '../store';
import { buildShoupai } from '../game3';
import type { PlayerId } from '../types';

function armFeverWinner(s: any, winner: number, zimoPai: string | null): void {
  s.game.feverActive[winner] = true;
  s.game.lizhi.add(winner as PlayerId);
  const hand = buildShoupai(['p1', 'p1', 'p1', 'p2', 'p2', 'p2', 'p3', 'p3', 'p3', 's7', 's7', 's7', 's8']);
  if (zimoPai) hand.zimo(zimoPai);
  s.game.shoupai.set(winner as PlayerId, hand);
  s.game.state.lunban = ((s.game.currentOya - winner) % 3 + 3) % 3;
}

describe('フィーバー続行の進行 [止まらないこと]', () => {
  beforeEach(() => {
    game.reset();
  });

  it('ツモ継続: アガリ牌を切って次家がツモり、手番が進む', () => {
    const s: any = get(game);
    armFeverWinner(s, 0, 's8');
    s.lastZimo = 's8';
    s.lastWinner = 0;
    s.lastHuleResult = {};
    s.pendingFeverContinue = { winner: 0, isRon: false };
    s.roundEnded = false;

    game.continueFever();

    const after: any = get(game);
    expect(after.pendingFeverContinue).toBeNull();
    expect(after.roundEnded).toBe(false);
    expect(after.pendingPingju).toBe(false);
    // 次家に手番が渡り、ツモ牌が配られている
    const cur = after.game.lunbanToPlayerId(after.game.state.lunban);
    expect(cur).not.toBe(0);
    expect(after.lastZimo).toBeTruthy();
    // アガリ表示は消えている [続行後に前のアガリが残ると誤操作の元]
    expect(after.lastWinner).toBeNull();
    expect(after.lastHuleResult).toBeNull();
  });

  it('ロン継続: 下家 [winner-1] がツモり、手番が進む', () => {
    const s: any = get(game);
    armFeverWinner(s, 0, null);
    s.lastZimo = null;
    s.lastWinner = 0;
    s.lastHuleResult = {};
    s.pendingFeverContinue = { winner: 0, isRon: true };
    s.roundEnded = false;

    game.continueFever();

    const after: any = get(game);
    expect(after.pendingFeverContinue).toBeNull();
    expect(after.roundEnded).toBe(false);
    expect(after.pendingPingju).toBe(false);
    const cur = after.game.lunbanToPlayerId(after.game.state.lunban);
    expect(cur).toBe(2); // (0 - 1 + 3) % 3
    expect(after.lastZimo).toBeTruthy();
  });

  it('サイコロ未処理中の続行は弾かれ、状態は壊れず、処理後に通る', () => {
    const s: any = get(game);
    armFeverWinner(s, 0, 's8');
    s.lastZimo = 's8';
    s.pendingFeverContinue = { winner: 0, isRon: false };
    s.pendingSaiKoro = {
      winner: 0,
      chances: [{ name: 'テスト', baseChip: 10, shuvariApplicable: false, count: 1, plusMinus: '+' }],
      currentIdx: 0,
      selectedCombo: null,
      rolls: [],
      finalized: false,
      summary: null,
    };
    s.roundEnded = false;

    game.continueFever();

    const mid: any = get(game);
    // reject: 続行待ちは残ったまま [消えてたら続行ボタンごと消滅して詰む]
    expect(mid.pendingFeverContinue).not.toBeNull();

    mid.pendingSaiKoro = null;
    game.continueFever();

    const after: any = get(game);
    expect(after.pendingFeverContinue).toBeNull();
    expect(after.lastZimo).toBeTruthy();
    const cur = after.game.lunbanToPlayerId(after.game.state.lunban);
    expect(cur).not.toBe(0);
  });
});
