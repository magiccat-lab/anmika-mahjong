// 人別の運と腕に足す数を、ws の記録を全部屋読み直して出す [2026-11-03 先輩「サイコロの収支、期待値で置き換えたEVだして」
// 「配牌の平均シャンテン数とかはほしいかも まあ後逆/正ツモも枚数の期待値とか？」「シュバ成就率とシュバで増えた枚数」]。
// 出すのは試合の席 (0-2) ごとの生の数。人への割り当ては server/player_profile.py (試合ごとの席 → 人) がする。
//  - dice: サイコロ 1 回ごとの基本の枚数 ・ 倍率 ・ 投げる数 ・ シュバサイか。期待値は player_profile が出す
//  - hands: 局ごとの配牌のシャンテン数
//  - pochi: リーチ中のツモの数と、正ぽっち (緑 ・ 青) ・ 逆ぽっち (赤 ・ 黄) を引いた数と、その期待値
//    [期待値 = ツモごとに「その人から見えていない色付きぽっち / 見えていない牌」を足した物]
//  - xt2 / xt1 / xt0: 局ごとに 2 シャンテン ・ 1 シャンテン ・ テンパイに初めて届いた巡目 [11-06 先輩「平均シャンテン巡目とかも出せるようにして欲しい(2/1/テンパイ)」]。
//    巡目 = その局で自分が切った回数 (配牌で届いていれば 0)。_n は届いた局の数、_sum は巡目の和、xt_rounds は見た局の数
//  - shuba: シュバの宣言 ・ 成就 (宣言した局で 1 回でも和了、宣言 1 回に 1 回まで) ・ ×2 で増えた枚数 [シュバ×2 の付いたチップの半分、払う人の数を掛けた和了者の増え]
// 使い方: tsx tools/profile_replay.mts [ws の DB] > out.json
import { DatabaseSync } from 'node:sqlite';
import { resolve } from 'node:path';

import Majiang from '@kobalab/majiang-core';
import { createRoomAuthority, type RoomAuthority } from '../server/authority';
import { toCorePai } from '../src/lib/helpers';
import { swapM7, unswapM1, kanpamanXt } from '../src/lib/game3/cpuValue';
import { americanChitoiXiangting } from '../src/lib/game3/tingpai';
import { parseCanonicalRoomSnapshot, type AcceptedRoomCommand } from '../server/protocol';

const dbPath = process.argv[2] ?? resolve('data', 'anmika.sqlite3');
const db = new DatabaseSync(dbPath, { readOnly: true });
const snaps = db.prepare('SELECT room_id, snapshot_json FROM room_state_snapshots').all() as Array<{ room_id: string; snapshot_json: string }>;
const cmdStmt = db.prepare('SELECT command_id, revision, actor_seat, action_json, accepted_at FROM room_accepted_commands WHERE room_id=? ORDER BY revision ASC');

type Seat = 0 | 1 | 2;
type Dice = { room: string; match: number; rev: number; seat: number; base: number; mult: number; rolls: number; shuba: boolean; mode: string };
type Count = { room: string; match: number; seat: number } & Record<string, number | string>;

const dice: Dice[] = [];
const hands: Array<{ room: string; match: number; seat: number; xt: number }> = [];
const counts = new Map<string, Count>();
const diverged: Array<{ room: string; match: number; revision: number; reason: string }> = [];

function bump(room: string, match: number, seat: number, f: string, v = 1) {
  const k = `${room}|${match}|${seat}`;
  let c = counts.get(k);
  if (!c) counts.set(k, (c = { room, match, seat }));
  c[f] = (Number(c[f] ?? 0) + v);
}

const POS = new Set(['z5g', 'z5b']);
const NEG = new Set(['z5r', 'z5y']);
// 華牌 (f1-f4) は配牌にもツモにも出ず黙って入れ替わるので、ツモに来うる牌から外す。表ドラの表示牌は全員に見えている
const drawable = (pool: string[] | undefined) => (pool ?? []).filter((x) => !String(x).startsWith('f')).length;

