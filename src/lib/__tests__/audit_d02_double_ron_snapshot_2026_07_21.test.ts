import { describe, expect, it, vi } from 'vitest';
import { get } from 'svelte/store';
import { game } from '../store';
import type { PlayerId } from '../types';

// 2026-07-21 監査 D-02: 人間同士のダブロンで 2 人目の宣言 [snapshotLocked 中の再入] が
// pre-discard snapshot へ巻き戻さず、1 人目の秋処理で開いた baopai の上で評価されていた。
// 修正: snapshotLocked 中の ron() は保存 [no-op] ではなく restoreSnapshot() してから評価する。

describe('D-02: ダブロン 2 人目の評価前巻き戻し', () => {
  function armReactionWindow(declared: number[]): any {
    game.reset();
    const s: any = get(game);
    s.awaitingRonDecision = true;
    s.ronDeclaredPlayers = declared;
    s.ronPassedPlayers = [];
    s.lastDapai = { player: 0, pai: 's8' };
    s.lastWinner = declared[0] ?? null;
    vi.spyOn(s.game, 'canRon').mockReturnValue(true);
    // 評価そのものは対象外: null を返して「役なし」早期 return させ、
    // snapshot の巻き戻し順だけを検証する
    vi.spyOn(s.game, 'hule').mockReturnValue(null as any);
    return s;
  }

  it('snapshotLocked [1 人目評価済み] の再入では restoreSnapshot してから評価する', () => {
    const s = armReactionWindow([1]);
    s.game.snapshotLocked = true;
    const restoreSpy = vi.spyOn(s.game, 'restoreSnapshot');
    const saveSpy = vi.spyOn(s.game, 'saveSnapshot');
    game.ron(2);
    expect(restoreSpy).toHaveBeenCalled();
    // locked 中の saveHuleSnapshot は no-op のまま [pre-discard snapshot を上書きしない]
    expect(saveSpy).not.toHaveBeenCalled();
    const hujeSpy = s.game.hule as ReturnType<typeof vi.fn>;
    expect(hujeSpy).toHaveBeenCalled();
    // 巻き戻しが評価より先
    expect(restoreSpy.mock.invocationCallOrder[0]).toBeLessThan(hujeSpy.mock.invocationCallOrder[0]);
  });

  it('最初の宣言 [非 locked] は従来どおり saveSnapshot で pre-hule を保存する', () => {
    const s = armReactionWindow([]);
    s.game.snapshotLocked = false;
    const restoreSpy = vi.spyOn(s.game, 'restoreSnapshot');
    const saveSpy = vi.spyOn(s.game, 'saveSnapshot');
    game.ron(1 as PlayerId as number);
    expect(saveSpy).toHaveBeenCalled();
    expect(restoreSpy).not.toHaveBeenCalled();
  });
});
