// 打牌の分析の仮置きを、実際の牌譜で測り直す [2026-10-14 リョー「仮置きはそれでいいのか考え直して、判断の論拠」]
// 全部の部屋を読み直し、リーチ 1 回ずつについて
//  - 待ちの形 (両面 ・ 嵌張 ・ 辺張 ・ 双碰 ・ 単騎) と、コンボ理論が見込む形の割合 (次の席から見た見えていない枚数で数える)
//  - その局の結末 (ツモ ・ ロン ・ 他の人のアガリ ・ 流局) と、モンテカルロ (mc_eval) が見込む和了率 ・ ツモの割合
// を出す。使い方: node_modules/.bin/tsx tools/calib_assumptions.mts [db] [--sims 300]
import { DatabaseSync } from 'node:sqlite';
import { resolve } from 'node:path';

// @ts-ignore - majiang-core 型定義なし
import Majiang from '@kobalab/majiang-core';
import { createRoomAuthority, type RoomAuthority } from '../server/authority';
import { parseCanonicalRoomSnapshot, type AcceptedRoomCommand } from '../server/protocol';
import { toCorePai, normalizeBaopaiForMajiang, isPositiveZ5 } from '../src/lib/helpers';
import { waitShapes, unseenCounter } from './lib/combo_danger.mts';
import { mcOption } from './lib/mc_eval.mts';

const argv = process.argv.slice(2);
const simsAt = argv.indexOf('--sims');
const SIMS = simsAt >= 0 ? Number(argv[simsAt + 1]) : 300;
if (simsAt >= 0) argv.splice(simsAt, 2);
const dbPath = argv[0] ?? resolve('data', 'anmika.sqlite3');

const anmikaRule = Majiang.rule({
  '配給原点': 35000, '順位点': ['30.0', '0', '-30.0'], '場数': 1, '連荘方式': 3, 'ノーテン罰あり': false,
  'クイタンあり': true, '途中流局あり': false, '一発あり': true, '裏ドラあり': true,
});
const baseOf = (p: string) => {
  const core = toCorePai(String(p).replace(/[+=\-_*]/g, ''));
  return core.length < 2 ? core : core[0] + (core[1] === '0' ? '5' : core[1]);
};
const KINDS: string[] = [];
for (const s of ['m', 'p', 's']) for (let n = 1; n <= 9; n++) if (s !== 'm' || n === 7 || n === 9) KINDS.push(s + n);
for (let n = 1; n <= 7; n++) KINDS.push('z' + n);

// 待ちの形: hule_mianzi の分け方で、アガリ牌 (!) がどの面子のどこに入るか
function shapeOf(sp13: any, w: string): string[] {
  let decs: string[][] = [];
  try { decs = Majiang.Util.hule_mianzi(sp13, `${w}-`) ?? []; } catch { decs = []; }
  const kinds = new Set<string>();
  for (const dec of decs) {
    for (const m of dec) {
      if (!m.includes('!')) continue;
      const digits = m.replace(/[^0-9]/g, '');
      const pos = m.slice(1).replace(/[\-=+]/g, '').indexOf('!') - 1;
      if (digits.length === 2) kinds.add('単騎');
      else if (digits[0] === digits[1]) kinds.add('双碰');
      else if (pos === 1) kinds.add('嵌張');
      else if (pos === 0) kinds.add(digits === '789' ? '辺張' : '両面');
      else kinds.add(digits === '123' ? '辺張' : '両面');
    }
  }
  return [...kinds];
}

type Riichi = {
  room: string; seat: number; hand: string; waits: string[]; shapes: string[]; waitUnseen: number;
  predicted: Record<string, number>; outcome: 'tsumo' | 'ron' | 'lost' | 'draw' | null; pochi: boolean;
  mc: Record<string, { win: number; tsumo: number }>;
};
const riichis: Riichi[] = [];
let hulesAll = 0;
let turnsAll = 0;

