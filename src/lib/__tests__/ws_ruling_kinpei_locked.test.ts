// 2026-07-15 リョー裁定: 金北の適用先は一度選択したら以降変更不可 [保留のみ再選択可]。
// ロン和了経路が選択済みでも modal を再表示していた回帰 [フィーバー中の実機報告]。
// tsumo 経路には既に kinpeiTarget === null ガードがあり、ron 経路の欠落を固定する。
import { describe, it, expect, beforeEach } from 'vitest';
import { get } from 'svelte/store';
import { game } from '../store';
import { buildShoupai } from '../game3';
import type { PlayerId } from '../types';

// 断幺九テンパイ [s7 ロンで和了] を p0 に仕込む共通セットアップ
function setupRonReady(kinpeiTarget: 'natsu' | null): any {
  game.reset();
  const s: any = get(game);
  s.game.shoupai.set(0, buildShoupai([
    'p2', 'p3', 'p4',
    'p5', 'p6', 'p7',
    's2', 's3', 's4',
    's5', 's6',
    'm2', 'm2',
  ]));
  s.game.goldHand[0].z = 1;
  s.game.kinpeiTarget[0] = kinpeiTarget;
  // ダマロン禁止ルール [役満以外はリーチ必須] を満たすためリーチ済みにする
  s.game.lizhi.add(0);
  s.lastDapai = { player: 1, pai: 's7' };
  s.awaitingRonDecision = true;
  return s;
}

describe('金北ロック裁定 [ron 経路]', () => {
  beforeEach(() => {
    game.reset();
  });

  it('選択済み [kinpeiTarget=natsu] のロン和了では金北 modal を開かない', () => {
    setupRonReady('natsu');
    game.ron(0);
    const after: any = get(game);
    expect(after.lastWinner).toBe(0);
    expect(after.pendingKinpei).toBeNull();
    expect(after.game.kinpeiTarget[0 as PlayerId]).toBe('natsu');
  });

  it('未選択 [保留中] のロン和了では従来どおり金北 modal を開く', () => {
    setupRonReady(null);
    game.ron(0);
    const after: any = get(game);
    expect(after.pendingKinpei).not.toBeNull();
    expect(after.pendingKinpei.winner).toBe(0);
  });
});
