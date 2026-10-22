// リーチ宣言牌の候補ごとに「待ち牌」と「その牌が自分から見てあと何枚見えていないか」を出す pure helper。
// [2026-10-22 先輩「リーチ時の待ち牌サジェストも出してあげたいね」]
// 待ちの判定は既存の getTingpaiList をそのまま使い、ここでは枚数だけ数える。
// 「見えていない枚数」は自分の視点で数える: 自分の手牌 ・ 全員の河 ・ 全員の副露 ・ 表示中のドラ表示牌 ・ 抜いた北。
// 他家の手牌と山は使わない [オンラインでは client に無い。単独でも同じ数字にして、CPU の手牌を覗かない]。
import { toCorePai } from './helpers';

export type RiichiWaitRow = {
  /** 待ち牌 [m7 / p1 / z3 のような core 表記] */
  tile: string;
  /** 自分から見て残っている枚数。ぽっち [z5] は何にでもなるので数えず null */
  unseen: number | null;
};

export type RiichiWaitSuggestion = {
  /** 切る牌 [物理の牌名。gp / np3 などもそのまま] */
  pai: string;
  waits: RiichiWaitRow[];
  /** unseen を持つ待ちの合計 [ぽっちは含めない] */
  total: number;
};

/** 全ての牌は core で 4 枚 [p3 = 3 + 虹3筒、p5 = 2 + 赤 + 金、z3 = 3 + 虹西、z4 = 3 + 金北、m7 / m9 も 4 枚] */
export const TILES_PER_KIND = 4;

/** 待ち牌 / 見えた牌を数える時の同一視 [feverLizhi.normalizedWaitCore と同じ規則]。
 *  赤 0 は 5 に、旧牌譜の m1 は現行ルールの m7 に寄せる。 */
export function waitCoreOf(pai: string): string {
  const core = toCorePai(String(pai).replace(/[\+=\-_*]/g, '')).replace('0', '5');
  const normalized = `${core[0] ?? ''}${core[1] ?? ''}`;
  return normalized === 'm1' ? 'm7' : normalized;
}

function isTileKey(key: string): boolean {
  return /^[mpsz][1-9]$/.test(key);
}

/** 副露の文字列 [p444+ / m1-23 / z5555 など] を牌ごとに数える */
function addMianzi(counts: Record<string, number>, mianzi: string): void {
  const stripped = String(mianzi).replace(/[\+=\-_*#]/g, '');
  const suit = stripped[0];
  if (!suit || !'mpsz'.includes(suit)) return;
  for (let i = 1; i < stripped.length; i++) {
    const key = waitCoreOf(`${suit}${stripped[i]}`);
    if (isTileKey(key)) counts[key] = (counts[key] ?? 0) + 1;
  }
}

/** viewer の視点で見えている牌を core ごとに数える */
export function visibleTileCounts(g: any, viewer: number): Record<string, number> {
  const counts: Record<string, number> = {};
  const inc = (pai: string, n = 1) => {
    const key = waitCoreOf(pai);
    if (isTileKey(key)) counts[key] = (counts[key] ?? 0) + n;
  };

  // 自分の手牌 [ツモ牌は _bingpai に入っている。赤の 0 は 5 にも数えられているので 1〜9 だけ見る]
  const own = g?.shoupai?.get?.(viewer);
  const bing = own?._bingpai;
  if (bing) {
    for (const suit of ['m', 'p', 's', 'z'] as const) {
      const max = suit === 'z' ? 7 : 9;
      for (let n = 1; n <= max; n++) inc(`${suit}${n}`, bing[suit]?.[n] ?? 0);
    }
  }

  for (const pl of [0, 1, 2]) {
    const sp = g?.shoupai?.get?.(pl);
    for (const m of (sp?._fulou ?? []) as string[]) addMianzi(counts, m);
    // 河 [鳴かれた牌は副露の側で数えているので数えない]
    const hePai = (g?.he?.get?.(pl)?._pai ?? []) as string[];
    for (const raw of hePai) {
      if (typeof raw !== 'string' || /[+=\-]/.test(raw)) continue;
      inc(raw);
    }
    // 抜いた北 [金北も core は北]
    inc('z4', (g?.nukidora?.[pl] ?? 0) + (g?.nukidoraGold?.[pl] ?? 0));
  }

  // 表示中のドラ表示牌 [未確定のめくりは displayBaopai に入らない]
  for (const ind of (g?.shan?.displayBaopai ?? []) as unknown[]) {
    if (typeof ind === 'string') inc(ind);
  }
  return counts;
}

/**
 * 宣言牌の候補ごとの待ちと残り枚数。
 * @param waitsAfterDapai 候補を切った後の待ち牌一覧を返す関数 [既存の getTingpaiList を clone().dapai() 後の手に使う]
 */
export function riichiWaitSuggestions(
  g: any,
  viewer: number,
  candidates: string[],
  waitsAfterDapai: (pai: string) => string[],
): RiichiWaitSuggestion[] {
  const seen = visibleTileCounts(g, viewer);
  const rows: RiichiWaitSuggestion[] = [];
  for (const pai of candidates) {
    let waits: string[] = [];
    try { waits = waitsAfterDapai(pai); } catch { waits = []; }
    const done = new Set<string>();
    const list: RiichiWaitRow[] = [];
    for (const w of waits) {
      const tile = waitCoreOf(w);
      if (!isTileKey(tile) || done.has(tile)) continue;
      done.add(tile);
      list.push({
        tile,
        unseen: tile === 'z5' ? null : Math.max(0, TILES_PER_KIND - (seen[tile] ?? 0)),
      });
    }
    rows.push({ pai, waits: list, total: list.reduce((sum, r) => sum + (r.unseen ?? 0), 0) });
  }
  return rows;
}
