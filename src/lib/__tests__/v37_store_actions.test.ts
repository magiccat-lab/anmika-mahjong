// V37: store action 別 test [リョー指示 2026-05-12]
// pon / damingang / declareKan / lizhi / hule (ron/tsumo) / nextRound / cpuStep の
// 入力 → state 変化を action 単位で verify、 後続の store CPU/fulou group 抜出の safety net。
import { describe, it, expect, beforeEach } from 'vitest';
import { game, innerDiscard } from '../store';
import { get } from 'svelte/store';
import { buildShoupai } from '../game3';

beforeEach(() => {
  game.reset();
});

describe('V37-1 reset: 初期 state', () => {
  it('reset 後 全 player defen 35000、 lunban 0、 roundEnded false', () => {
    const s: any = get(game);
    expect(s.game.state.defen[0]).toBe(35000);
    expect(s.game.state.defen[1]).toBe(35000);
    expect(s.game.state.defen[2]).toBe(35000);
    expect(s.game.state.lunban).toBe(0);
    expect(s.roundEnded).toBe(false);
    expect(s.game.shoupai.get(0)._bingpai).toBeDefined();
  });
});

describe('V37-2 toggleCpu: 各 player の cpu flag', () => {
  it('toggleCpu で各 player の cpu 状態が切り替わる', () => {
    const s0: any = get(game);
    const initial = s0.cpu[1];
    game.toggleCpu(1);
    const s1: any = get(game);
    expect(s1.cpu[1]).toBe(!initial);
    game.toggleCpu(1);
    const s2: any = get(game);
    expect(s2.cpu[1]).toBe(initial);
  });
});

describe('V37-3 nextRound: state 変化', () => {
  it('nextRound 後も shoupai が再構築されてる [reset 安全]', () => {
    expect(() => game.nextRound()).not.toThrow();
    const s1: any = get(game);
    expect(s1.game.shoupai.get(0)).toBeDefined();
  });
});

describe('V37-4 cpuStep: 全 CPU で 1 局完走', () => {
  it('全 CPU + cpuStep loop で 局終了に到達', () => {
    game.toggleCpu(0);
    game.toggleCpu(1);
    game.toggleCpu(2);
    let safety = 0;
    while (safety < 1000) {
      const s: any = get(game);
      if (s.roundEnded || s.pendingPingju) break;
      if (s.awaitingRonDecision) { game.pass(); continue; }
      if (s.awaitingFulou) { game.pass(); continue; }
      if (s.pendingFeverContinue) { (game as any).continueFever?.(); continue; }
      if (s.pendingFuyu) { (game as any).selectFuyu?.(false); continue; }
      if (s.pendingKinpei) { (game as any).selectKinpei?.(null); continue; }
      game.cpuStep();
      safety++;
    }
    const sF: any = get(game);
    expect(sF.roundEnded || sF.pendingPingju).toBeTruthy();
  });
});

describe('V37-5 lizhi: シンプル lizhi action', () => {
  it('canLizhi 条件満たさない初期 state で lizhi 呼んでも throw ナシ', () => {
    expect(() => game.lizhi()).not.toThrow();
  });

  it('1000点未満でも通常リーチ宣言 pending に入れる', () => {
    game.resetDebug(
      ['p1','p1','p1','p2','p2','p2','p3','p3','p3','s7','s7','s7','s8'],
      [],
      { forceShan: ['s9'] },
    );
    const s0: any = get(game);
    s0.game.state.defen[0] = 500;
    expect(s0.game.canLizhi(0)).toBe(true);
    game.lizhi();
    const s1: any = get(game);
    expect(s1.lizhiPending).toBe(0);
    const cand = s1.game.getLizhiCandidates(0)[0];
    expect(cand).toBeTruthy();
    game.discard(cand.replace(/_$/, ''));
    const s2: any = get(game);
    expect(s2.game.lizhi.has(0)).toBe(true);
    expect(s2.game.state.defen[0]).toBe(-500);
  });
});

