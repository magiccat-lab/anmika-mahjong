// [2026-07-23 リョー要望 名牌譜] 牌譜 [game.events] を再生用のステップ列に fold する純関数。
// エンジンは動かさない [表示専用]。authoritative 牌譜 [全量] を想定しつつ、
// 旧 client 牌譜 [他家マスク済み] でも壊れず「伏せ牌」で進むよう許容的に組む。
import { toCorePai } from './helpers';

export type ReplaySeatState = {
  hand: string[];          // 物理牌 or 'back' [不明牌]
  river: Array<{ pai: string; riichi: boolean }>;
  melds: string[];         // majiang-core mianzi 表記
  riichi: 'none' | 'riichi' | 'fever';
  nuki: number;
  defen: number | null;
};

export type ReplayStep = {
  desc: string;
  seats: Record<0 | 1 | 2, ReplaySeatState>;
  eventType: string;
};

export type ReplayRound = {
  label: string;
  steps: ReplayStep[];
};

const SEATS = [0, 1, 2] as const;

function cloneSeats(seats: Record<0 | 1 | 2, ReplaySeatState>): Record<0 | 1 | 2, ReplaySeatState> {
  const out: any = {};
  for (const s of SEATS) {
    out[s] = {
      hand: [...seats[s].hand],
      river: seats[s].river.map((r) => ({ ...r })),
      melds: [...seats[s].melds],
      riichi: seats[s].riichi,
      nuki: seats[s].nuki,
      defen: seats[s].defen,
    };
  }
  return out;
}

function emptySeats(): Record<0 | 1 | 2, ReplaySeatState> {
  const out: any = {};
  for (const s of SEATS) {
    out[s] = { hand: [], river: [], melds: [], riichi: 'none', nuki: 0, defen: null };
  }
  return out;
}

// 手牌から 1 枚除く [物理一致 → core 一致 → 'back' → 無視 の順で許容]
function removeFromHand(hand: string[], pai: string): void {
  let idx = hand.indexOf(pai);
  if (idx < 0) {
    const core = toCorePai(pai);
    idx = hand.findIndex((t) => t !== 'back' && toCorePai(t) === core);
  }
  if (idx < 0) idx = hand.indexOf('back');
  if (idx >= 0) hand.splice(idx, 1);
}

// mianzi から「手牌から消費した枚数分の core 牌」を得る [方向マーカー直前 = 鳴いた牌は除く]
export function mianziConsumedTiles(mianzi: string): string[] {
  if (typeof mianzi !== 'string' || mianzi.length < 2) return [];
  const suit = mianzi[0];
  const body = mianzi.slice(1);
  const out: string[] = [];
  for (let i = 0; i < body.length; i++) {
    const ch = body[i];
    if (ch < '0' || ch > '9') continue;
    const marker = body[i + 1];
    if (marker === '-' || marker === '=' || marker === '+') continue; // 鳴いた牌
    out.push(suit + ch);
  }
  return out;
}

const seatName = (n: number) => `P${n}`;

function isSeat(v: unknown): v is 0 | 1 | 2 {
  return v === 0 || v === 1 || v === 2;
}