function xiangting(tiles: string[]): number | null {
  try {
    const sp = new Majiang.Shoupai(tiles.map((t) => toCorePai(t)));
    return Majiang.Util.xiangting(sp);
  } catch {
    return null;
  }
}

/** シャンテン巡目に使うアンミカのシャンテン (room_analysis の anmikaXt と同じ数え方 + 国士):
 *  7萬を 1萬にした手の通常形 ・ 嵌八萬 ・ 七対子 ・ アメリカン七対子 ・ 国士の一番小さい物。鳴いた手もそのまま */
function anmikaXt(sp: any): number | null {
  try {
    const a = swapM7(sp.clone());
    let xt = Math.min(Majiang.Util.xiangting_yiban(a), kanpamanXt(a), Majiang.Util.xiangting_qidui(a));
    try { xt = Math.min(xt, americanChitoiXiangting(unswapM1(a.clone()))); } catch { /* 七対子だけ */ }
    const g = Majiang.Util.xiangting_guoshi(a);
    if (Number.isFinite(g)) xt = Math.min(xt, g);
    return Number.isFinite(xt) ? xt : null;
  } catch {
    return null;
  }
}
const XT_STEPS = [2, 1, 0] as const;

// 局の中の見え方。seen[p] = p の手に来た牌 (配牌 ・ 自分のツモ) と表ドラの表示牌の数、pos/neg = そのうちの色付きぽっち。
// 人の捨て牌は数えない: 人は字牌やぽっちを選んで捨てるので、捨て牌を「山に無い」に入れると残りの山の中身を読み違える
// (11-03 実測: 捨て牌まで入れると期待値 2351 枚に対し実際 2654、自分の手だけなら 2611)。山の残りは自分の手以外から一様に来る
type Round = { poolLen: number; dealt: Set<number>; seen: number[]; pos: number[]; neg: number[]; lizhi: Set<number>; shubaDecl: Set<number>;
  junme: number[]; reached: Array<Set<number>> };

