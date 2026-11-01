// [2026-11-02 リョー「戦績の所、対人戦のみにして…指標とか色々出して」「回ごとの推移とかも」]
// /api/stats/pvp の 1 試合 1 行 [古い順] から、人ごとの指標と推移を数える。率の定義はここに集める
import { utcToJst } from './jstTime';

export type PvpRow = {
  seat: number;
  incomplete: number;
  rounds: number;
  riichi: number;
  fever_riichi: number;
  furo_rounds: number;
  ankan: number;
  nuki: number;
  wins: number;
  tsumo_wins: number;
  ron_wins: number;
  deal_ins: number;
  points_won: number;
  points_dealt_in: number;
  hule_chips: number;
  placement: number | null;
  final_defen: number | null;
};

export type PvpMatch = {
  id: number;
  at: string; // UTC 'YYYY-MM-DD HH:MM:SS'
  room: string;
  no: number;
  chips: Record<string, number>; // 抜け番の分も入る
  p: Record<string, PvpRow>; // 席に着いた 3 人
};

export type PlayerAgg = {
  uid: string;
  name: string;
  games: number;
  rounds: number;
  place: [number, number, number];
  placeSum: number;
  placed: number;
  topStreak: number;
  lastAvoidStreak: number;
  chipTotal: number;
  chipMatches: number;
  chipBest: number;
  chipWorst: number;
  chipLast10: number;
  chipPlus: number;
  riichi: number;
  fever: number;
  furo: number;
  ankan: number;
  nuki: number;
  wins: number;
  tsumo: number;
  ron: number;
  dealIns: number;
  pointsWon: number;
  pointsDealt: number;
  hule: number;
  defenSum: number;
  defenN: number;
  defenBest: number;
  incomplete: number;
  firstAt: string;
  lastAt: string;
};

const blank = (uid: string, name: string): PlayerAgg => ({
  uid, name, games: 0, rounds: 0, place: [0, 0, 0], placeSum: 0, placed: 0, topStreak: 0, lastAvoidStreak: 0,
  chipTotal: 0, chipMatches: 0, chipBest: -Infinity, chipWorst: Infinity, chipLast10: 0, chipPlus: 0,
  riichi: 0, fever: 0, furo: 0, ankan: 0, nuki: 0, wins: 0, tsumo: 0, ron: 0, dealIns: 0,
  pointsWon: 0, pointsDealt: 0, hule: 0, defenSum: 0, defenN: 0, defenBest: -Infinity, incomplete: 0,
  firstAt: '', lastAt: '',
});

/** 人ごとの合計。並びは対人戦の試合が多い順 [色の割り当てもこの順で固定] */
export function aggregate(matches: PvpMatch[], names: Record<string, string>): PlayerAgg[] {
  const by = new Map<string, PlayerAgg>();
  const get = (uid: string) => {
    let a = by.get(uid);
    if (!a) by.set(uid, (a = blank(uid, names[uid] ?? uid)));
    return a;
  };
  const chipSeq = new Map<string, number[]>();
  const topRun = new Map<string, number>();
  const avoidRun = new Map<string, number>();
  for (const m of matches) {
    for (const [uid, d] of Object.entries(m.chips)) {
      const a = get(uid);
      a.chipTotal += d;
      a.chipMatches += 1;
      a.chipBest = Math.max(a.chipBest, d);
      a.chipWorst = Math.min(a.chipWorst, d);
      if (d > 0) a.chipPlus += 1;
      (chipSeq.get(uid) ?? chipSeq.set(uid, []).get(uid)!).push(d);
      if (!a.firstAt) a.firstAt = m.at;
      a.lastAt = m.at;
    }
    for (const [uid, r] of Object.entries(m.p)) {
      const a = get(uid);
      a.games += 1;
      a.rounds += r.rounds;
      a.riichi += r.riichi;
      a.fever += r.fever_riichi;
      a.furo += r.furo_rounds;
      a.ankan += r.ankan;
      a.nuki += r.nuki;
      a.wins += r.wins;
      a.tsumo += r.tsumo_wins;
      a.ron += r.ron_wins;
      a.dealIns += r.deal_ins;
      a.pointsWon += r.points_won;
      a.pointsDealt += r.points_dealt_in;
      a.hule += r.hule_chips;
      a.incomplete += r.incomplete ? 1 : 0;
      if (r.final_defen != null) {
        a.defenSum += r.final_defen;
        a.defenN += 1;
        a.defenBest = Math.max(a.defenBest, r.final_defen);
      }
      const pl = r.placement;
      if (pl === 1 || pl === 2 || pl === 3) {
        a.place[pl - 1] += 1;
        a.placeSum += pl;
        a.placed += 1;
        const t = pl === 1 ? (topRun.get(uid) ?? 0) + 1 : 0;
        topRun.set(uid, t);
        a.topStreak = Math.max(a.topStreak, t);
        const v = pl !== 3 ? (avoidRun.get(uid) ?? 0) + 1 : 0;
        avoidRun.set(uid, v);
        a.lastAvoidStreak = Math.max(a.lastAvoidStreak, v);
      }
      if (!a.firstAt) a.firstAt = m.at;
      a.lastAt = m.at;
    }
  }
  for (const [uid, seq] of chipSeq) get(uid).chipLast10 = seq.slice(-10).reduce((s, v) => s + v, 0);
  return [...by.values()].sort((x, y) => y.games - x.games || y.chipMatches - x.chipMatches || x.uid.localeCompare(y.uid));
}

