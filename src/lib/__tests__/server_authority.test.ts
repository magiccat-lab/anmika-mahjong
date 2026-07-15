import { describe, expect, it, vi } from 'vitest';
import { createRoomAuthority, type RoomAuthority } from '../../../server/authority';
import { toCorePai } from '../helpers';
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

  it('accepts a legal current-player discard and records the last discard', () => {
    const a = authority();
    const current = a.currentPlayer();
    const pai = firstNonBeiDiscard(a);
    const reason = a.validateAndApply(current, { type: 'discard', pai }, members);
    expect(reason).toBeNull();
    expect(a.lastDapai).toEqual({ player: current, pai });
  });

  it('rejects ron when no ron decision window exists', () => {
    const a = authority();
    const reason = a.validateAndApply(1, { type: 'ron', player: 1 }, members);
    expect(reason).toContain('no ron decision pending');
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

  it('acknowledges a duplicate nextRound without advancing a second time', () => {
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

    expect(a.validateAndApply(winner, { ...action, preShuffledPool: pool() }, members)).toBeNull();
    expect({
      changbang: a.game.state.changbang,
      jushu: a.game.state.jushu,
      benbang: a.game.state.benbang,
    }).toEqual(afterFirst);
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
