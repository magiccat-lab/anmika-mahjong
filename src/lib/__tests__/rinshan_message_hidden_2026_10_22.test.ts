// [2026-10-22 先輩「カンすると嶺上のログが全員に見えて嶺上牌がわかる」]
// 槓の文言に補充牌を書かない。前から続く部屋の state に残った文言も、配る前に消す
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { reactionCandidateMessage, stripRinshanTile } from '../../../server/ws_server';

describe('槓の文言に嶺上牌を出さない', () => {
  it('store の槓の文言に補充牌の変数を埋めない', () => {
    for (const f of ['src/lib/store.ts', 'src/lib/store/cpuActions.ts', 'src/lib/store/fulouActions.ts']) {
      expect(readFileSync(f, 'utf-8')).not.toMatch(/嶺上 \$\{/);
    }
  });
  it('残っていた文言は配る前に全席で消す', () => {
    expect(stripRinshanTile('player 1 カン [m5555]、 嶺上 p3')).toBe('player 1 カン [m5555]');
    expect(stripRinshanTile('[CPU 自動カン] player 2 暗槓 [z1111]、 嶺上 m0')).toBe('[CPU 自動カン] player 2 暗槓 [z1111]');
    for (const own of [0, 1, 2, null]) {
      expect(reactionCandidateMessage('player 0 大明槓 [s7777]、 嶺上 z5', own, false)).toBe('player 0 大明槓 [s7777]');
    }
    expect(stripRinshanTile('嶺上開花')).toBe('嶺上開花');
  });
});
