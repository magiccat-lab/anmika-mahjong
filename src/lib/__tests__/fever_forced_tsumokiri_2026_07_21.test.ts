// 2026-07-21 リョー報告 [stuck dump 分析]: P2 フィーバー中に P0 [人間] のツモ番で
// 進行が止まって見えた。実態は「ブロック要因ゼロの手動ツモ切り待ち」で、
// フィーバー強制ツモ切りの手番が自動ツモ切り token の対象外 [checkbox ON か
// 自分リーチ中のみ] だったのが原因。強制で選択の余地が無い手番は自動対象に含める。
// この helper は App.svelte の token 生成と操作ガイド表示 [actionStatus] が共用する。
import { describe, it, expect, beforeEach } from 'vitest';
import { get } from 'svelte/store';
import { game, isFeverForcedTsumogiri } from '../store';

describe('isFeverForcedTsumogiri [フィーバー強制ツモ切り判定]', () => {
  beforeEach(() => {
    game.reset();
  });

  it('誰もフィーバーしてなければ false', () => {
    const s: any = get(game);
    expect(isFeverForcedTsumogiri(s, 0)).toBe(false);
    expect(isFeverForcedTsumogiri(s, 1)).toBe(false);
    expect(isFeverForcedTsumogiri(s, 2)).toBe(false);
  });

  it('P2 フィーバー中は P0/P1 が強制、宣言者 P2 は対象外 [dump の局面]', () => {
    const s: any = get(game);
    s.game.feverActive[2] = true;
    expect(isFeverForcedTsumogiri(s, 0)).toBe(true);
    expect(isFeverForcedTsumogiri(s, 1)).toBe(true);
    expect(isFeverForcedTsumogiri(s, 2)).toBe(false);
  });

  it('複数フィーバー中でも宣言者どうしは対象外', () => {
    const s: any = get(game);
    s.game.feverActive[1] = true;
    s.game.feverActive[2] = true;
    expect(isFeverForcedTsumogiri(s, 0)).toBe(true);
    expect(isFeverForcedTsumogiri(s, 1)).toBe(false);
    expect(isFeverForcedTsumogiri(s, 2)).toBe(false);
  });
});