export function foldPaifu(events: unknown): ReplayRound[] {
  if (!Array.isArray(events)) return [];
  const rounds: ReplayRound[] = [];
  let seats = emptySeats();
  let prevWasQipai = false;
  let current: ReplayRound | null = null;
  let pendingQipai: Record<number, string[] | number> = {};

  const pushStep = (desc: string, eventType: string) => {
    if (!current) {
      current = { label: `局${rounds.length + 1}`, steps: [] };
      rounds.push(current);
    }
    current.steps.push({ desc, seats: cloneSeats(seats), eventType });
  };

  const beginRound = () => {
    seats = emptySeats();
    current = { label: `局${rounds.length + 1}`, steps: [] };
    rounds.push(current);
  };

  const flushQipai = () => {
    for (const [p, v] of Object.entries(pendingQipai)) {
      const seat = Number(p);
      if (!isSeat(seat)) continue;
      seats[seat].hand = Array.isArray(v) ? [...v] : Array(Math.max(0, Number(v) || 0)).fill('back');
    }
    if (Object.keys(pendingQipai).length > 0) {
      pushStep('配牌', 'qipai');
    }
    pendingQipai = {};
  };

  for (const raw of events) {
    if (!raw || typeof raw !== 'object') continue;
    const ev = raw as Record<string, any>;
    const etype = String(ev.type ?? '');
    if (etype === 'qipai') {
      if (!prevWasQipai) {
        beginRound();
        pendingQipai = {};
      }
      prevWasQipai = true;
      const seat = ev.player;
      if (isSeat(seat)) {
        pendingQipai[seat] = Array.isArray(ev.tiles) ? ev.tiles : Number(ev.count ?? 13);
      }
      continue;
    }
    if (prevWasQipai) flushQipai();
    prevWasQipai = false;

    const seat = isSeat(ev.player) ? ev.player : null;
    switch (etype) {
      case 'zimo': {
        if (seat === null) break;
        seats[seat].hand.push(typeof ev.pai === 'string' ? ev.pai : 'back');
        pushStep(`${seatName(seat)} ツモ`, etype);
        break;
      }
      case 'dapai': {
        if (seat === null) break;
        const pai = typeof ev.pai === 'string' ? ev.pai : 'back';
        const clean = pai.replace(/[_*]$/, '');
        removeFromHand(seats[seat].hand, clean);
        const riichiNow = seats[seat].riichi !== 'none'
          && !seats[seat].river.some((r) => r.riichi);
        seats[seat].river.push({ pai: clean, riichi: riichiNow });
        pushStep(`${seatName(seat)} 打 ${clean}`, etype);
        break;
      }
      case 'fulou': {
        if (seat === null) break;
        const mianzi = String(ev.mianzi ?? '');
        for (const t of mianziConsumedTiles(mianzi)) removeFromHand(seats[seat].hand, t);
        seats[seat].melds.push(mianzi);
        const from = isSeat(ev.from) ? ev.from : null;
        if (from !== null && seats[from].river.length > 0) seats[from].river.pop();
        const kind = mianzi.length >= 6 ? '大明槓' : /(\d)\1\1/.test(mianzi.slice(1).replace(/[+\-=]/g, '')) ? 'ポン' : 'チー';
        pushStep(`${seatName(seat)} ${kind} [${mianzi}]`, etype);
        break;
      }
      case 'gang': {
        if (seat === null) break;
        const mianzi = String(ev.mianzi ?? '');
        const open = /[+\-=]/.test(mianzi);
        for (const t of mianziConsumedTiles(mianzi)) removeFromHand(seats[seat].hand, t);
        seats[seat].melds.push(mianzi);
        pushStep(`${seatName(seat)} ${open ? '加槓' : '暗槓'} [${mianzi}]`, etype);
        break;
      }
      case 'lizhi': {
        if (seat === null) break;
        seats[seat].riichi = ev.fever === true ? 'fever' : 'riichi';
        const parts = [
          ev.fever === true ? 'フィーバーリーチ' : 'リーチ',
          ev.open === true ? 'オープン' : '',
          ev.shuvari === true ? 'シュバリ' : '',
        ].filter(Boolean).join('・');
        pushStep(`${seatName(seat)} ${parts}`, etype);
        break;
      }
      case 'nukiBei': {
        if (seat === null) break;
        seats[seat].nuki += 1;
        removeFromHand(seats[seat].hand, ev.gold === true ? 'gN' : 'z4');
        if (typeof ev.replacement === 'string' && ev.replacement) seats[seat].hand.push(ev.replacement);
        pushStep(`${seatName(seat)} 北抜き${ev.gold === true ? ' [金]' : ''}`, etype);
        break;
      }
      case 'hule': {
        if (seat === null) break;
        const da = ev.defenAfter;
        if (da && typeof da === 'object') {
          for (const s of SEATS) seats[s].defen = Number(da[s] ?? da[String(s)] ?? seats[s].defen ?? 0);
        }
        const yaku = Array.isArray(ev.hupai)
          ? ev.hupai.map((h: any) => h?.name).filter(Boolean).slice(0, 6).join('・')
          : '';
        const kind = ev.nagashi === true ? '流し役満' : ev.isRon === true ? `ロン${isSeat(ev.loser) ? ` [放銃 ${seatName(ev.loser)}]` : ''}` : 'ツモ';
        const pts = ev.defen != null ? ` ${Number(ev.defen).toLocaleString()}点` : '';
        {
          // current は closure 内で再代入されるため TS が never に潰す [値は round 参照]
          const cur = current as ReplayRound | null;
          const jushu = Number(ev.jushu ?? NaN);
          const chang = Number(ev.changbang ?? NaN);
          const ben = Number(ev.benbang ?? NaN);
          if (cur && !Number.isNaN(jushu) && !Number.isNaN(chang)) {
            const winds = ['東', '南', '西'];
            cur.label = `${winds[Math.min(chang, 2)] ?? '東'}${jushu + 1}局${ben > 0 ? ` ${ben}本場` : ''}`;
          }
        }
        pushStep(`${seatName(seat)} ${kind}${pts}${yaku ? ` [${yaku}]` : ''}`, etype);
        break;
      }
      case 'pingju': {
        pushStep(`流局 [${String(ev.reason ?? '')}]`, etype);
        break;
      }
      case 'shuvariRefund': {
        pushStep(`${seat !== null ? seatName(seat) : ''} シュバリ返還`, etype);
        break;
      }
      default:
        break; // 未知 event は state を触らず読み飛ばす
    }
  }
  if (prevWasQipai) flushQipai();
  return rounds;
}
