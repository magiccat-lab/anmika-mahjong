import { get } from 'svelte/store';
import { describe, expect, it } from 'vitest';
import { serializeCanonical } from '../canonicalJson';
import { game, type StoreState } from '../store';
import {
  buildCanonicalPaifuSnapshot,
  buildStateFromPaifu,
  isSafePaifuSavePoint,
  PAIFU_SCHEMA_VERSION,
} from '../store/paifuIo';

describe('canonical paifu v3', () => {
  it('round-trips the complete safe turn-start snapshot deterministically', () => {
    const source = get(game);
    expect(isSafePaifuSavePoint(source)).toBe(true);
    const snapshot = buildCanonicalPaifuSnapshot(source, '2026-07-15T00:00:00.000Z');
    expect(snapshot.version).toBe(PAIFU_SCHEMA_VERSION);
    expect(snapshot.game.shoupai.some((hand: any) => hand?.bingpai?.anmika)).toBe(true);

    const restored = buildStateFromPaifu(JSON.parse(serializeCanonical(snapshot)));
    expect(restored).not.toBeNull();
    const exportedAgain = buildCanonicalPaifuSnapshot(restored!, snapshot.timestamp);
    expect(serializeCanonical(exportedAgain)).toBe(serializeCanonical(snapshot));
  });

  it('rejects saves while a reaction or modal decision is pending', () => {
    const source = get(game);
    const unsafe = { ...source, awaitingRonDecision: true } as StoreState;
    expect(isSafePaifuSavePoint(unsafe)).toBe(false);
    expect(() => buildCanonicalPaifuSnapshot(unsafe)).toThrow(/安全な手番開始時/);
  });

  it('rejects tampered v3 data that claims an unsafe active state is portable', () => {
    const snapshot = buildCanonicalPaifuSnapshot(get(game));
    snapshot.store.lastDapai = { player: 1, pai: 'p1' };
    expect(buildStateFromPaifu(snapshot)).toBeNull();
  });
});
