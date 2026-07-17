import { describe, expect, it, vi } from 'vitest';
import { createRoomAuthority, type RoomAuthority } from '../../../server/authority';
import { captureSeatProjection } from '../../../server/ws_server';
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
