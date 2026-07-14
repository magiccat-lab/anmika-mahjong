import { describe, expect, it } from 'vitest';
import { buildShoupai } from '../helpers';
import {
  assertUniquePhysicalTiles,
  createPhysicalTileCatalog,
  resolvePhysicalDiscardPai,
  restorePhysicalHandState,
  snapshotPhysicalHandState,
} from '../game3/tileIdentity';

describe('physical tile identity', () => {
  it('assigns a different id to equal faces', () => {
    const tiles = createPhysicalTileCatalog(['p1', 'p1', 'gp', 'p0']);
    expect(new Set(tiles.map((tile) => tile.id)).size).toBe(4);
    expect(tiles.map((tile) => tile.core)).toEqual(['p1', 'p1', 'p0', 'p0']);
    expect(() => assertUniquePhysicalTiles(tiles)).not.toThrow();
  });

  it('does not turn a requested red five into gold while a red copy exists', () => {
    expect(resolvePhysicalDiscardPai({
      requestedPai: 'p0',
      expanded: { gp: 1 },
      bingpai: { p: [2] },
    })).toBe('p0');
  });

  it('uses gold only when explicitly selected or no red copy exists', () => {
    const common = { expanded: { gp: 1 }, bingpai: { p: [1] } };
    expect(resolvePhysicalDiscardPai({ requestedPai: 'p0', ...common })).toBe('gp');
    expect(resolvePhysicalDiscardPai({ requestedPai: 'p0', meta: { gold: true }, ...common })).toBe('gp');
  });

  it('restores expanded and fulou metadata as one transaction', () => {
    const sp = buildShoupai(['z5b', 'z5g', 'z5y']);
    const before = snapshotPhysicalHandState(sp);
    sp._bingpai.__anmika.z5b = 0;
    sp._anmikaFulou = [{ mianzi: 'z5555+' }];
    sp._anmikaFulouPhysical = [{ mianzi: 'z5555+', consumed: ['z5b'] }];

    restorePhysicalHandState(sp, before);

    expect(sp._bingpai.__anmika.z5b).toBe(1);
    expect(sp._anmikaFulou).toEqual([]);
    expect(sp._anmikaFulouPhysical).toEqual([]);
  });
});
