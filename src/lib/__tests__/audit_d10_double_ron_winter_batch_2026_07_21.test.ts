import { describe, expect, it, vi } from 'vitest';
import { Game3 } from '../game3';
import { defaultSanmaRule, generateTilePool } from '../shan3';
import { settleRonResultsInKamichaOrder, type RonResult } from '../store/winPipeline';

// 2026-07-21 監査 D-10: ダブロン両者が冬を持ち、1人目の冬めくりが正ぽっちで pending 停止
// すると、一括 loop が 2人目の applyHule を先に走らせて同じ牌山を消費し、上家順の
// 牌山順・支払額がずれていた。settle は claimant ごとに冬を完了させてから次へ進む。
// [神ぽっちは常に自動高目取り = モーダルなしなので同期で解決できる]

function preparedGame(): Game3 {
  const pool = generateTilePool(defaultSanmaRule());
  const game = new Game3({ qijia: 0, preShuffledPool: pool });
  game.qipai();
  game.zimo();
  // p0 の手番に戻す [p0 が放銃者]
  vi.spyOn(game, 'canLizhi').mockReturnValue(true);
  game.declareLizhi({ open: true });
  for (let i = 0; i < 3; i++) {
    const player = game.lunbanToPlayerId(game.state.lunban);
    const discard = game.pickBestDiscard(player);
    if (discard) { game.dapai(discard); game.zimo(); }
  }
  return game;
}

describe('D-10: ダブロン冬のclaimant別バッチ完了', () => {
  it('1人目の冬が正ぽっちpendingでも、settle後は全claimantの冬pendingが解決済み', () => {
    const game = preparedGame();
    // 両 claimant [p1, p2] に冬 f4 を持たせる [非 fever なので winter が走る]
    game.huapai[1] = ['f4'];
    game.huapai[2] = ['f4'];
    // 冬めくりの先頭 [shanPai[0]] を正ぽっち z5b にして 1人目を pending にする
    (game.shan as any)._pai = ['z5b', 'm3', 's5', 'p2', 'z1', 'm6', 's8', 'p4', ...(((game.shan as any)._pai) ?? [])];

    const claimResults: RonResult[] = [
      { player: 1, result: { fanshu: 2, fu: 30, hupai: [] } },
      { player: 2, result: { fanshu: 2, fu: 30, hupai: [] } },
    ];
    settleRonResultsInKamichaOrder(game, 0, claimResults);

    // 冬めくりが実際に走って正ぽっち z5b を処理している [テストが有意なことの確認]
    expect(((game.shan as any)._fuyuRevealed ?? []).includes('z5b')).toBe(true);
    // D-10 fix: settle 内で各 claimant の冬を完了させるため、pending は残らない
    // [旧実装は先頭 claimant が pending のまま残り、2人目が同じ牌山を先に消費していた]
    expect(game.getPendingFuyuKamiPochi(1)).toBeNull();
    expect(game.getPendingFuyuKamiPochi(2)).toBeNull();
  });

  it('冬なしの通常ダブロンは挙動が変わらない [上家順で settle]', () => {
    const game = preparedGame();
    // 冬なし
    game.huapai[1] = [];
    game.huapai[2] = [];
    const claimResults: RonResult[] = [
      { player: 2, result: { fanshu: 2, fu: 30, hupai: [] } },
      { player: 1, result: { fanshu: 2, fu: 30, hupai: [] } },
    ];
    const settled = settleRonResultsInKamichaOrder(game, 0, claimResults);
    // 放銃者 p0 からの上家順 [反時計 p0→p2→p1] で並ぶ
    expect(settled.map((e) => e.player)).toEqual([2, 1]);
    expect(game.getPendingFuyuKamiPochi(1)).toBeNull();
    expect(game.getPendingFuyuKamiPochi(2)).toBeNull();
  });
});
