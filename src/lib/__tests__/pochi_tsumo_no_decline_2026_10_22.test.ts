// [2026-10-22 通報 20261022_0 arupu_「ポッチツモ後、ポッチを切ることで上がり拒否ができてしまう」]
// リーチ後の白ぽっちは強制高め取り (ルール 2-3)。逆ぽっちを避けられるのは白待ちの時だけなので、
// 和了れる白ぽっちを切って逃げる打牌は store ・ online の権威の両方で止める。カンは選べるまま。
import { describe, expect, it } from 'vitest';
import { get } from 'svelte/store';
import { Game3, buildShoupai } from '../game3';
import { game } from '../store';
import { RoomAuthority } from '../../../server/authority';
import { defaultSanmaRule, generateTilePool } from '../shan3';

const TENPAI = [
  'p2', 'p3', 'p4',
  'p4', 'p5', 'p6',
  's7', 's8', 's9',
  'm9', 'm9', 'm9',
  'z6',
];

function setLizhiDraw(g: Game3, player: 0 | 1 | 2, hand: string[], draw: string, lizhi = true): void {
  g.shoupai.set(player, buildShoupai(hand));
  (g.shoupai.get(player) as any).zimo(draw);
  if (lizhi) g.lizhi.add(player);
  g.lizhiDeclareDapai[player] = false;
  g.yifaActive[player] = false;
}

describe('リーチ後の白ぽっちツモは見逃せない', () => {
  it('リーチ中に和了れる白ぽっちを引いたら打牌で逃げられない', () => {
    const g = new Game3();
    g.qipai();
    const player = g.lunbanToPlayerId(g.state.lunban) as 0 | 1 | 2;
    setLizhiDraw(g, player, TENPAI, 'z5');
    expect(g.canTsumo(player)).toBe(true);
    expect(g.mustDeclarePochiTsumo(player)).toBe(true);
  });

  it('リーチしていない ・ 白以外のツモ和了は今まで通り見逃せる', () => {
    const g = new Game3();
    g.qipai();
    const player = g.lunbanToPlayerId(g.state.lunban) as 0 | 1 | 2;
    setLizhiDraw(g, player, TENPAI, 'z5', false);
    expect(g.mustDeclarePochiTsumo(player)).toBe(false);
    setLizhiDraw(g, player, TENPAI, 'z6');
    expect(g.canTsumo(player)).toBe(true);
    expect(g.mustDeclarePochiTsumo(player)).toBe(false);
  });

  it('store: 白ぽっちを切る打牌は弾かれ、手番も河も動かない', () => {
    game.resetDebug([...TENPAI]);
    const s = get(game);
    const player = s.game.lunbanToPlayerId(s.game.state.lunban) as 0 | 1 | 2;
    setLizhiDraw(s.game, player, TENPAI, 'z5');
    s.lastZimo = 'z5';
    const heBefore = s.game.discardLog[player].length;
    game.discard('z5', { tsumogiri: true });
    const after = get(game);
    expect(after.message).toContain('見逃し不可');
    expect(after.game.discardLog[player].length).toBe(heBefore);
    expect(after.game.lunbanToPlayerId(after.game.state.lunban)).toBe(player);
  });

  it('online: 権威も白ぽっちの打牌 ・ ツモ切りを拒否する', () => {
    const auth = new RoomAuthority({ qijia: 0, preShuffledPool: generateTilePool(defaultSanmaRule()).map(String) });
    const actor = auth.currentPlayer() as 0 | 1 | 2;
    setLizhiDraw(auth.game, actor, TENPAI, 'z5');
    (auth as any).lastZimo = 'z5';
    expect(auth.validateAndApply(actor, { type: 'discard', pai: 'z5' } as any)).toContain('must declare tsumo');
    expect(auth.validateAndApply(actor, { type: 'tsumokiri' } as any)).toContain('must declare tsumo');
  });
});
