import { describe, expect, it } from 'vitest';
import { createRoomAuthority, type RoomAuthority } from '../../../server/authority';
import { captureSeatProjection, resolveActorSeat } from '../../../server/ws_server';
import { defaultSanmaRule, generateTilePool } from '../shan3';

// 2026-07-21 監査 S-01 / S-02 の回帰テスト
// S-01: client 起点の cpuRelay [host の CPU 代理送信] は受け付けない。
//       CPU action は権威サーバーの deadline driver だけが生成する。
// S-02: ダブロンの反応窓が開いている間、先に宣言した和了者の評価結果と
//       評価中に開いた追加表示牌を projection に乗せない。

function pool(): string[] {
  return generateTilePool(defaultSanmaRule()).map(String);
}

function authority(): RoomAuthority {
  return createRoomAuthority({ preShuffledPool: pool(), qijia: 0 });
}

describe('S-01: cpuRelay 廃止', () => {
  it('host からの cpuRelay 付き action も reject する', () => {
    const result = resolveActorSeat(
      {} as any,
      'host-uid',
      0,
      { type: 'discard', pai: 'p1', cpuRelay: true, cpuSeat: 1 },
    );
    expect(result.reason).toContain('cpuRelay');
    expect(result.actorSeat).toBe(0); // 席の昇格はしない
  });

  it('cpuRelay なしの通常 action は素通しする', () => {
    const result = resolveActorSeat({} as any, 'user-uid', 1, { type: 'discard', pai: 'p1' });
    expect(result.reason).toBeNull();
    expect(result.actorSeat).toBe(1);
  });
});

describe('S-02: ダブロン反応窓中の結果マスク', () => {
  function openReactionWindowWithFirstClaim(a: RoomAuthority): number {
    // authority.game は validation clone。projection が読むのは canonicalState().game
    const state = a.canonicalState();
    const g = state.game;
    g.saveSnapshot(); // pre-discard snapshot [baopaiLen 記録]
    const baopaiLenBefore = g.shan.baopai.length;
    // 1 人目 [p1] が宣言済み・p2 の判断が残っている反応窓を模擬
    state.awaitingRonDecision = true;
    state.ronDeclaredPlayers = [1];
    state.ronResults = [{ player: 1, result: { fanshu: 3, defen: 5800, hupai: [{ name: '立直', fanshu: 1 }] } }];
    state.lastWinner = 1;
    state.lastHuleResult = state.ronResults[0].result;
    state.message = '🎉🎉 ダブロン! p1: 立直 5800';
    // 1 人目の評価中に秋で開いた追加表示牌
    (g.shan as any)._baopai.push('p5');
    return baopaiLenBefore;
  }

  it('反応窓中は lastWinner / lastHuleResult / ronResults / message を neutral 化する', () => {
    const a = authority();
    openReactionWindowWithFirstClaim(a);
    const projection: any = captureSeatProjection(a, 2); // 判断が残っている p2 視点
    expect(projection.store.lastWinner).toBeNull();
    expect(projection.store.lastHuleResult).toBeNull();
    expect(projection.store.ronResults).toEqual([]);
    expect(String(projection.store.message)).not.toContain('ダブロン');
    expect(String(projection.store.message)).not.toContain('5800');
    // 宣言の発声そのものはパブリック
    expect(projection.store.ronDeclaredPlayers).toEqual([1]);
  });

  it('反応窓中は評価中に開いた追加表示牌を隠す', () => {
    const a = authority();
    const baopaiLenBefore = openReactionWindowWithFirstClaim(a);
    const projection: any = captureSeatProjection(a, 2);
    expect(projection.shan.baopai.length).toBe(baopaiLenBefore);
    expect(projection.shan.baopai).not.toContain('p5');
  });

  it('反応窓が閉じて和了が確定[commit]すれば結果と表示牌を公開する', () => {
    const a = authority();
    openReactionWindowWithFirstClaim(a);
    const state = a.canonicalState();
    state.awaitingRonDecision = false; // 窓が閉じた
    state.roundEnded = true;
    // [2026-07-21 秋ドラ根治] 表示クランプ導入後、追加表示牌は commit [実 flow の
    // applyHule 相当] されて初めて displayBaopai に載る。テストは applyHule を通さず
    // state を直接操作しているので、commitDoraReveal で和了確定を再現する
    state.game.shan.commitDoraReveal();
    const projection: any = captureSeatProjection(a, 2);
    expect(projection.store.lastWinner).toBe(1);
    expect(projection.store.ronResults.length).toBe(1);
    expect(projection.shan.baopai).toContain('p5');
  });
});
