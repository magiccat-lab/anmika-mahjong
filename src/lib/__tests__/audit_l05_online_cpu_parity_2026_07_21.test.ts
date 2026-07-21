import { describe, expect, it, vi } from 'vitest';
import { createRoomAuthority, type RoomAuthority } from '../../../server/authority';
import { turnTimeoutAction } from '../../../server/ws_server';
import { defaultSanmaRule, generateTilePool } from '../shan3';
import type { PlayerId } from '../types';

// 2026-07-21 監査 L-05: online CPU [turnTimeoutAction] が single [cpuStepImpl] と
// 判断ロジックで分岐していた。fever/shuvari/リーチ宣言牌/三元牌自動カンを
// single と同じヘルパーに揃える。

function pool(): string[] {
  return generateTilePool(defaultSanmaRule()).map(String);
}
function authority(): RoomAuthority {
  return createRoomAuthority({ preShuffledPool: pool(), qijia: 0 });
}

describe('L-05: online CPU 判断の single 同一化', () => {
  it('CPU の三元牌4枚は自動暗槓される [single と同じ]', () => {
    const a = authority();
    const current = a.currentPlayer();
    vi.spyOn(a.game, 'canTsumo').mockReturnValue(false);
    vi.spyOn(a.game, 'getForcedLizhiKanCandidates').mockReturnValue([]);
    vi.spyOn(a.game, 'canNukiBei').mockReturnValue(false);
    // 白 [z5] の暗槓候補を持たせる [ツモ牌あり]
    const sp = a.game.shoupai.get(current);
    if (sp && typeof sp._zimo !== 'string') (sp as any)._zimo = 'z5';
    vi.spyOn(a.game, 'getKanCandidates').mockReturnValue(['z5555']);
    a.lastZimo = 'z5';
    const action = turnTimeoutAction(a, true);
    expect(action).toEqual({ type: 'declareKan', mianzi: 'z5555' });
  });

  it('human timeout は三元牌自動カンしない [CPU 専用]', () => {
    const a = authority();
    const current = a.currentPlayer();
    vi.spyOn(a.game, 'canTsumo').mockReturnValue(false);
    vi.spyOn(a.game, 'getForcedLizhiKanCandidates').mockReturnValue([]);
    vi.spyOn(a.game, 'canNukiBei').mockReturnValue(false);
    const sp = a.game.shoupai.get(current);
    if (sp && typeof sp._zimo !== 'string') (sp as any)._zimo = 'z5';
    vi.spyOn(a.game, 'getKanCandidates').mockReturnValue(['z5555']);
    a.lastZimo = 'z5';
    const action: any = turnTimeoutAction(a, false);
    // human は自動カンせず、通常打牌 or ツモ切りへ
    expect(action?.type).not.toBe('declareKan');
  });

  it('CPU リーチ宣言牌は pickLizhiDapai で選ばれる [pending 分岐]', () => {
    const a = authority();
    const current = a.currentPlayer();
    const state = a.canonicalState();
    state.lizhiPending = current;
    // 複数のリーチ候補。pickLizhiDapai が待ちの広い方を選ぶ [先頭固定ではない]
    vi.spyOn(a.game, 'getLizhiCandidates').mockReturnValue(['m3', 'p7']);
    const cpuAction: any = turnTimeoutAction(a, true);
    expect(cpuAction?.type).toBe('discard');
    expect(['m3', 'p7']).toContain(cpuAction?.pai);
    // human は先頭固定
    const humanAction: any = turnTimeoutAction(a, false);
    expect(humanAction).toEqual({ type: 'discard', pai: 'm3' });
  });
});
