// 2026-10-28 CPU の鳴き判断を store/cpuCall.ts に一本化した回帰。
//   - 純関数 decideCpuPon / decideCpuDaiminkan / filterCpuAutoKan が代表手で決めた通りに動く
//   - single [store.ts innerDiscard] と online [server/authority.ts applyAutomaticCpuFulou] が
//     同じ手で同じ結果になる [差分は feverSkip だけで、それも明示して固定する]
import { describe, it, expect, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { get } from 'svelte/store';
import { Game3, buildShoupai } from '../game3';
import { game as gameStore, innerDiscard } from '../store';
import { createRoomAuthority } from '../../../server/authority';
import { defaultSanmaRule, generateTilePool } from '../shan3';
import { decideCpuDaiminkan, decideCpuPon, filterCpuAutoKan, isCpuHonorCall } from '../store/cpuCall';
import type { PlayerId } from '../types';

const FEVER_ON = { feverSkip: true };
const FEVER_OFF = { feverSkip: false };

function buildG(hand: string[], fulou: string[] = []): Game3 {
  const g = new Game3({ qijia: 0, changshu: 1 });
  for (const p of [0, 1, 2] as PlayerId[]) g.shoupai.set(p, buildShoupai(hand));
  if (fulou.length) (g.shoupai.get(0) as any)._fulou = fulou;
  return g;
}

// 副露 1 つ [白ポン済み] 後の 10 枚。p5 を鳴くと 1 シャンテン → 聴牌
const ADVANCE_HAND = ['m1', 'm2', 'm3', 's4', 's5', 's6', 'p5', 'p5', 's8', 'z1'];
// p5 を鳴いてもシャンテンが変わらない 10 枚
const FLAT_HAND = ['m1', 'm2', 'm3', 's4', 's5', 'p5', 'p5', 's8', 's9', 'z1'];
// シャンテンが 3 以上で遠い 10 枚
const FAR_HAND = ['m1', 'm4', 'm8', 's1', 's4', 's9', 'p5', 'p5', 'p2', 'z2'];
const PLAIN = ['p2', 'p4', 'p5', 'p6', 's2', 's3', 's4', 's5', 's6'];

describe('decideCpuPon: 代表手', () => {
  it('三元牌は常にポン [門前でも]', () => {
    for (const z of ['z5', 'z6', 'z7']) {
      const g = buildG([z, z, ...PLAIN, 'm1', 'm9']);
      expect(decideCpuPon(g, 0, z, FEVER_ON)).toEqual({ call: true, reason: 'sanyuan' });
    }
  });

  it('役牌でない風牌は見送る', () => {
    const g = buildG(['z3', 'z3', ...PLAIN, 'm1', 'm9']);
    const zifeng = g.zifengZ(0);
    const off = [1, 2, 3].find((n) => n !== g.changfengZ && n !== zifeng)!;
    expect(decideCpuPon(g, 0, `z${off}`, FEVER_ON)).toEqual({ call: false, reason: 'non-yakuhai-wind' });
    // 場風と自風は鳴く
    expect(decideCpuPon(g, 0, `z${g.changfengZ}`, FEVER_OFF)).toEqual({ call: true, reason: 'yakuhai-wind' });
    expect(decideCpuPon(g, 0, `z${zifeng}`, FEVER_OFF)).toEqual({ call: true, reason: 'yakuhai-wind' });
  });

  it('数牌は副露 0 なら鳴かない [シャンテンが進んでも]', () => {
    const g = buildG(['p5', 'p5', 'm1', 'm2', 'm3', 's4', 's5', 's6', 's8', 'z1']);
    expect(decideCpuPon(g, 0, 'p5', FEVER_OFF)).toEqual({ call: false, reason: 'number-no-advance' });
  });

  it('数牌は副露済み かつ ポンで 2 以下から進む時だけ鳴く', () => {
    const adv = buildG(ADVANCE_HAND, ['z666+']);
    expect(adv.estimateXiangtingWithExtra(0, 'p5')).toEqual({ base: 1, withExtra: 0 });
    expect(decideCpuPon(adv, 0, 'p5', FEVER_ON)).toEqual({ call: true, reason: 'number-advance' });

    const flat = buildG(FLAT_HAND, ['z666+']);
    expect(decideCpuPon(flat, 0, 'p5', FEVER_ON).call).toBe(false);

    const far = buildG(FAR_HAND, ['z666+']);
    expect(far.estimateXiangtingWithExtra(0, 'p5').base).toBeGreaterThan(2);
    expect(decideCpuPon(far, 0, 'p5', FEVER_ON).call).toBe(false);
  });

  it('7 [m7/p7/s7] は進む手でも絶対に鳴かない', () => {
    for (const suit of ['m', 'p', 's']) {
      const g = buildG(['m1', 'm2', 'm3', 's4', 's5', 's6', `${suit}7`, `${suit}7`, 's9', 'z1'], ['z666+']);
      expect(decideCpuPon(g, 0, `${suit}7`, FEVER_OFF)).toEqual({ call: false, reason: 'seven' });
    }
  });

  it('推定が投げたら鳴かない', () => {
    const g = buildG(ADVANCE_HAND, ['z666+']);
    g.estimateXiangtingWithExtra = () => { throw new Error('boom'); };
    expect(decideCpuPon(g, 0, 'p5', FEVER_ON).call).toBe(false);
  });

  it('七対子 / 全虹の芽がある手は feverSkip の時だけ見送る [三元牌でも]', () => {
    const g = buildG(['m7', 'm7', 'z5', 'z5', ...PLAIN]);
    expect(decideCpuPon(g, 0, 'z5', FEVER_ON)).toEqual({ call: false, reason: 'fever-skip' });
    expect(decideCpuPon(g, 0, 'z5', FEVER_OFF)).toEqual({ call: true, reason: 'sanyuan' });
    // 副露済みなら芽は無いので feverSkip でも鳴く
    const done = buildG(['m7', 'm7', 'z5', 'z5', ...PLAIN.slice(0, 6)], ['z666+']);
    expect(decideCpuPon(done, 0, 'z5', FEVER_ON).call).toBe(true);
  });
});

describe('decideCpuDaiminkan / filterCpuAutoKan', () => {
  it('大明槓は三元牌と役牌風だけ。数牌とオタ風は見送る', () => {
    const g = buildG(['z5', 'z5', 'z5', ...PLAIN]);
    expect(decideCpuDaiminkan(g, 0, 'z5', FEVER_ON)).toEqual({ call: true, reason: 'sanyuan' });
    expect(decideCpuDaiminkan(g, 0, `z${g.changfengZ}`, FEVER_ON)).toEqual({ call: true, reason: 'yakuhai-wind' });
    const off = [1, 2, 3].find((n) => n !== g.changfengZ && n !== g.zifengZ(0))!;
    expect(decideCpuDaiminkan(g, 0, `z${off}`, FEVER_ON)).toEqual({ call: false, reason: 'kan-not-honor' });
    // 数牌は副露済みで進む手でも槓しない
    const adv = buildG(ADVANCE_HAND, ['z666+']);
    expect(decideCpuDaiminkan(adv, 0, 'p5', FEVER_ON)).toEqual({ call: false, reason: 'kan-not-honor' });
  });

  it('大明槓もフィーバーの芽があれば feverSkip の時だけ見送る', () => {
    const g = buildG(['m7', 'm7', 'z5', 'z5', 'z5', ...PLAIN.slice(0, 5), 'm1']);
    expect(decideCpuDaiminkan(g, 0, 'z5', FEVER_ON)).toEqual({ call: false, reason: 'fever-skip' });
    expect(decideCpuDaiminkan(g, 0, 'z5', FEVER_OFF).call).toBe(true);
  });

  it('isCpuHonorCall は三元牌と場風 / 自風を見る', () => {
    const g = buildG(PLAIN);
    expect(isCpuHonorCall(g, 0, 'z6')).toBe(true);
    expect(isCpuHonorCall(g, 0, 'p5')).toBe(false);
    expect(isCpuHonorCall(g, 0, 'z4')).toBe(false);
  });

  it('自動暗槓 / 加槓は三元牌の槓子だけ残す [順序保持]', () => {
    expect(filterCpuAutoKan(['p5555', 'z7777', 'z1111', 'z5555', 'm9999', 'z6+666'])).toEqual(['z7777', 'z5555', 'z6+666']);
    expect(filterCpuAutoKan([])).toEqual([]);
  });
});

// ---- single と online の一致 ----
// 同じ盤面 [caller が CPU・discarder が打つ] を、single は innerDiscard、online は
// applyAutomaticCpuFulou に通して、鳴いたか / 種類が同じかを見る。

type Scenario = {
  name: string;
  hand: string[];
  fulou?: string[];
  tile: string | ((g: Game3, caller: PlayerId) => string);
  expect: 'pon' | 'kan' | 'none';
  /** single と online が意図して食い違う唯一の場合 [feverSkip の差]。 */
  online?: 'pon' | 'kan' | 'none';
};

const SCENARIOS: Scenario[] = [
  { name: '發ポン', hand: ['z6', 'z6', ...PLAIN, 'm1', 'm9'], tile: 'z6', expect: 'pon' },
  {
    name: 'オタ風は鳴かない',
    hand: ['z1', 'z2', 'z3', ...PLAIN, 'm1', 'm9'].slice(0, 11).concat(['m1', 'm9']),
    tile: (g, c) => `z${[1, 2, 3].find((n) => n !== g.changfengZ && n !== g.zifengZ(c))}`,
    expect: 'none',
  },
  { name: '数牌は門前で鳴かない', hand: ['p5', 'p5', 'm1', 'm2', 'm3', 's4', 's5', 's6', 's8', 'z1', 'z2', 'm9', 'm8'], tile: 'p5', expect: 'none' },
  { name: '副露後の進む数牌ポン', hand: ADVANCE_HAND, fulou: ['z666+'], tile: 'p5', expect: 'pon' },
  { name: '7 は鳴かない', hand: ['m1', 'm2', 'm3', 's4', 's5', 's6', 'p7', 'p7', 's9', 'z1'], fulou: ['z666+'], tile: 'p7', expect: 'none' },
  { name: '發を 3 枚持ちでもポンが先 [CPU の大明槓は実質ここでは出ない]', hand: ['z6', 'z6', 'z6', ...PLAIN, 'm1'], tile: 'z6', expect: 'pon' },
  // 差分の固定: 7 対子の芽がある手の發ポン。single は見送り、online は鳴く [現状どおり]
  { name: '7 対子の芽 + 發', hand: ['m7', 'm7', 'z6', 'z6', ...PLAIN], tile: 'z6', expect: 'none', online: 'pon' },
];

function singleResult(sc: Scenario): 'pon' | 'kan' | 'none' {
  gameStore.reset({ cpuSeats: [] });
  const s: any = get(gameStore);
  const g: Game3 = s.game;
  const discarder = g.lunbanToPlayerId(g.state.lunban) as PlayerId;
  const caller = ((discarder + 1) % 3) as PlayerId;
  const third = ((discarder + 2) % 3) as PlayerId;
  const tile = typeof sc.tile === 'function' ? sc.tile(g, caller) : sc.tile;
  s.cpu = { 0: false, 1: false, 2: false };
  s.cpu[caller] = true;
  arrange(g, discarder, caller, third, sc, tile);
  s.lastZimo = tile;
  const after = innerDiscard(s, tile) as any;
  return outcome(after.game, caller, sc.fulou?.length ?? 0);
}

function onlineResult(sc: Scenario): 'pon' | 'kan' | 'none' {
  const a: any = createRoomAuthority({ preShuffledPool: generateTilePool(defaultSanmaRule()).map(String), qijia: 0 });
  const g: Game3 = a.game;
  const discarder = a.currentPlayer() as PlayerId;
  const caller = ((discarder + 1) % 3) as PlayerId;
  const third = ((discarder + 2) % 3) as PlayerId;
  const tile = typeof sc.tile === 'function' ? sc.tile(g, caller) : sc.tile;
  arrange(g, discarder, caller, third, sc, tile);
  g.dapai(tile);
  a.cpuSeats = new Set([caller]);
  a.ponCandidates = [];
  a.kanCandidates = [];
  for (const p of [caller]) {
    const pon = g.getPonCandidates(p, discarder, tile);
    if (pon.length > 0) a.ponCandidates.push({ player: p, mianzi: pon });
    const kan = g.getDamingangCandidates(p, discarder, tile);
    if (kan.length > 0) a.kanCandidates.push({ player: p, mianzi: kan });
  }
  a.applyAutomaticCpuFulou(discarder, tile);
  return outcome(g, caller, sc.fulou?.length ?? 0);
}

function arrange(g: Game3, discarder: PlayerId, caller: PlayerId, third: PlayerId, sc: Scenario, tile: string): void {
  const base = ['m1', 'm4', 'm8', 'p2', 'p5', 'p8', 's1', 's4', 's9', 'z1', 'z2', 'z3', 'm9'];
  g.shoupai.set(third, buildShoupai(base));
  g.shoupai.set(caller, buildShoupai(sc.hand));
  if (sc.fulou) (g.shoupai.get(caller) as any)._fulou = [...sc.fulou];
  const dsp = buildShoupai([...base.slice(0, 13).filter((t) => t !== tile).slice(0, 13), tile].slice(0, 14));
  (dsp as any)._zimo = tile;
  g.shoupai.set(discarder, dsp);
}

function outcome(g: Game3, caller: PlayerId, before: number): 'pon' | 'kan' | 'none' {
  const fulou: string[] = (g.shoupai.get(caller) as any)?._fulou ?? [];
  if (fulou.length <= before) return 'none';
  const last = fulou[fulou.length - 1];
  return last.replace(/[^0-9]/g, '').length >= 4 ? 'kan' : 'pon';
}

describe('single と online で CPU の鳴きが一致する', () => {
  beforeEach(() => gameStore.reset({ cpuSeats: [] }));
  for (const sc of SCENARIOS) {
    it(sc.name, () => {
      expect(singleResult(sc)).toBe(sc.expect);
      expect(onlineResult(sc)).toBe(sc.online ?? sc.expect);
    });
  }
});

describe('配線: 両経路が cpuCall を使い、feverSkip の差を明示している', () => {
  const root = new URL('../../../', import.meta.url);
  const read = (rel: string) => readFileSync(new URL(rel, root), 'utf8');

  it('store.ts [single] は feverSkip: true、authority.ts [online] は false', () => {
    const single = read('src/lib/store.ts');
    const online = read('server/authority.ts');
    expect(single).toMatch(/from '\.\/store\/cpuCall'/);
    expect(single).toMatch(/feverSkip: true/);
    expect(online).toMatch(/from '\.\.\/src\/lib\/store\/cpuCall'/);
    expect(online).toMatch(/feverSkip: false/);
  });

  it('暗槓 / 加槓の三元牌選びは single [cpuActions] と online [ws_server] で filterCpuAutoKan を共有', () => {
    expect(read('src/lib/store/cpuActions.ts')).toMatch(/filterCpuAutoKan\(kanMianzis\)/);
    expect(read('server/ws_server.ts')).toMatch(/filterCpuAutoKan\(kanMianzis\)/);
  });
});