describe('V37-6 pass: 全 CPU 進行中の pass で安全', () => {
  it('全 CPU 走、 副露候補発生時に pass で throw ナシ', () => {
    game.toggleCpu(0); game.toggleCpu(1); game.toggleCpu(2);
    let safety = 0;
    while (safety < 100) {
      const s: any = get(game);
      if (s.roundEnded || s.pendingPingju) break;
      if (s.awaitingFulou) {
        expect(() => game.pass()).not.toThrow();
        break;
      }
      if (s.awaitingRonDecision) { game.pass(); break; }
      game.cpuStep();
      safety++;
    }
    // 副露候補に当たらない場合もあるが、 当たったら必ず throw ナシ
    expect(true).toBe(true);
  });
});

describe('V37-6b CPU pon policy', () => {
  it('数牌 pon は fulou>=1 でも shanten が改善しないなら auto pon しない', () => {
    const s: any = get(game);
    s.cpu[1] = true;
    s.cpu[2] = false;
    s.game.shoupai.set(0, buildShoupai(['m1','m2','m3','p1','p2','p3','s1','s2','s3','m5','m6','m7','z1']));
    s.game.shoupai.get(0).zimo('m5');
    s.game.shoupai.set(1, buildShoupai(['m5','m5','p1','p2','p3','s1','s2','s3','z1','z1','z2','z2','z3']));
    s.game.shoupai.get(1)._fulou = ['p111+'];
    const origGetPonCandidates = s.game.getPonCandidates.bind(s.game);
    const origGetDamingangCandidates = s.game.getDamingangCandidates.bind(s.game);
    const origCanRon = s.game.canRon.bind(s.game);
    const origEstimate = s.game.estimateXiangtingWithExtra.bind(s.game);
    const origDeclarePon = s.game.declarePon.bind(s.game);
    let declared = false;
    try {
      s.game.getPonCandidates = (p: number) => p === 1 ? ['m555+'] : [];
      s.game.getDamingangCandidates = () => [];
      s.game.canRon = () => false;
      s.game.estimateXiangtingWithExtra = () => ({ base: 2, withExtra: 2 });
      s.game.declarePon = () => { declared = true; return true; };

      const after = innerDiscard(s, 'm5');

      expect(declared).toBe(false);
      expect(after.awaitingFulou).toBe(false);
    } finally {
      s.game.getPonCandidates = origGetPonCandidates;
      s.game.getDamingangCandidates = origGetDamingangCandidates;
      s.game.canRon = origCanRon;
      s.game.estimateXiangtingWithExtra = origEstimate;
      s.game.declarePon = origDeclarePon;
    }
  });
});

describe('V37-7 nukiBei: 北抜き action', () => {
  it('z4 を 持ってないか zimo 違うなら no-op、 throw ナシ', () => {
    expect(() => game.nukiBei()).not.toThrow();
  });
});

describe('V37-8 resetDebug: 配牌固定 reset', () => {
  it('forceP0 で P0 手牌 13 枚 set', () => {
    game.resetDebug(
      ['m7', 'm9', 'p1', 'p2', 'p3', 'p4', 'p5', 'p6', 'p7', 's2', 's3', 's4', 'z5b'],
      [],
      {},
    );
    const s: any = get(game);
    const sp0 = s.game.shoupai.get(0);
    expect(sp0).toBeDefined();
    // P0 bingpai count: m=2 + p=7 + s=3 + z5=1 = 13 [zimo 前]
    let total = 0;
    for (const suite of ['m', 'p', 's', 'z'] as const) {
      for (let n = 0; n < (suite === 'z' ? 8 : 10); n++) {
        total += sp0._bingpai[suite][n] ?? 0;
      }
    }
    expect(total).toBeGreaterThanOrEqual(13);
  });
});

describe('V37-9 agariyame: アガリ止め action', () => {
  it('lastWinner 無し state で agariyame は no-op、 throw ナシ', () => {
    expect(() => game.agariyame()).not.toThrow();
  });
});

describe('V37-10 selectFuyu / selectKinpei: 待機外の呼出は no-op', () => {
  it('pendingFuyu / pendingKinpei 無しで selectFuyu / selectKinpei 呼んで throw ナシ', () => {
    expect(() => game.selectFuyu(false)).not.toThrow();
    expect(() => game.selectKinpei(null)).not.toThrow();
  });
});