export type Point = { x: number; y: number };

/** 累計チップ。x は対人戦の通し番号 [1 から]。その人が動いた試合 [抜け番も] にだけ点を打つ */
export function cumulativeChips(matches: PvpMatch[], uid: string): Point[] {
  const out: Point[] = [];
  let sum = 0;
  matches.forEach((m, i) => {
    if (uid in m.chips) {
      sum += m.chips[uid];
      out.push({ x: i + 1, y: sum });
    }
  });
  return out;
}

export type RollKey = 'place' | 'top' | 'win' | 'dealin' | 'riichi' | 'chip';
export const ROLL_LABEL: Record<RollKey, string> = {
  place: '平均順位',
  top: 'トップ率',
  win: 'アガリ率',
  dealin: '放銃率',
  riichi: 'リーチ率',
  chip: '1試合のチップ',
};

/** その人の直近 window 試合 [席に着いた試合だけ] の指標。window 試合そろってから点を打つ */
export function rolling(matches: PvpMatch[], uid: string, key: RollKey, window: number): Point[] {
  const own: { x: number; r: PvpRow; chip: number }[] = [];
  const out: Point[] = [];
  matches.forEach((m, i) => {
    const r = m.p[uid];
    if (!r) return;
    own.push({ x: i + 1, r, chip: m.chips[uid] ?? 0 });
    if (own.length < window) return;
    const w = own.slice(-window);
    const rounds = w.reduce((s, o) => s + o.r.rounds, 0);
    const placed = w.filter((o) => o.r.placement != null);
    const rate = (f: (o: (typeof w)[number]) => number) => (rounds ? w.reduce((s, o) => s + f(o), 0) / rounds : 0);
    let y: number;
    switch (key) {
      case 'place':
        y = placed.length ? placed.reduce((s, o) => s + (o.r.placement ?? 0), 0) / placed.length : NaN;
        break;
      case 'top':
        y = placed.length ? placed.filter((o) => o.r.placement === 1).length / placed.length : NaN;
        break;
      case 'win':
        y = rate((o) => o.r.wins);
        break;
      case 'dealin':
        y = rate((o) => o.r.deal_ins);
        break;
      case 'riichi':
        y = rate((o) => o.r.riichi);
        break;
      case 'chip':
        y = w.reduce((s, o) => s + o.chip, 0) / w.length;
        break;
    }
    if (Number.isFinite(y)) out.push({ x: i + 1, y });
  });
  return out;
}

/** 直接対決: a と b が同じ卓に着いた試合で a が上だった回数 */
export function headToHead(matches: PvpMatch[], a: string, b: string): { n: number; above: number; chipDiff: number } {
  let n = 0;
  let above = 0;
  let chipDiff = 0;
  for (const m of matches) {
    const ra = m.p[a];
    const rb = m.p[b];
    if (!ra || !rb || ra.placement == null || rb.placement == null) continue;
    n += 1;
    if (ra.placement < rb.placement) above += 1;
    chipDiff += (m.chips[a] ?? 0) - (m.chips[b] ?? 0);
  }
  return { n, above, chipDiff };
}

export type DayGroup = { day: string; matches: { m: PvpMatch; idx: number }[]; chips: Record<string, number> };

/** 日本時間の日ごと [新しい順]。日の中も新しい順。idx は対人戦の通し番号 */
export function byDay(matches: PvpMatch[]): DayGroup[] {
  const groups = new Map<string, DayGroup>();
  matches.forEach((m, i) => {
    const day = utcToJst(m.at).slice(0, 10);
    let g = groups.get(day);
    if (!g) groups.set(day, (g = { day, matches: [], chips: {} }));
    g.matches.push({ m, idx: i + 1 });
    for (const [u, d] of Object.entries(m.chips)) g.chips[u] = (g.chips[u] ?? 0) + d;
  });
  const out = [...groups.values()].reverse();
  for (const g of out) g.matches.reverse();
  return out;
}
