import { describe, expect, it } from 'vitest';
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
});
