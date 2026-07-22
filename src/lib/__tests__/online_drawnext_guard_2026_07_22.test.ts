// [2026-07-22 Sol調査C P0] オンラインの二重 drawNext ガード回帰
//
// 実障害: 試合開始直後 [nextMatch 後] に client が「ツモを進めてください」で停止し、
// 応急橋 [400ms 後 drawNext 自動送信] が正常 projection と競合すると、
// canonical store 側は _zimo あり → 無言 no-op、 validation mirror 側は実ツモ、
// で状態が割れて mutation-token reject → 巻き戻りの間接経路に入る。
// authority.applyDrawNext に「既にツモ牌がある時は明示 reject」を入れ、
// 余計な drawNext が黙って山を削る/状態を割る事を根から止める。
import { describe, expect, it } from 'vitest';
import { RoomAuthority } from '../../../server/authority';
import { defaultSanmaRule, generateTilePool } from '../shan3';

function pool(): string[] {
  return generateTilePool(defaultSanmaRule()).map(String);
}

describe('online drawNext double-draw guard [2026-07-22]', () => {
  it('局開始直後 [第一ツモ配布済み] の drawNext は reject され、山も lastZimo も変わらない', () => {
    const auth = new RoomAuthority({ qijia: 0, preShuffledPool: pool() });
    const actor = auth.currentPlayer();
    // startKyoku が親の第一ツモを配布済み [= 橋が余計な drawNext を送る典型状況]
    expect(auth.lastZimo).not.toBeNull();
    const zimoBefore = auth.lastZimo;
    const paishuBefore = (auth.game.shan as any).paishu;

    const err = auth.validateAndApply(actor, { type: 'drawNext', player: actor });

    expect(err).toContain('already drawn');
    expect((auth.game.shan as any).paishu).toBe(paishuBefore);
    expect(auth.lastZimo).toBe(zimoBefore);
    expect(auth.game.shoupai.get(actor)?._zimo).toBeTruthy();
  });

  // 補足: 正常フローでは打牌 / all-pass 解決 [drawAfterReactions] が次家分まで
  // 自動ツモするため、drawNext は「_zimo が本当に欠けた停止状態」を直す修復専用
  // アクション。guard は _zimo != null の時だけ新たに reject を足すもので、
  // _zimo == null [修復対象] の挙動は変更前と同一 [diff 上も分岐追加のみ]
});
