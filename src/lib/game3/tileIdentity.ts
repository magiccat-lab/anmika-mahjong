import { isAnmikaExpandedPai, toCorePai, type AnmikaCounts } from '../helpers';
import type { Pai } from '../types';

/**
 * A physical tile keeps its face even when majiang-core needs a normalized face.
 * `id` is stable inside the catalog and never derives from the normalized face.
 */
export type PhysicalTileId = `tile-${number}`;

export interface PhysicalTile {
  id: PhysicalTileId;
  pai: Pai;
  core: string;
}

export function createPhysicalTileCatalog(pool: readonly Pai[]): PhysicalTile[] {
  return pool.map((pai, index) => ({
    id: `tile-${index}` as PhysicalTileId,
    pai,
    core: toCorePai(pai),
  }));
}

export function assertUniquePhysicalTiles(tiles: readonly PhysicalTile[]): void {
  const ids = new Set<PhysicalTileId>();
  for (const tile of tiles) {
    if (ids.has(tile.id)) throw new Error(`duplicate physical tile id: ${tile.id}`);
    ids.add(tile.id);
  }
}

type DiscardMeta = {
  gold?: boolean;
  pochi?: 'blue' | 'red' | 'green' | 'yellow';
};

const POCHI_BY_COLOR = {
  blue: 'z5b',
  red: 'z5r',
  green: 'z5g',
  yellow: 'z5y',
} as const;

/**
 * Resolve one actual tile before mutating any counters.  This is the single
 * boundary where a core tile selected by majiang-core is mapped back to an
 * Anmika physical face.
 */
export function resolvePhysicalDiscardPai(opts: {
  requestedPai: string;
  meta?: DiscardMeta;
  lastDrawnPai?: string | null;
  expanded?: Partial<AnmikaCounts> | null;
  bingpai?: Record<string, number[]> | null;
}): string {
  const requested = opts.requestedPai.replace(/[_*]$/, '');
  const core = toCorePai(requested);
  const expanded = opts.expanded ?? {};
  const available = (pai: string) => Math.max(0, Number(expanded[pai as keyof AnmikaCounts] ?? 0));

  // An explicitly named expanded face is a physical-tile assertion, not a
  // suggestion.  Falling back to its core face here allowed a client to send
  // `np3`/`gp`/`z5b` while only owning p3/p0/a different white and obtain the
  // expanded-tile bonus.  Reject the action before any hand/counter mutation.
  if (isAnmikaExpandedPai(requested)) {
    if (available(requested) > 0) return requested;
    throw new Error(`requested physical tile is not in hand: ${requested}`);
  }

  if (core === 'z5') {
    const byMeta = opts.meta?.pochi ? POCHI_BY_COLOR[opts.meta.pochi] : null;
    if (byMeta) {
      if (available(byMeta) > 0) return byMeta;
      throw new Error(`requested pochi tile is not in hand: ${byMeta}`);
    }
    const last = opts.lastDrawnPai ?? null;
    if (last && toCorePai(last) === core && isAnmikaExpandedPai(last) && available(last) > 0) return last;
    for (const pai of ['z5b', 'z5r', 'z5g', 'z5y'] as const) {
      if (available(pai) > 0) return pai;
    }
    throw new Error('no physical pochi tile is available for z5 discard');
  }

  const nijiByCore: Record<string, string> = { p3: 'np3', s3: 'ns3', z3: 'nz3' };
  const nijiKey = nijiByCore[core];
  if (nijiKey && available(nijiKey) > 0) {
    const coreCount = Number(opts.bingpai?.[core[0]]?.[parseInt(core[1])] ?? 0);
    if (coreCount <= available(nijiKey)) return nijiKey;
  }

  const goldByCore = core === 'p0' ? 'gp' : core === 's0' ? 'gs' : core === 'z4' ? 'gN' : null;
  if (!goldByCore) return requested;

  if (opts.meta?.gold === true) {
    if (available(goldByCore) > 0) return goldByCore;
    throw new Error(`requested gold tile is not in hand: ${goldByCore}`);
  }

  const last = opts.lastDrawnPai ?? null;
  if (last === goldByCore && available(goldByCore) > 0) return goldByCore;

  // A plain/red physical tile wins when one exists.  Falling back to gold is
  // only valid when the normalized counter contains no non-gold copy.
  const suit = core[0];
  const digit = core[1];
  const coreCount = Number(opts.bingpai?.[suit]?.[Number(digit)] ?? 0);
  const plainCount = Math.max(0, coreCount - available(goldByCore));
  if (opts.meta?.gold === false) {
    if (plainCount > 0) return requested;
    throw new Error(`requested non-gold tile is not in hand: ${requested}`);
  }
  if (plainCount > 0) return requested;
  if (available(goldByCore) > 0) return goldByCore;
  throw new Error(`tile is not in hand: ${requested}`);
}

export interface PhysicalHandSnapshot {
  expanded: Partial<AnmikaCounts> | null;
  zimo: string | null;
  fulou: any[];
  fulouPhysical: any[];
}

export function snapshotPhysicalHandState(sp: any): PhysicalHandSnapshot {
  return {
    expanded: sp?._bingpai?.__anmika ? { ...sp._bingpai.__anmika } : null,
    zimo: sp?._anmikaZimo ?? null,
    fulou: (sp?._anmikaFulou ?? []).map((entry: any) => ({ ...entry })),
    fulouPhysical: (sp?._anmikaFulouPhysical ?? []).map((entry: any) => ({
      ...entry,
      consumed: [...(entry?.consumed ?? [])],
    })),
  };
}

export function restorePhysicalHandState(sp: any, snapshot: PhysicalHandSnapshot): void {
  if (!sp?._bingpai) return;
  if (snapshot.expanded) {
    sp._bingpai.__anmika = { ...snapshot.expanded };
    for (const [pai, count] of Object.entries(snapshot.expanded)) sp._bingpai[pai] = count;
  } else {
    delete sp._bingpai.__anmika;
  }
  sp._anmikaZimo = snapshot.zimo;
  sp._anmikaFulou = snapshot.fulou.map((entry) => ({ ...entry }));
  sp._anmikaFulouPhysical = snapshot.fulouPhysical.map((entry) => ({
    ...entry,
    consumed: [...(entry?.consumed ?? [])],
  }));
}
