import { describe, expect, it, vi } from 'vitest';
import { createRoomAuthority, type RoomAuthority } from '../../../server/authority';
import {
  captureActionEffects,
  captureSeatProjection,
  reactionTimeoutAction,
  shouldRevealUra,
  turnTimeoutAction,
} from '../../../server/ws_server';
import { toCorePai } from '../helpers';
import { buildShoupai } from '../game3';
import { defaultSanmaRule, generateTilePool } from '../shan3';

const members = [
  { seat: 0, is_cpu: false },
  { seat: 1, is_cpu: false },
  { seat: 2, is_cpu: false },
];

function pool(): string[] {
  return generateTilePool(defaultSanmaRule()).map(String);
}

function authority(): RoomAuthority {
  return createRoomAuthority({ preShuffledPool: pool(), qijia: 0 });
}

function firstNonBeiDiscard(a: RoomAuthority): string {
  const player = a.currentPlayer();
  const sp = a.game.shoupai.get(player);
  const candidates = (sp?.get_dapai(false) ?? []) as string[];
  return candidates.find((pai) => toCorePai(pai) !== 'z4') ?? candidates[0];
}

function setDiceDecision(a: RoomAuthority, owner: 0 | 1 | 2, type: string, otherOwner?: 0 | 1 | 2): void {
  a.roundEnded = true;
  a.lastWinner = owner;
  const state = a.canonicalState();
  state.lastWinner = owner;
  state.roundEnded = false;
  state.pendingSaiKoro = {
    winner: owner,
    chances: [
      { name: 'test', baseChip: 1, shuvariApplicable: false, count: 1, plusMinus: '+', winner: owner },
      ...(otherOwner === undefined ? [] : [{ name: 'test2', baseChip: 1, shuvariApplicable: false, count: 1, plusMinus: '+' as const, winner: otherOwner }]),
    ],
    currentIdx: 0,
    selectedCombo: type === 'selectSaiKoroCombo' ? null : [1, 6],
    rolls: [],
    finalized: type === 'advanceSaiKoro',
    summary: type === 'advanceSaiKoro' ? { hits: 0, chipN: 0, zoroBonusTotal: 0 } : null,
  };
}

