import { pochiColorFromPai, toCorePai } from '../helpers';

export type ClaimTileIdentity = {
  raw: string | null;
  core: string | null;
  goldSuit: 'p' | 's' | 'z' | null;
  redSuit: 'm' | 'p' | 's' | null;
  pochiColor: 'blue' | 'red' | 'green' | 'yellow' | null;
};

/** Physical identity of the winning claim tile, independent of river logs. */
export function claimTileIdentity(pai: string | null | undefined): ClaimTileIdentity {
  if (!pai) return { raw: null, core: null, goldSuit: null, redSuit: null, pochiColor: null };
  const raw = String(pai).replace(/[\+=\-_*]/g, '');
  const core = toCorePai(raw);
  const goldSuit = raw === 'gp' ? 'p' : raw === 'gs' ? 's' : raw === 'gN' ? 'z' : null;
  const redSuit = goldSuit === null && (raw === 'm0' || raw === 'p0' || raw === 's0')
    ? raw[0] as 'm' | 'p' | 's'
    : null;
  return { raw, core, goldSuit, redSuit, pochiColor: pochiColorFromPai(raw) };
}
