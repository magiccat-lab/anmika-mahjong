import { describe, expect, it } from 'vitest';
import { get } from 'svelte/store';
import { Game3, buildShoupai } from '../game3';
import { canFeverLizhi, isFeverWaitExhausted } from '../game3/feverLizhi';
import { createGameStore } from '../store';

function makeTenpaiGame(): { game: Game3; player: 0 | 1 | 2 } {
  const game = new Game3();
  game.qipai();
  const player = game.lunbanToPlayerId(game.state.lunban);
  game.shoupai.set(player, buildShoupai([
    'p1','p1','p1','p2','p2','p2','p3','p3','p3','s7','s7','s7','s8',
  ]));
  (game.shoupai.get(player) as any).zimo('s9');
  return { game, player };
}

describe('canonical flow-rule regressions', () => {
  it('北抜きの補充は生牌を減らさず王牌から取得する', () => {
    const game = new Game3();
    game.qipai();
    const player = game.lunbanToPlayerId(game.state.lunban);
    const sp = game.shoupai.get(player) as any;
    sp._bingpai.z[4] = (sp._bingpai.z[4] ?? 0) + 1;
    sp._zimo = 'p1';
    (game.shan as any)._rinshan = ['s9'];
    const liveBefore = game.shan.paishu;

    expect(game.declareNukiBei(player)).toBe('s9');
    expect(game.shan.paishu).toBe(liveBefore);
    expect(game.justNukidBei[player]).toBe(false);
  });

  it('海底牌の北は抜けない', () => {
    const game = new Game3();
    game.qipai();
    const player = game.lunbanToPlayerId(game.state.lunban);
    const sp = game.shoupai.get(player) as any;
    sp._bingpai.z[4] = 1;
    sp._zimo = 'z4';
    (game.shan as any)._pai = [];
    expect(game.canNukiBei(player)).toBe(false);
  });

  it('北抜きロンは列挙役満でも北単騎だけに限定する', () => {
    const game = new Game3();
    game.qipai();
    const player = game.lunbanToPlayerId(game.state.lunban);
    const fromPlayer = ((player + 1) % 3) as 0 | 1 | 2;
    game.shoupai.set(player, buildShoupai([
      'm1','m9','p1','p9','s1','s9','z1','z2','z3','z4','z5','z6','z7',
    ]));
    game.lizhi.add(player);

    // 国士13面は北でも「北単騎」ではないため、抜き北へのロンは不可。
    expect(game.getTingpaiList(player)).toContain('z4');
    expect(game.getTingpaiList(player).length).toBeGreaterThan(1);
    expect(game.canRon(player, 'z4', fromPlayer)).toBe(false);
  });

  it('CPUの北抜きも補充前に北単騎役満のロン判断を待つ', () => {
    const store = createGameStore();
    const state: any = get(store);
    const game: Game3 = state.game;
    const extractor = game.lunbanToPlayerId(game.state.lunban);
    const roner = ((extractor + 1) % 3) as 0 | 1 | 2;
    const third = ((extractor + 2) % 3) as 0 | 1 | 2;

    const extractingHand = buildShoupai([
      'p1','p2','p3','p4','p5','p6','p7','p8','p9','s1','s2','s3','z1',
    ]);
    (extractingHand as any).zimo('z4');
    game.shoupai.set(extractor, extractingHand);
    game.shoupai.set(roner, buildShoupai([
      'z1','z1','z1','z2','z2','z2','z3','z3','z3','z6','z6','z6','z4',
    ]));
    game.shoupai.set(third, buildShoupai([
      'p1','p2','p3','p4','p5','p6','p7','p8','p9','s1','s2','s4','s6',
    ]));
    game.lizhi.add(roner);
    (game.shan as any)._rinshan = ['s9'];
    state.lastZimo = 'z4';
    state.cpu = { 0: false, 1: false, 2: false };
    state.cpu[extractor] = true;
    const nukiBefore = game.nukidora[extractor];

    expect(game.canRon(roner, 'z4', extractor)).toBe(true);
    store.cpuStep();

    const after: any = get(store);
    expect(after.awaitingRonDecision).toBe(true);
    expect(after.pendingNukiBei?.player).toBe(extractor);
    expect(after.game.nukidora[extractor]).toBe(nukiBefore);
  });

  it('無鳴き第一巡の宣言はダブル立直になり、北抜きでは資格を失わない', () => {
    const { game, player } = makeTenpaiGame();
    game.firstTurnState.players[player].drawCount = 1;
    expect(game.declareLizhi()).toBe(true);
    expect(game.doubleLizhi.has(player)).toBe(true);
  });

  it('北抜きは第一巡の鳴き発生として記録しない', () => {
    const game = new Game3();
    game.qipai();
    const player = game.lunbanToPlayerId(game.state.lunban);
    const sp = game.shoupai.get(player) as any;
    sp._bingpai.z[4] = (sp._bingpai.z[4] ?? 0) + 1;
    sp._zimo = 'p1';
    expect(game.declareNukiBei(player)).toBeTruthy();
    expect(game.firstTurnState.callOccurred).toBe(false);
  });

  it('通常立直後は次家の打牌まで追加シュバリを宣言できる', () => {
    const { game, player } = makeTenpaiGame();
    expect(game.declareLizhi()).toBe(true);
    const declaration = (game.shoupai.get(player) as any)._zimo as string;
    game.dapai(declaration);
    expect(game.canDeclareLateShuvari(player)).toBe(true);
    expect(game.declareLateShuvari(player)).toBe(true);
    expect(game.shuvariActive[player]).toBe(true);
  });

  it('American七対子で4枚を2対子に使う7は固定暗刻ではない', () => {
    const sp = buildShoupai([
      'p7','p7','p7','p7',
      's3','s3','s4','s4','s5','s5','z1','z1','z2',
    ]);
    expect(canFeverLizhi(sp).ok).toBe(false);
  });

  it('7暗刻3種と虹3種の複合はクアドラプルFEVER', () => {
    const zeros = () => Array(10).fill(0);
    const sp: any = {
      _bingpai: { m: zeros(), p: zeros(), s: zeros(), z: zeros(), __anmika: { np3: 1, ns3: 1, nz3: 1 } },
      _fulou: [],
    };
    sp._bingpai.m[7] = 3;
    sp._bingpai.p[7] = 3;
    sp._bingpai.s[7] = 3;
    expect(canFeverLizhi(sp).tier).toBe(4);
  });

  it('生牌にない待ちは、同牌が王牌にあっても枯渇扱い', () => {
    expect(isFeverWaitExhausted(['p1'], new Map(), new Map(), [], ['p2', 's1'])).toBe(true);
    expect(isFeverWaitExhausted(['p1'], new Map(), new Map(), [], ['p2', 'p1'])).toBe(false);
  });

  it('立直成立後はツモ牌以外を手出しできない', () => {
    const { game, player } = makeTenpaiGame();
    expect(game.declareLizhi()).toBe(true);
    game.lizhiDeclareDapai[player] = false;
    expect(() => game.dapai('p1')).toThrow(/ツモ切り/);
  });

  it('フィーバー中の非宣言者はモデル層でもツモ切り限定', () => {
    const game = new Game3();
    game.qipai();
    const player = game.lunbanToPlayerId(game.state.lunban);
    const sp = game.shoupai.get(player) as any;
    if (!sp._zimo) sp.zimo('p9');
    const handTile = ['p1','p2','p3','p4','p5','p6','p7','p8','p9','s1','s2','s3','s4','s5','s6','s7','s8','s9']
      .find((p) => (sp._bingpai[p[0]]?.[Number(p[1])] ?? 0) > 0 && p !== sp._zimo);
    expect(handTile).toBeTruthy();
    const feverPlayer = ((player + 1) % 3) as 0 | 1 | 2;
    game.feverActive[feverPlayer] = true;
    expect(() => game.dapai(handTile!)).toThrow(/ツモ切り/);
  });

  it('送り槓は待ち不変でも立直後槓候補にならない', () => {
    const { game, player } = makeTenpaiGame();
    const sp = game.shoupai.get(player) as any;
    sp._zimo = 'p2';
    expect((game as any).isWaitPreservingLizhiKan(player, 'p1111')).toBe(false);
  });

  it('自分の暗槓でも全員の一発が消える', () => {
    const game = new Game3();
    game.qipai();
    const player = game.lunbanToPlayerId(game.state.lunban);
    game.shoupai.set(player, buildShoupai([
      'p1','p1','p1','p1','p2','p3','p4','s2','s3','s4','z1','z1','z2',
    ]));
    const sp = game.shoupai.get(player) as any;
    sp.zimo('z2');
    const candidate = game.getKanCandidates(player).find((m) => m.startsWith('p1111'));
    expect(candidate).toBeTruthy();
    game.yifaActive = { 0: true, 1: true, 2: true };
    expect(game.declareKan(player, candidate!)).toBeTruthy();
    expect(game.yifaActive).toEqual({ 0: false, 1: false, 2: false });
  });

  it('アガリ止めの同点は起家順タイブレークで1位の親だけが可能', () => {
    const game = new Game3({ qijia: 1, changshu: 1 });
    game.state.changbang = 0;
    game.state.jushu = 2;
    const oya = game.currentOya;
    game.state.defen = { 0: 40000, 1: 40000, 2: 25000 };
    const top = game.getRanking()[0].player;
    expect(game.canAgariyame(oya)).toBe(oya === top);
  });
});
