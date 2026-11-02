import { describe, it, expect } from 'vitest';
import { Game3, buildShoupai } from '../game3';
import { shouldAutoNukiBei } from '../store';
import { getTingpaiList } from '../game3/tingpai';
import type { PlayerId } from '../types';

describe('review 11-02 #6: fever auto-nuki must not pull a held north', () => {
  it('self fever, 北 in hand as part of a yakuman shape, drew a non-north tile', () => {
    const g = new Game3();
    g.qipai();
    const me = g.lunbanToPlayerId(g.state.lunban) as PlayerId;
    // 小四喜 shape: z1x3 z2x3 z3x2 z4x2 p7x3 -> shabo wait z3/z4
    const sp = buildShoupai(['z1','z1','z1','z2','z2','z2','z3','z3','z4','z4','p7','p7','p7']);
    g.shoupai.set(me, sp);
    (g as any).goldHand[me] = { p: 0, s: 0, z: 0 };
    expect(getTingpaiList((g.shoupai.get(me) as any).clone()).length).toBeGreaterThan(0);
    g.lizhi.add(me);
    g.feverActive[me] = true;
    g.feverTier[me] = 1;
    (g.shoupai.get(me) as any).zimo('s9');
    expect(g.canTsumo(me)).toBe(false);
    const auto = shouldAutoNukiBei(g, me, false);
    // drew s9, not a north -> no auto nuki
    expect(auto).toBe(false);
  });
  it('declareNukiBei refuses to pull the held north (wait stays intact)', () => {
    const g = new Game3();
    g.qipai();
    const me = g.lunbanToPlayerId(g.state.lunban) as PlayerId;
    g.shoupai.set(me, buildShoupai(['z1','z1','z1','z2','z2','z2','z3','z3','z4','z4','p7','p7','p7']));
    (g as any).goldHand[me] = { p: 0, s: 0, z: 0 };
    g.lizhi.add(me);
    g.feverActive[me] = true;
    (g.shoupai.get(me) as any).zimo('s9');
    const r = g.declareNukiBei(me);
    const sp = g.shoupai.get(me) as any;
    expect(r).toBeNull(); // riichi/fever player cannot pull a held north
    expect(sp._bingpai.z[4]).toBe(2);
    expect(g.nukidora[me]).toBe(0);
  });
  it('self fever still auto-nukis a drawn north', () => {
    const g = new Game3();
    g.qipai();
    const me = g.lunbanToPlayerId(g.state.lunban) as PlayerId;
    g.shoupai.set(me, buildShoupai(['z1','z1','z1','z2','z2','z2','z3','z3','z4','z4','p7','p7','p7']));
    (g as any).goldHand[me] = { p: 0, s: 0, z: 0 };
    g.lizhi.add(me);
    g.feverActive[me] = true;
    (g.shoupai.get(me) as any).zimo('z4');
    if (!g.canTsumo(me)) expect(shouldAutoNukiBei(g, me, false)).toBe(true);
    expect(g.canNukiBei(me)).toBe(true);
  });
});