describe('server RoomAuthority', () => {
  it('rejects FEVER pending when FEVER and riichi discard candidates are physically disjoint', () => {
    const a = authority();
    const current = a.currentPlayer();
    vi.spyOn(a.game, 'canLizhi').mockReturnValue(true);
    vi.spyOn(a.game, 'getLizhiCandidates').mockReturnValue(['p1']);
    vi.spyOn(a.game, 'feverCandidatesByDapai').mockReturnValue(new Map([
      ['p2', { ok: true, tiles: [], tier: 1 as const, rainbow: true }],
    ]));

    expect(a.validateAndApply(current, {
      type: 'lizhi', opts: { fever: true },
    }, members)).toContain('cannot declare fever');
    expect(a.canonicalState().lizhiPending).toBeNull();
  });

  it('rejects discard from a non-current actor', () => {
    const a = authority();
    const current = a.currentPlayer();
    const other = ((current + 1) % 3) as 0 | 1 | 2;
    const reason = a.validateAndApply(other, { type: 'discard', pai: firstNonBeiDiscard(a) }, members);
    expect(reason).toContain('not current player');
  });

  it('accepts a legal current-player discard and records it canonically', () => {
    const a = authority();
    const current = a.currentPlayer();
    const pai = firstNonBeiDiscard(a);
    const reason = a.validateAndApply(current, { type: 'discard', pai }, members);
    expect(reason).toBeNull();
    // When no reaction exists the canonical reducer immediately advances to
    // the next draw and clears lastDapai; the immutable discard log is the
    // authoritative record of the accepted tile.
    expect(a.game.discardLog[current].at(-1)?.pai).toBe(pai);
  });

  it('projects FEVER wait exposures without leaking unrelated concealed tiles', () => {
    const a = authority();
    const state = a.canonicalState();
    const g = state.game;
    g.shoupai.set(1, buildShoupai([
      'z5b', 'z5r', 'p0', 'gp', 'np3',
      'p1', 'p2', 'p4', 's1', 's2', 's4', 'z1', 'z2',
    ]));
    g.feverActive[0] = true;
    g.feverDeclareDapaiPlayer = null;
    g.feverDeclareTing[0] = ['z5'];
    (g.shan as any)._pai = ['z5g', 'z5y', 'p0', 'gp', 'np3'];

    const pochiWait = captureSeatProjection(a, 2);
    expect(pochiWait.publicHands[1].revealedWaitTiles).toEqual(['z5b', 'z5r']);
    expect((pochiWait.fields.feverWaitPublicInfo as any)[0]).toEqual({
      player: 0,
      waits: [{
        tile: 'z5', remain: 0,
        hasRed: false, hasGold: false, hasNiji: false,
      }],
    });

    // Pochi is allmighty in hand evaluation, but rule 5-2 exposes it only
    // when z5 itself is a wait. A p5 wait exposes only actual p5 variants.
    g.feverDeclareTing[0] = ['p5'];
    const pinWait = captureSeatProjection(a, 2);
    expect(pinWait.publicHands[1].revealedWaitTiles).toEqual(['p0', 'gp']);
    expect((pinWait.fields.feverWaitPublicInfo as any)[0].waits[0]).toEqual({
      tile: 'p5', remain: 2,
      hasRed: true, hasGold: true, hasNiji: false,
    });
  });

  it('rejects ron when no ron decision window exists', () => {
    const a = authority();
    const reason = a.validateAndApply(1, { type: 'ron', player: 1 }, members);
    expect(reason).toContain('no ron decision pending');
  });

  it('rejects every live command while a post-win decision is pending', () => {
    const a = authority();
    const current = a.currentPlayer();
    const state = a.canonicalState();
    state.pendingKinpei = {
      winner: current,
      isRon: false,
      ronfrom: null,
      availableHuapai: ['f1'],
    };
    const before = a.game.discardLog[current].length;

    expect(a.validateAndApply(current, {
      type: 'discard',
      pai: firstNonBeiDiscard(a),
    }, members)).toContain('post-win decision is pending');
    expect(a.validateAndApply(current, { type: 'drawNext' }, members))
      .toContain('post-win decision is pending');
    expect(a.game.discardLog[current]).toHaveLength(before);
  });

  it('serializes a double-ron reaction behind the first winner post-win decision', () => {
    const a = authority();
    const discarder = a.currentPlayer();
    const actor = ((discarder + 1) % 3) as 0 | 1 | 2;
    const state = a.canonicalState();
    state.pendingFuyu = { winner: actor, isRon: true, ronfrom: discarder };
    a.lastDapai = { player: discarder, pai: firstNonBeiDiscard(a) as any };
    a.awaitingRonDecision = true;
    a.ronCandidates = [actor];

    expect(a.validateAndApply(actor, { type: 'pass', player: actor }, members))
      .toContain('post-win decision is pending');
    expect(a.awaitingRonDecision).toBe(true);
    expect(a.ronPassedPlayers).not.toContain(actor);
  });

  it('allows only the declaration discard while a riichi discard is pending', () => {
    const a = authority();
    const current = a.currentPlayer();
    a.canonicalState().lizhiPending = current;

    expect(a.validateAndApply(current, { type: 'tsumokiri' }, members))
      .toContain('riichi discard is pending');
    expect(a.validateAndApply(current, { type: 'drawNext' }, members))
      .toContain('riichi discard is pending');
  });

  it('rolls back the validation mirror when the canonical reducer rejects a stale draw', () => {
    const a = authority();
    const current = a.currentPlayer();
    const before = {
      lastZimo: a.lastZimo,
      handZimo: a.game.shoupai.get(current)?._zimo ?? null,
      paishu: a.game.shan.paishu,
      events: a.game.events.length,
      roundEnded: a.roundEnded,
      lastWinner: a.lastWinner,
    };

    // A new round already starts with the dealer's draw.  The validation
    // mirror used to consume the request and mark the round ended before the
    // canonical reducer correctly rejected this duplicate draw.
    expect(a.validateAndApply(current, { type: 'drawNext' }, members))
      .toContain('canonical reducer rejected');

    expect({
      lastZimo: a.lastZimo,
      handZimo: a.game.shoupai.get(current)?._zimo ?? null,
      paishu: a.game.shan.paishu,
      events: a.game.events.length,
      roundEnded: a.roundEnded,
      lastWinner: a.lastWinner,
    }).toEqual(before);
  });

  it('rejects non-host nextRound before a round has ended', () => {
    const a = authority();
    const reason = a.validateAndApply(a.currentPlayer(), { type: 'nextRound', preShuffledPool: pool() }, members);
    expect(reason).toContain('round is not ended');
  });

  it('does not erase a shuvari player reaction by accepting pass', () => {
    const a = authority();
    const discarder = a.currentPlayer();
    const actor = ((discarder + 1) % 3) as 0 | 1 | 2;
    const pai = firstNonBeiDiscard(a);
    a.lastDapai = { player: discarder, pai };
    a.awaitingRonDecision = true;
    a.ronCandidates = [actor];
    a.game.shuvariActive[actor] = true;
    vi.spyOn(a.game, 'canRon').mockReturnValue(true);

    expect(a.validateAndApply(actor, { type: 'pass', player: actor }, members))
      .toContain('must declare ron');
    expect(a.awaitingRonDecision).toBe(true);
    expect(a.ronPassedPlayers).not.toContain(actor);
  });

  it('turns a timed-out mandatory Shuvari reaction into ron instead of deadlocking on pass', () => {
    const a = authority();
    const discarder = a.currentPlayer();
    const actor = ((discarder + 1) % 3) as 0 | 1 | 2;
    const pai = firstNonBeiDiscard(a);
    a.lastDapai = { player: discarder, pai };
    a.awaitingRonDecision = true;
    a.ronCandidates = [actor];
    a.game.shuvariActive[actor] = true;
    vi.spyOn(a.game, 'canRon').mockReturnValue(true);

    expect(reactionTimeoutAction(a, actor)).toEqual({ type: 'ron', player: actor });
    a.game.shuvariActive[actor] = false;
    expect(reactionTimeoutAction(a, actor)).toEqual({ type: 'pass', player: actor });
  });

  it('turn deadline forces exact tsumogiri for an established riichi and a FEVER non-declarer', () => {
    const a = authority();
    const current = a.currentPlayer();
    const feverPlayer = ((current + 1) % 3) as 0 | 1 | 2;
    a.lastZimo = 'np3';
    vi.spyOn(a.game, 'canTsumo').mockReturnValue(false);
    vi.spyOn(a.game, 'getForcedLizhiKanCandidates').mockReturnValue([]);
    vi.spyOn(a.game, 'canNukiBei').mockReturnValue(false);
    vi.spyOn(a.game, 'pickBestDiscard').mockReturnValue('p1');

    a.game.lizhi.add(current);
    expect(turnTimeoutAction(a)).toEqual({ type: 'tsumokiri' });

    a.game.lizhi.delete(current);
    a.game.feverActive[feverPlayer] = true;
    expect(turnTimeoutAction(a)).toEqual({ type: 'tsumokiri' });
  });

  it('turn deadline commits an exact legal normal/FEVER declaration candidate', () => {
    const a = authority();
    const current = a.currentPlayer();
    const canonical = a.canonicalState();
    canonical.lizhiPending = current;
    canonical.lizhiPendingFlags = { open: false, shuvari: false, fever: false };
    const canTsumo = vi.spyOn(a.game, 'canTsumo').mockReturnValue(false);
    vi.spyOn(a.game, 'getForcedLizhiKanCandidates').mockReturnValue([]);
    vi.spyOn(a.game, 'getLizhiCandidates').mockReturnValue(['np3', 'p3']);
    vi.spyOn(a.game, 'pickBestDiscard').mockReturnValue('s1');
    const feverMap = new Map<string, any>([['p3', { ok: true, tiles: ['p3'], tier: 1 }]]);
    vi.spyOn(a.game, 'feverCandidatesByDapai').mockReturnValue(feverMap);

    expect(turnTimeoutAction(a)).toEqual({ type: 'discard', pai: 'np3' });

    canonical.lizhiPendingFlags = { open: false, shuvari: false, fever: true };
    canonical._lizhiFever = true;
    expect(turnTimeoutAction(a)).toEqual({ type: 'discard', pai: 'p3' });

    // The selected two-stage declaration remains authoritative even if the
    // same 14-tile shape also has a legal tsumo.
    canTsumo.mockReturnValue(true);
    expect(turnTimeoutAction(a)).toEqual({ type: 'discard', pai: 'p3' });
  });

  it('turn deadline keeps win, compulsory kan, and physical north ahead of forced discard', () => {
    const a = authority();
    const current = a.currentPlayer();
    const canTsumo = vi.spyOn(a.game, 'canTsumo').mockReturnValue(true);
    const forcedKan = vi.spyOn(a.game, 'getForcedLizhiKanCandidates').mockReturnValue(['p1111']);
    expect(turnTimeoutAction(a)).toEqual({ type: 'tsumo' });

    canTsumo.mockReturnValue(false);
    expect(turnTimeoutAction(a)).toEqual({ type: 'declareKan', mianzi: 'p1111' });

    forcedKan.mockReturnValue([]);
    a.lastZimo = 'gN';
    a.game.lizhi.add(current);
    vi.spyOn(a.game, 'canNukiBei').mockReturnValue(true);
    expect(turnTimeoutAction(a)).toEqual({ type: 'nukiBei', meta: { gold: true } });

    a.game.lizhi.delete(current);
    a.lastZimo = 'p1';
    const sp = a.game.shoupai.get(current) as any;
    sp._bingpai.z[4] = 1;
    a.game.goldHand[current].z = 0;
    expect(turnTimeoutAction(a, true)).toEqual({ type: 'nukiBei', meta: { gold: false } });
  });

  it('extracts an online last-live north and ends only after its replacement discard', () => {
    const a = authority();
    const current = a.currentPlayer();
    const canonical = a.canonicalState();
    const safeTiles = [
      'p1','p2','p3','p4','p5','p6','p7','p8','p9','s1','s2','s4','z1',
    ];
    for (const game of [a.game, canonical.game]) {
      const sp = buildShoupai(safeTiles);
      sp.zimo('z4');
      game.shoupai.set(current, sp);
      for (const other of [0, 1, 2] as const) {
        if (other !== current) game.shoupai.set(other, buildShoupai(safeTiles));
      }
      game.huapai = { 0: [], 1: [], 2: [] };
      game.lastZimoInfo = { player: current, pai: 'z4', pochi: null, gold: false };
      (game.shan as any)._pai = [];
      (game.shan as any)._rinshan = ['s5'];
    }
    a.lastZimo = 'z4';
    canonical.lastZimo = 'z4';

    expect(turnTimeoutAction(a)).toEqual({ type: 'nukiBei', meta: { gold: false } });
    expect(a.validateAndApply(current, { type: 'nukiBei', meta: { gold: false } }, members)).toBeNull();
    expect(a.canonicalState().lastZimo).toBe('s5');
    expect(a.canonicalState().roundEnded).toBe(false);

    expect(a.validateAndApply(current, { type: 'discard', pai: 's5' }, members)).toBeNull();
    expect(a.canonicalState().pendingPingju).toBe(true);
    expect(a.canonicalState().roundEnded).toBe(true);
  });

  it.each([
    ['空の嶺上 reserve', []],
    ['華だけの嶺上 reserve', ['f1']],
  ] as const)('online canonicalも%sで北抜きをrejectせず流局へ進める', (_label, reserve) => {
    const a = authority();
    const current = a.currentPlayer();
    const canonical = a.canonicalState();
    const safeTiles = [
      'p1','p2','p3','p4','p5','p6','p7','p8','p9','s1','s2','s4','z1',
    ];
    for (const game of [a.game, canonical.game]) {
      const sp = buildShoupai(safeTiles);
      sp.zimo('z4');
      game.shoupai.set(current, sp);
      for (const other of [0, 1, 2] as const) {
        if (other !== current) game.shoupai.set(other, buildShoupai(safeTiles));
      }
      game.huapai = { 0: [], 1: [], 2: [] };
      game.lastZimoInfo = { player: current, pai: 'z4', pochi: null, gold: false };
      (game.shan as any)._pai = [];
      (game.shan as any)._rinshan = [...reserve];
    }
    a.lastZimo = 'z4';
    canonical.lastZimo = 'z4';

    expect(turnTimeoutAction(a)).toEqual({ type: 'nukiBei', meta: { gold: false } });
    expect(a.validateAndApply(current, { type: 'nukiBei', meta: { gold: false } }, members)).toBeNull();

    const settled = a.canonicalState();
    expect(settled.pendingPingju).toBe(true);
    expect(settled.roundEnded).toBe(true);
    expect(settled.lastZimo).toBeNull();
    expect(settled.game.nukidora[current]).toBe(1);
    expect(settled.game.huapai[current]).toEqual([...reserve]);
  });

  it('server CPU declares FEVER/normal riichi before discarding while a human timeout does not', () => {
    const a = authority();
    a.lastZimo = 's9';
    vi.spyOn(a.game, 'canTsumo').mockReturnValue(false);
    vi.spyOn(a.game, 'getForcedLizhiKanCandidates').mockReturnValue([]);
    vi.spyOn(a.game, 'canNukiBei').mockReturnValue(false);
    vi.spyOn(a.game, 'canLizhi').mockReturnValue(true);
    vi.spyOn(a.game, 'getLizhiCandidates').mockReturnValue(['np3', 'p3']);
    vi.spyOn(a.game, 'pickBestDiscard').mockReturnValue('s9');
    const feverCandidates = vi.spyOn(a.game, 'feverCandidatesByDapai')
      .mockReturnValue(new Map([['p3', { ok: true, tiles: ['p3'], tier: 1 as const }]]));

    expect(turnTimeoutAction(a, false)).toEqual({ type: 'discard', pai: 's9' });
    expect(turnTimeoutAction(a, true)).toEqual({ type: 'lizhi', opts: { fever: true } });

    feverCandidates.mockReturnValue(new Map());
    expect(turnTimeoutAction(a, true)).toEqual({ type: 'lizhi', opts: {} });
  });

  it('keeps ura hidden for a non-riichi winner even when a loser had riichi', () => {
    const a = authority();
    const state = a.canonicalState();
    const winner = a.currentPlayer();
    const losingRiichi = ((winner + 1) % 3) as 0 | 1 | 2;
    state.lastWinner = winner;
    state.lastHuleResult = { hupai: [] };
    state.roundEnded = true;
    state.game.lizhi.add(losingRiichi);
    (state.game.shan as any)._fubaopai = ['s1', 's2'];
    (a.game.shan as any)._fubaopai = ['s1', 's2'];
    (a.game.shan as any)._fuyuRevealed = ['p1'];

    expect(shouldRevealUra(a)).toBe(false);
    expect(captureSeatProjection(a, losingRiichi).shan.fubaopai).toBeNull();
    const effects: any = captureActionEffects(a, {
      eventsLength: a.game.events.length,
      baopai: [...a.game.shan.baopai],
      fubaopai: [...(a.game.shan.fubaopai ?? [])],
      fuyuRevealedLength: 0,
    });
    expect(effects.revealFubaopai).toBeUndefined();
    expect(effects.newFubaopai).toBeUndefined();
  });

  it('reveals ura when any actual double-ron/pending winner had riichi', () => {
    const a = authority();
    const state = a.canonicalState();
    const winner = a.currentPlayer();
    const riichiWinner = ((winner + 1) % 3) as 0 | 1 | 2;
    state.lastWinner = winner;
    state.lastHuleResult = { hupai: [] };
    state.roundEnded = true;
    state.ronResults = [
      { player: winner, result: {} },
      { player: riichiWinner, result: {} },
    ];
    state.game.lizhi.add(riichiWinner);
    (state.game.shan as any)._fubaopai = ['s1', 's2'];
    (a.game.shan as any)._fubaopai = ['s1', 's2'];

    state.awaitingRonDecision = true;
    expect(shouldRevealUra(a)).toBe(false);
    state.awaitingRonDecision = false;
    expect(shouldRevealUra(a)).toBe(true);
    expect(captureSeatProjection(a, winner).shan.fubaopai).toEqual(['s1', 's2']);
    const effects: any = captureActionEffects(a, {
      eventsLength: a.game.events.length,
      baopai: [...a.game.shan.baopai],
      fubaopai: [...(a.game.shan.fubaopai ?? [])],
      fuyuRevealedLength: 0,
    });
    expect(effects.revealFubaopai).toEqual(['s1', 's2']);

    state.ronResults = [];
    state.lastWinner = null;
    state.lastHuleResult = null;
    state.roundEnded = false;
    state.pendingFuyu = {
      winner,
      otherWinners: [riichiWinner],
      isRon: true,
      ronfrom: ((winner + 2) % 3) as 0 | 1 | 2,
    };
    expect(shouldRevealUra(a)).toBe(true);
  });

  it('keeps post-win private fields hidden until every ron decision is complete', () => {
    const a = authority();
    const state = a.canonicalState();
    const firstWinner = a.currentPlayer();
    const viewer = ((firstWinner + 1) % 3) as 0 | 1 | 2;
    const privateSeat = ((firstWinner + 2) % 3) as 0 | 1 | 2;

    state.ronResults = [{ player: firstWinner, result: {} }];
    state.awaitingRonDecision = true;
    state.game.pochiMultiplier[privateSeat] = { defen: -2, chip: 4 };
    state.game.pochiPaymentMode[privateSeat] = true;

    const pending = captureSeatProjection(a, viewer);
    expect(pending.fields.pochiMultiplier[privateSeat]).toEqual({ defen: 1, chip: 1 });
    expect(pending.fields.pochiPaymentMode[privateSeat]).toBe(false);

    state.awaitingRonDecision = false;
    state.roundEnded = true;
    state.lastWinner = firstWinner;
    const settled = captureSeatProjection(a, viewer);
    expect(settled.fields.pochiMultiplier[privateSeat]).toEqual({ defen: -2, chip: 4 });
    expect(settled.fields.pochiPaymentMode[privateSeat]).toBe(true);
  });

  it('rejects host nextRound while the round is still live', () => {
    const a = authority();
    const before = { ...a.game.state };
    const reason = a.validateAndApply(a.currentPlayer(), {
      type: 'nextRound',
      from_role: 'host',
      preShuffledPool: pool(),
    }, members);

    expect(reason).toContain('round is not ended');
    expect(a.game.state).toEqual(before);
  });

  it('rejects a second nextRound with a different command identity', () => {
    const a = authority();
    const winner = a.currentPlayer();
    a.roundEnded = true;
    a.lastWinner = winner;
    const canonical = a.canonicalState();
    canonical.roundEnded = true;
    canonical.lastWinner = winner;

    const action = { type: 'nextRound', from_role: 'host', preShuffledPool: pool() };
    expect(a.validateAndApply(winner, action, members)).toBeNull();
    const afterFirst = {
      changbang: a.game.state.changbang,
      jushu: a.game.state.jushu,
      benbang: a.game.state.benbang,
    };

    expect(a.validateAndApply(winner, { ...action, preShuffledPool: pool() }, members))
      .toContain('round is not ended');
    expect({
      changbang: a.game.state.changbang,
      jushu: a.game.state.jushu,
      benbang: a.game.state.benbang,
    }).toEqual(afterFirst);
  });

  it('rejects malformed post-win values instead of advancing a revision as a no-op', () => {
    const a = authority();
    const winner = a.currentPlayer();
    setDiceDecision(a, winner, 'selectSaiKoroCombo');
    expect(a.validateAndApply(winner, {
      type: 'selectSaiKoroCombo', small: 2, large: 2,
    }, members)).toContain('distinct integers');
    expect(a.validateAndApply(winner, {
      type: 'selectSaiKoroCombo', small: 0, large: 7,
    }, members)).toContain('distinct integers');

    const state = a.canonicalState();
    state.pendingSaiKoro = null;
    state.pendingFuyu = {
      winner,
      isRon: false,
      ronfrom: null,
      availableHuapai: ['f4'],
    } as any;
    expect(a.validateAndApply(winner, { type: 'selectFuyu', use: 'yes' }, members))
      .toContain('use must be boolean');
  });

  it('uses decisionOwners for reverse-pochi post-win choices', () => {
    const a = authority();
    const winner = a.currentPlayer();
    const chooser = ((winner + 1) % 3) as 0 | 1 | 2;
    const state = a.canonicalState();
    state.pendingFuyu = {
      winner,
      isRon: false,
      ronfrom: null,
      availableHuapai: ['f4'],
      decisionOwners: [chooser],
    } as any;
    expect(a.validateAndApply(winner, { type: 'selectFuyu', use: false }, members))
      .toContain('not a decision owner');
    expect(a.validateAndApply(chooser, { type: 'selectFuyu', use: false }, members))
      .toBeNull();
  });

  it('validates the owner, occurrence and target of a Kami-pochi choice', () => {
    const a = authority();
    const winner = a.currentPlayer();
    const chooser = ((winner + 1) % 3) as 0 | 1 | 2;
    const state = a.canonicalState();
    state.pendingKamiPochi = {
      winner,
      context: 'dora',
      occurrenceKey: 'baopai:0',
      candidates: ['p1', 's1'],
      decisionOwners: [chooser],
      decisionOwnerIndex: 0,
      isRon: false,
      ronfrom: null,
    };

    expect(a.validateAndApply(winner, {
      type: 'selectKamiPochi', target: 'p1', occurrenceKey: 'baopai:0',
    }, members)).toContain('not a decision owner');
    expect(a.validateAndApply(chooser, {
      type: 'selectKamiPochi', target: 'p1', occurrenceKey: 'baopai:1',
    }, members)).toContain('stale occurrence key');
    expect(a.validateAndApply(chooser, {
      type: 'selectKamiPochi', target: 'm1', occurrenceKey: 'baopai:0',
    }, members)).toContain('invalid target');
    expect(a.validateAndApply(chooser, {
      type: 'selectKamiPochi', target: 's1', occurrenceKey: 'baopai:0',
    }, members)).toBeNull();
  });

  it('validates reverse-pochi high-choice candidates server-side', () => {
    const a = authority();
    const winner = a.currentPlayer();
    const chooser = ((winner + 2) % 3) as 0 | 1 | 2;
    const state = a.canonicalState();
    state.pendingPochiSwap = {
      winner,
      kind: 'white',
      candidates: [
        { target: 'p2', expectedChip: 4, fanshu: 3, damanguan: 0 },
        { target: 's2', expectedChip: 4, fanshu: 3, damanguan: 0 },
      ],
      decisionOwners: [chooser],
      decisionOwnerIndex: 0,
      isRon: false,
      ronfrom: null,
    };

    expect(a.validateAndApply(winner, { type: 'selectPochiSwap', target: 'p2' }, members))
      .toContain('not a decision owner');
    expect(a.validateAndApply(chooser, { type: 'selectPochiSwap', target: 'z1' }, members))
      .toContain('invalid target');
    expect(a.validateAndApply(chooser, { type: 'selectPochiSwap', target: 's2' }, members))
      .toBeNull();
  });

  it.each(['rollSaiKoroDice', 'selectSaiKoroCombo', 'advanceSaiKoro'])(
    'rejects live-round %s even for the current player',
    (type) => {
      const a = authority();
      const reason = a.validateAndApply(a.currentPlayer(), { type }, members);
      expect(reason).toContain('no dice chance is pending');
    },
  );

  it.each(['rollSaiKoroDice', 'selectSaiKoroCombo', 'advanceSaiKoro'])(
    'allows only the tsumo winner to perform %s',
    (type) => {
      const a = authority();
      const winner = a.currentPlayer();
      const other = ((winner + 1) % 3) as 0 | 1 | 2;
      setDiceDecision(a, winner, type);
      expect(a.validateAndApply(other, { type }, members)).toContain('not chance owner');
      const action = type === 'selectSaiKoroCombo' ? { type, small: 1, large: 6 }
        : type === 'rollSaiKoroDice' ? { type, override: [1, 6] }
        : { type };
      expect(a.validateAndApply(winner, action, members)).toBeNull();
    },
  );

  it('allows every declared ron winner to perform post-win dice actions', () => {
    const a = authority();
    const winners = [1, 2] as const;
    setDiceDecision(a, winners[0], 'selectSaiKoroCombo', winners[1]);
    const state = a.canonicalState();
    expect(a.validateAndApply(winners[0], { type: 'selectSaiKoroCombo', small: 1, large: 6 }, members)).toBeNull();
    state.pendingSaiKoro!.currentIdx = 1;
    state.pendingSaiKoro!.selectedCombo = null;
    state.pendingSaiKoro!.finalized = false;
    expect(a.validateAndApply(winners[1], { type: 'selectSaiKoroCombo', small: 1, large: 6 }, members)).toBeNull();
    expect(a.validateAndApply(0, { type: 'rollSaiKoroDice' }, members)).toContain('not chance owner');
  });
});