for (const snap of snaps) {
  const room = snap.room_id;
  let snapshot: any;
  try { snapshot = parseCanonicalRoomSnapshot(snap.snapshot_json); } catch { continue; }
  if (!snapshot.started || !snapshot.start) continue;
  const start = snapshot.start;
  const rows = cmdStmt.all(room) as Array<{ command_id: string; revision: number; actor_seat: number; action_json: string; accepted_at: string }>;
  const commands: AcceptedRoomCommand[] = rows.map((row) => ({
    commandId: row.command_id, revision: row.revision, actorSeat: row.actor_seat, fromUserId: '',
    action: JSON.parse(row.action_json), matchId: 0, roundId: 0, acceptedAt: row.accepted_at,
  }));
  const segments: AcceptedRoomCommand[][] = [[]];
  for (const command of commands) {
    if (command.action.type === 'nextMatch') segments.push([command]);
    else segments[segments.length - 1].push(command);
  }
  const members = start.members.map((m: any) => ({ seat: m.seat, is_cpu: m.is_cpu }));

  segments.forEach((segment, index) => {
    const match = index + 1;
    let authority: RoomAuthority;
    let body = segment;
    let poolLen = drawable(start.preShuffledPool);
    try {
      if (index === 0) {
        authority = createRoomAuthority({ preShuffledPool: start.preShuffledPool, qijia: start.qijia, changshu: start.changshu });
      } else {
        const next = segment[0].action as Record<string, any>;
        if (!next._startChipLedger) return;
        poolLen = drawable(next.preShuffledPool);
        authority = createRoomAuthority({ preShuffledPool: next.preShuffledPool, qijia: next.qijia, changshu: start.changshu });
        authority.seedMatchStart(next._startChipLedger, members);
        body = segment.slice(1);
      }
    } catch (e) {
      diverged.push({ room, match, revision: 0, reason: `start: ${e}` });
      return;
    }
    let round: Round | null = null;
    let inDice = false;

    // 局の出来事を見て数える。hule は before の shuvariActive で成就を決める
    const markXt = (p: number, xt: number | null) => {
      if (xt === null || !round) return;
      for (const k of XT_STEPS) {
        if (xt > k || round.reached[p].has(k)) continue;
        round.reached[p].add(k);
        bump(room, match, p, `xt${k}_n`);
        bump(room, match, p, `xt${k}_sum`, round.junme[p]);
      }
    };
    let cut = new Set<number>();
    const onEvents = (events: any[], before: any, newBreakdown: any[], after: any = before) => {
      cut = new Set();
      for (const ev of events) {
        const t = ev?.type;
        if (t === 'qipai') {
          // 新しい局。qipai は席ごとに 1 つずつ来る
          if (!round || round.dealt.has(ev.player)) {
            // 前の局の切りは新しい局の手では測れないので捨てる
            cut = new Set();
            const len = Number(before?.game?.shan?._pai?.length ?? 0);
            round = { poolLen: poolLen || len, dealt: new Set(), seen: [0, 0, 0], pos: [0, 0, 0], neg: [0, 0, 0], lizhi: new Set(), shubaDecl: new Set(),
              junme: [0, 0, 0], reached: [new Set(), new Set(), new Set()] };
            const dora: string[] = (after?.game?.shan?._baopai ?? []).filter((x: any) => typeof x === 'string' && !x.startsWith('f'));
            for (const q of [0, 1, 2]) {
              round.seen[q] += dora.length;
              round.pos[q] += dora.filter((x) => POS.has(x)).length;
              round.neg[q] += dora.filter((x) => NEG.has(x)).length;
            }
          }
          round.dealt.add(ev.player);
          const tiles: string[] = ev.tiles ?? [];
          round.seen[ev.player] += tiles.length;
          round.pos[ev.player] += tiles.filter((x) => POS.has(x)).length;
          round.neg[ev.player] += tiles.filter((x) => NEG.has(x)).length;
          bump(room, match, ev.player, 'xt_rounds');
          markXt(ev.player, (() => { try { return anmikaXt(new Majiang.Shoupai(tiles.map((x) => toCorePai(x)))); } catch { return null; } })());
          // 配牌のシャンテンは読み直しが止まった試合も拾えるよう、記録の _blindState から別に数える (下)。最初の局だけここで
          if (firstDeal) {
            const xt = xiangting(tiles);
            if (xt !== null) hands.push({ room, match, seat: ev.player, xt });
          }
          continue;
        }
        if (!round) continue;
        if (t === 'dapai') {
          // 切った後の手で見る。1 つの command の中で同じ人が 2 回切った時は最後の手しか見えないので、最後の巡目で数える
          round.junme[ev.player] += 1;
          cut.add(ev.player);
          continue;
        }
        const draw = (p: number, pai: string) => {
          if (round!.lizhi.has(p)) {
            const unseen = round!.poolLen - round!.seen[p];
            if (unseen > 0) {
              bump(room, match, p, 'lz_draws');
              bump(room, match, p, 'e_pos', Math.max(0, 2 - round!.pos[p]) / unseen);
              bump(room, match, p, 'e_neg', Math.max(0, 2 - round!.neg[p]) / unseen);
              if (POS.has(pai)) bump(room, match, p, 'pos');
              if (NEG.has(pai)) bump(room, match, p, 'neg');
            }
          }
          round!.seen[p] += 1;
          if (POS.has(pai)) round!.pos[p] += 1;
          if (NEG.has(pai)) round!.neg[p] += 1;
        };
        // 北抜きの補充のツモは nukiBei の前に zimo として出ている (replacement は同じ牌の写し) ので数えない
        if (t === 'zimo') draw(ev.player, String(ev.pai ?? ''));
        else if (t === 'lizhi') {
          round.lizhi.add(ev.player);
          if (ev.shuvari) {
            round.shubaDecl.add(ev.player);
            bump(room, match, ev.player, 'shuba_decl');
          }
        } else if (t === 'lizhiRefund' || t === 'shuvariRefund') {
          round.lizhi.delete(ev.player);
        } else if (t === 'hule') {
          const w = Number(ev.player);
          if (before?.game?.shuvariActive?.[w]) {
            // アンミカは和了の後も局が続くので、1 局に何回も和了がある。成就は宣言 1 回につき 1 回だけ数え、増えた枚数は和了ごとに全部足す
            if (round.shubaDecl.delete(w)) bump(room, match, w, 'shuba_won');
            // シュバ×2 の付いたチップ: 1 人あたりの total の半分が増えた分。オールは払う 2 人分
            for (const b of newBreakdown) {
              if (!(b.multiplierParts ?? []).includes('シュバ×2')) continue;
              bump(room, match, w, 'shuba_extra', (Number(b.total) / 2) * (b.mode === 'oall' ? 2 : 1));
            }
          }
        }
      }
      for (const p of cut) {
        const sp = after?.game?.shoupai?.get?.(p);
        if (sp) markXt(p, anmikaXt(sp));
      }
    };

    // 配牌: nextRound ・ nextMatch の記録の _blindState.hands (試合の席 → 13 枚)。読み直しに頼らない
    for (const command of segment) {
      const a = command.action as Record<string, any>;
      if (a.type !== 'nextRound' && a.type !== 'nextMatch') continue;
      for (const [seat, tiles] of Object.entries((a._blindState?.hands ?? {}) as Record<string, string[]>)) {
        const xt = Array.isArray(tiles) && tiles.length === 13 ? xiangting(tiles) : null;
        if (xt !== null) hands.push({ room, match, seat: Number(seat), xt });
      }
    }
    // 部屋の最初の局は nextRound が無いので、読み直しの最初の qipai から拾う
    let firstDeal = index === 0;
    try {
      const g0: any = authority.canonicalState().game;
      onEvents(g0.events ?? [], authority.canonicalState(), []);
    } catch { /* 初めの局の配牌が拾えない時は飛ばす */ }
    firstDeal = false;

    for (const command of body) {
      const type = String(command.action.type);
      if (type === 'stamp') continue;
      const before: any = authority.canonicalState();
      const evBefore = (before.game.events ?? []).length;
      const bdBefore = (before.game.chipBreakdown ?? []).length;
      // shuvariActive は適用で落ちる事があるので写しを持つ
      const beforeView = { game: { shuvariActive: { ...(before.game.shuvariActive ?? {}) }, shan: before.game.shan } };
      if (type === 'selectSaiKoroCombo' && before.pendingSaiKoro && !inDice) {
        inDice = true;
        const ps = before.pendingSaiKoro;
        const chance = ps.chances[ps.currentIdx] ?? {};
        const roller = Number(chance.winner ?? ps.winner) as Seat;
        const mode = chance.mode === 'ron' ? 'ron' : 'tsumo';
        dice.push({
          room, match, rev: command.revision, seat: roller,
          base: Number(chance.baseChip ?? 0),
          mult: before.game.computeChipMultiplier(roller, { bypassShuvari: true, bypassPochi: mode === 'ron', mode }),
          rolls: Math.max(1, Number(chance.rollCount ?? 4)),
          shuba: chance.alwaysShuvari === true || (chance.shuvariApplicable === true && !!before.game.shuvariActive?.[roller]),
          mode,
        });
      }
      if (type === 'advanceSaiKoro') inDice = false;
      let reason: string | null = null;
      try {
        reason = authority.validateAndApply(command.actorSeat, structuredClone(command.action), members);
      } catch (e) {
        reason = `throw: ${e}`;
      }
      if (reason) {
        diverged.push({ room, match, revision: command.revision, reason: String(reason).slice(0, 200) });
        return;
      }
      authority.takeCanonicalChipEffects();
      authority.takePendingCutins();
      const after: any = authority.canonicalState();
      const evs = after.game.events ?? [];
      const bds = after.game.chipBreakdown ?? [];
      // 局が替わると events ・ chipBreakdown は空から始まる
      const newEvents = evs.length >= evBefore ? evs.slice(evBefore) : evs;
      const newBd = bds.length >= bdBefore ? bds.slice(bdBefore) : bds;
      onEvents(newEvents, beforeView, newBd, after);
    }
  });
}
db.close();

console.log(JSON.stringify({ dice, hands, counts: [...counts.values()], diverged }));