const db = new DatabaseSync(dbPath, { readOnly: true });
const rooms = db.prepare('SELECT room_id, snapshot_json FROM room_state_snapshots').all() as Array<{ room_id: string; snapshot_json: string }>;
type Pending = { r: Riichi; mcIn: any };
const mcJobs: Pending[] = [];
for (const room of rooms) {
  let snapshot: any;
  try { snapshot = parseCanonicalRoomSnapshot(room.snapshot_json); } catch { continue; }
  if (!snapshot.started || !snapshot.start) continue;
  const start = snapshot.start;
  const rows = db.prepare('SELECT revision, actor_seat, action_json, accepted_at FROM room_accepted_commands WHERE room_id=? ORDER BY revision ASC').all(room.room_id) as Array<{
    revision: number; actor_seat: number; action_json: string; accepted_at: string;
  }>;
  const commands: AcceptedRoomCommand[] = rows.map((row) => ({
    commandId: String(row.revision), revision: row.revision, actorSeat: row.actor_seat, fromUserId: '',
    action: JSON.parse(row.action_json), matchId: 0, roundId: 0, acceptedAt: row.accepted_at,
  }));
  const members = start.members.map((member: any) => ({ seat: member.seat, is_cpu: member.is_cpu }));
  const segments: AcceptedRoomCommand[][] = [[]];
  for (const command of commands) {
    if (command.action.type === 'nextMatch') segments.push([command]);
    else segments[segments.length - 1].push(command);
  }
  segments.forEach((segment, index) => {
    let authority: RoomAuthority;
    let body = segment;
    try {
      if (index === 0) {
        authority = createRoomAuthority({ preShuffledPool: start.preShuffledPool, qijia: start.qijia, changshu: start.changshu });
      } else {
        const next = segment[0].action as Record<string, any>;
        if (!next._startChipLedger) return;
        authority = createRoomAuthority({ preShuffledPool: next.preShuffledPool, qijia: next.qijia, changshu: start.changshu });
        authority.seedMatchStart(next._startChipLedger, members);
        body = segment.slice(1);
      }
    } catch { return; }
    let open: Riichi[] = [];
    for (const command of body) {
      const type = String(command.action.type);
      if (type === 'stamp') continue;
      const before: any = authority.canonicalState();
      const lzBefore = new Set<number>([...(before.game.lizhi ?? [])]);
      const eventsBefore = (before.game.events ?? []).length;
      if (type === 'nextRound') {
        for (const r of open) if (!r.outcome) r.outcome = 'draw';
        open = [];
      }
      if (type === 'discard' || type === 'tsumokiri') turnsAll += 1;
      let reason: string | null = null;
      try { reason = authority.validateAndApply(command.actorSeat, structuredClone(command.action), members); } catch { reason = 'throw'; }
      if (reason) return;
      authority.takeCanonicalChipEffects();
      authority.takePendingCutins();
      const after: any = authority.canonicalState();
      const g = after.game;
      for (const event of (g.events ?? []).slice(eventsBefore)) {
        if (event?.type === 'hule') {
          hulesAll += 1;
          const pochi = (event.hupai ?? []).some((h: any) => /ぽっち/.test(String(h.name)));
          for (const r of open) {
            if (r.outcome) continue;
            if (event.player === r.seat) { r.outcome = event.isRon ? 'ron' : 'tsumo'; r.pochi = pochi; } else r.outcome = 'lost';
          }
        }
      }
      // 新しいリーチ (リーチの打牌が通った後の 13 枚)
      for (const p of [...(g.lizhi ?? [])] as number[]) {
        if (lzBefore.has(p)) continue;
        const sp = g.shoupai.get(p);
        if (!sp || sp._zimo) continue;
        let waits: string[] = [];
        try { waits = (Majiang.Util.tingpai(sp) ?? []).filter((w: string) => KINDS.includes(w)); } catch { waits = []; }
        if (!waits.length) continue;
        const shapes = [...new Set(waits.flatMap((w) => shapeOf(sp, w)))];
        // コンボ理論の見込み: 次の席から見た見えていない枚数で、形ごとの組み合わせの数 (重み 1)
        const q = (p + 1) % 3;
        const unseenQ = unseenCounter(g, q);
        const river = new Set(((g.he.get(p)?._pai ?? []) as string[]).map(baseOf));
        const predicted: Record<string, number> = { 両面: 0, 嵌張: 0, 辺張: 0, 双碰: 0, 単騎: 0 };
        for (const s of waitShapes(river, unseenQ)) predicted[s.kind] += s.combos;
        const tot = Object.values(predicted).reduce((a, b) => a + b, 0) || 1;
        for (const k of Object.keys(predicted)) predicted[k] /= tot;
        const unseenP = unseenCounter(g, p);
        const r: Riichi = {
          room: room.room_id, seat: p, hand: sp.toString(), waits, shapes, waitUnseen: waits.reduce((a, w) => a + unseenP(w), 0),
          predicted, outcome: null, pochi: false, mc: {},
        };
        riichis.push(r);
        open.push(r);
        const paishu = Number(g.shan?.paishu ?? 0);
        const param = Majiang.Util.hule_param({
          rule: anmikaRule, zhuangfeng: g.changfengZ - 1, menfeng: g.zifengZ(p) - 1, lizhi: 1,
          baopai: (g.shan?.baopai ?? []).filter((x: any) => typeof x === 'string' && !x.startsWith('f') && !isPositiveZ5(x)).map(normalizeBaopaiForMajiang),
          fubaopai: null, changbang: g.state.benbang, lizhibang: g.state.lizhibang,
        });
        mcJobs.push({ r, mcIn: { sp: sp.clone(), unseen: unseenP, draws: Math.max(1, Math.floor(paishu / 3)), param, river } });
      }
    }
    for (const r of open) if (!r.outcome) r.outcome = 'draw';
  });
}
db.close();

// モンテカルロの見込みを、ロンを取る割合 ・ 局が終わる割合の組み合わせごとに
const endBase = turnsAll ? hulesAll / turnsAll : 0.04;
const GRID: Array<[number, number]> = [];
for (const rt of (process.env.CALIB_RT ?? "0.25,0.5,0.75,1").split(",").map(Number)) for (const es of (process.env.CALIB_ES ?? "0,0.5,1,1.5").split(",").map(Number)) GRID.push([rt, es]);
const POCHI = process.env.CALIB_POCHI === '1';
const cache = new Map<string, any>();
let seed = 1;
for (const job of mcJobs) {
  for (const [rt, es] of GRID) {
    const res = mcOption(job.mcIn.sp, {
      kinds: KINDS, unseen: job.mcIn.unseen, draws: job.mcIn.draws, param: job.mcIn.param, river: job.mcIn.river,
      seed: seed, endRate: endBase * es, ronTake: rt, pochiWild: POCHI,
    }, SIMS, cache);
    job.r.mc[`${rt}/${es}`] = { win: res.win, tsumo: res.tsumo };
  }
  seed += 7;
}
console.log(JSON.stringify({ sims: SIMS, endBase, hulesAll, turnsAll, riichis }));
