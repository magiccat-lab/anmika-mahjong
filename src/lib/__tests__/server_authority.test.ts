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

  it.each(['rollSaiKoroDice', 'selectSaiKoroCombo', 'advanceSaiKoro'])(
    'rejects live-round %s even for the current player',
    (type) => {
      const a = authority();
      const reason = a.validateAndApply(a.currentPlayer(), { type }, members);
      expect(reason).toContain('no win is pending');
    },
  );

  it.each(['rollSaiKoroDice', 'selectSaiKoroCombo', 'advanceSaiKoro'])(
    'allows only the tsumo winner to perform %s',
    (type) => {
      const a = authority();
      const winner = a.currentPlayer();
      const other = ((winner + 1) % 3) as 0 | 1 | 2;
      vi.spyOn(a.game, 'canTsumo').mockReturnValue(true);

      expect(a.validateAndApply(winner, { type: 'tsumo' }, members)).toBeNull();
      expect(a.validateAndApply(other, { type }, members)).toContain('not a round winner');
      expect(a.validateAndApply(winner, { type }, members)).toBeNull();
    },
  );

  it('allows every declared ron winner to perform post-win dice actions', () => {
    const a = authority();
    const discarder = a.currentPlayer();
    const winners = ([0, 1, 2] as const).filter((p) => p !== discarder);
    vi.spyOn(a.game, 'canRon').mockReturnValue(true);

    expect(a.validateAndApply(discarder, {
      type: 'discard',
      pai: firstNonBeiDiscard(a),
    }, members)).toBeNull();
    expect(a.validateAndApply(winners[0], { type: 'ron', player: winners[0] }, members)).toBeNull();
    expect(a.validateAndApply(winners[1], { type: 'ron', player: winners[1] }, members)).toBeNull();

    expect(a.validateAndApply(winners[0], { type: 'rollSaiKoroDice' }, members)).toBeNull();
    expect(a.validateAndApply(winners[1], { type: 'advanceSaiKoro' }, members)).toBeNull();
    expect(a.validateAndApply(discarder, { type: 'selectSaiKoroCombo' }, members)).toContain('not a round winner');
  });
});
