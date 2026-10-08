// [2026-10-09 遊真 A5] 記録の読み直しを軽くした 2 つの変更が、状態を 1 つも変えない事を確かめる。
//
// 1. reject の後は全 command を読み直さない [authority.canonicalMayBeDirty の時だけ作り直す]。
//    検証で弾いた手の後の authority が、作り直した物と同じかを毎回見る。
// 2. 試合の区切り [nextMatch に焼いた _startChipLedger] から復元する。頭から読んだ authority と、
//    区切りから読んだ authority が、canonical ・ 検証用の mirror ・ 3 席の投影 ・ 試合の精算で
//    一致し、その後に同じ command を続けても一致し続けるかを見る。
//
// 進め方は authority_stall_hunt と同じ seeded の駆動 [server の代行 + たまに client の乱手]。
// 東風 3 試合ぶん以上を作るので重い [数十秒]。
import { describe, expect, it } from 'vitest';

import { createRoomAuthority, type RoomAuthority } from '../../../server/authority';
import {
  captureSeatProjection,
  lastReplayableMatchBoundary,
  reactionTimeoutAction,
  restoreAuthority,
  turnTimeoutAction,
} from '../../../server/ws_server';
import type { AcceptedRoomCommand, CanonicalRoomSnapshot } from '../../../server/protocol';
import { defaultSanmaRule, generateTilePool } from '../shan3';

type Member = { seat: number; is_cpu: boolean };
type Cand = { actor: number; action: Record<string, any> };

function rng(seed: number): () => number {
  let value = seed >>> 0;
  return () => {
    value = (value + 0x6d2b79f5) >>> 0;
    let mixed = value;
    mixed = Math.imul(mixed ^ (mixed >>> 15), mixed | 1);
    mixed ^= mixed + Math.imul(mixed ^ (mixed >>> 7), mixed | 61);
    return ((mixed ^ (mixed >>> 14)) >>> 0) / 0x1_0000_0000;
  };
}

function shuffledPool(random: () => number): string[] {
  const tiles = generateTilePool(defaultSanmaRule()).map(String);
  for (let index = tiles.length - 1; index > 0; index -= 1) {
    const other = Math.floor(random() * (index + 1));
    [tiles[index], tiles[other]] = [tiles[other], tiles[index]];
  }
  return tiles;
}

function owner(pending: any): number {
  return pending?.decisionOwners?.[pending?.decisionOwnerIndex ?? 0] ?? pending?.winner ?? 0;
}

/** ws_server の computePostWinAutoAction と同じ代行 */
function postWinAction(state: any, random: () => number): Cand | null {
  if (state.pendingFuyu) return { actor: owner(state.pendingFuyu), action: { type: 'selectFuyu', use: random() < 0.7 } };
  if (state.pendingKinpei) {
    const pending = state.pendingKinpei;
    const hua: string[] = pending.availableHuapai ?? state.game.effectiveHuapaiAtHule(pending.winner);
    const target = hua.includes('f4') ? 'fuyu' : hua.includes('f3') ? 'aki' : hua.includes('f2') ? 'natsu' : hua.includes('f1') ? 'haru' : null;
    return { actor: owner(pending), action: { type: 'selectKinpei', target } };
  }
  if (state.pendingKamiPochi) {
    const pending = state.pendingKamiPochi;
    return { actor: owner(pending), action: { type: 'selectKamiPochi', target: pending.candidates?.[0], occurrenceKey: pending.occurrenceKey } };
  }
  if (state.pendingPochiSwap) {
    const pending = state.pendingPochiSwap;
    return { actor: owner(pending), action: { type: 'selectPochiSwap', target: pending.candidates?.[0]?.target } };
  }
  if (state.pendingSaiKoro) {
    const pending = state.pendingSaiKoro;
    const actor = pending.chances?.[pending.currentIdx ?? 0]?.winner ?? pending.winner;
    if (!pending.selectedCombo) return { actor, action: { type: 'selectSaiKoroCombo', small: 1, large: 6 } };
    if (!pending.finalized) {
      return { actor, action: { type: 'rollSaiKoroDice', override: [1 + Math.floor(random() * 6), 1 + Math.floor(random() * 6)] } };
    }
    return { actor, action: { type: 'advanceSaiKoro' } };
  }
  if (state.pendingFeverContinue) return { actor: state.pendingFeverContinue.winner, action: { type: 'continueFever' } };
  return null;
}

/** client が送りうる乱手 [多くは弾かれる。reject 経路を通すのが目的] */
function noiseCandidates(authority: RoomAuthority, random: () => number): Cand[] {
  const out: Cand[] = [];
  const current = authority.currentPlayer();
  const game = authority.game;
  const sp: any = game.shoupai.get(current);
  let dapai: string[] = [];
  try { dapai = (sp?.get_dapai?.(false) ?? []) as string[]; } catch { dapai = []; }
  for (const pai of dapai.slice(0, 4)) out.push({ actor: current, action: { type: 'discard', pai: String(pai).replace(/[_*]$/, '') } });
  out.push({ actor: (current + 1) % 3, action: { type: 'discard', pai: 'm1' } });
  out.push({ actor: current, action: { type: 'tsumo' } });
  out.push({ actor: current, action: { type: 'tsumokiri' } });
  out.push({ actor: current, action: { type: 'lizhi', opts: { open: random() < 0.2, shuvari: random() < 0.3, fever: random() < 0.3 } } });
  out.push({ actor: current, action: { type: 'nukiBei', meta: { gold: false } } });
  out.push({ actor: current, action: { type: 'cancelLizhi' } });
  for (const player of authority.ronCandidates) out.push({ actor: player, action: { type: 'ron', player } });
  for (const candidate of authority.ponCandidates) {
    for (const mianzi of candidate.mianzi) out.push({ actor: candidate.player, action: { type: 'pon', player: candidate.player, mianzi } });
  }
  for (const candidate of authority.kanCandidates) {
    for (const mianzi of candidate.mianzi) out.push({ actor: candidate.player, action: { type: 'damingang', player: candidate.player, mianzi } });
  }
  out.push({ actor: 0, action: { type: 'nextRound', preShuffledPool: shuffledPool(random) } });
  out.push({ actor: 0, action: { type: 'selectFuyu', use: true } });
  return out;
}

/** server が出す代行 [手番 ・ 反応 ・ 和了後 ・ 次局 ・ 次の試合] */
function driverCandidate(authority: RoomAuthority, members: Member[], random: () => number): Cand | null {
  const state: any = authority.canonicalState();
  const postWin = postWinAction(state, random);
  if (postWin) return postWin;
  if ((state.roundEnded || authority.roundEnded) && authority.isPostWinResolved()) {
    if (state.game.state.finished) {
      const resetChip = random() < 0.15;
      return {
        actor: 0,
        action: {
          type: 'nextMatch',
          preShuffledPool: shuffledPool(random),
          qijia: ((authority.game.state.qijia + 1) % 3),
          resetChip,
          finalize: !resetChip,
          cpuSeats: members.filter((member) => member.is_cpu).map((member) => member.seat),
        },
      };
    }
    return { actor: 0, action: { type: 'nextRound', preShuffledPool: shuffledPool(random) } };
  }
  const reactionSeats = new Set<number>([
    ...authority.ronCandidates,
    ...authority.ponCandidates.map((candidate) => candidate.player),
    ...authority.kanCandidates.map((candidate) => candidate.player),
  ]);
  for (const seat of reactionSeats) {
    if (members.find((member) => member.seat === seat)?.is_cpu) continue;
    if (authority.ronCandidates.includes(seat as 0 | 1 | 2) && random() < 0.5) return { actor: seat, action: { type: 'ron', player: seat } };
    const pon = authority.ponCandidates.find((candidate) => candidate.player === seat);
    if (pon && pon.mianzi.length > 0 && random() < 0.25) return { actor: seat, action: { type: 'pon', player: seat, mianzi: pon.mianzi[0] } };
    return { actor: seat, action: reactionTimeoutAction(authority, seat) };
  }
  const action = turnTimeoutAction(authority, true);
  return action ? { actor: authority.currentPlayer(), action } : null;
}

function fingerprint(authority: RoomAuthority, withProjections = true): string {
  authority.takePendingCutins();
  const canonical = authority.canonicalState();
  const mirror = authority.game as any;
  return JSON.stringify({
    canonical: (authority as any).canonicalMutationToken(canonical),
    cpu: canonical.cpu,
    onlineMode: (canonical as any)._onlineMode ?? null,
    mirrorState: mirror.state,
    mirrorHands: [0, 1, 2].map((player) => String(mirror.shoupai.get(player)?.toString?.() ?? '')),
    mirrorChip: mirror.chipLedger,
    lastZimo: authority.lastZimo,
    lastDapai: authority.lastDapai,
    roundEnded: authority.roundEnded,
    ronCandidates: authority.ronCandidates,
    ponCandidates: authority.ponCandidates,
    kanCandidates: authority.kanCandidates,
    pendingQianggang: authority.pendingQianggang,
    matchStart: authority.currentMatchStartChipLedger(),
    result: canonical.game.state.finished ? authority.matchResultLedger() : null,
    projections: withProjections ? [0, 1, 2, -1].map((seat) => captureSeatProjection(authority, seat)) : null,
  });
}

function withoutBoundaries(commands: AcceptedRoomCommand[]): AcceptedRoomCommand[] {
  return commands.map((command) => {
    if (command.action.type !== 'nextMatch') return command;
    const action = { ...command.action } as Record<string, unknown>;
    delete action._startChipLedger;
    return { ...command, action } as AcceptedRoomCommand;
  });
}

function runScenario(seed: number, members: Member[], targetMatches: number) {
  const random = rng(seed);
  const pool0 = shuffledPool(random);
  const snapshot = {
    roomId: `T${seed}`,
    started: true,
    start: {
      preShuffledPool: pool0,
      qijia: 0,
      changshu: 1,
      members: members.map((member) => ({ ...member, user_id: `u${member.seat}`, username: `u${member.seat}` })),
    },
    commands: [],
  } as unknown as CanonicalRoomSnapshot;
  let live = createRoomAuthority({ preShuffledPool: pool0, qijia: 0, changshu: 1 });
  const log: AcceptedRoomCommand[] = [];
  let matches = 0;
  let rejectsChecked = 0;
  let dirtyRebuilds = 0;

  for (let step = 0; step < 20000 && matches < targetMatches; step += 1) {
    const noisy = random() < 0.25;
    let candidate: Cand | null;
    if (noisy) {
      const pool = noiseCandidates(live, random);
      candidate = pool[Math.floor(random() * pool.length)] ?? null;
    } else {
      candidate = driverCandidate(live, members, random);
    }
    if (!candidate) continue;
    // 投影は canonical と mirror から作るので、reject の確認は軽い方で足りる
    const before = fingerprint(live, false);
    const action = structuredClone(candidate.action);
    const reason = live.validateAndApply(candidate.actor, action, members);
    if (reason) {
      if (live.canonicalMayBeDirty) {
        // ws と同じく作り直す
        dirtyRebuilds += 1;
        live = restoreAuthority(snapshot, log)!;
      } else {
        // 作り直さずに続けてよい事: 弾かれる前と 1 つも変わっていない
        expect(fingerprint(live, false), `reject left state changed at step ${step}: ${reason}`).toBe(before);
        rejectsChecked += 1;
      }
      continue;
    }
    live.takeCanonicalChipEffects();
    if (action.type === 'nextMatch') {
      const ledger = live.canonicalState().game.chipLedger;
      action._startChipLedger = { 0: ledger[0], 1: ledger[1], 2: ledger[2] };
      matches += 1;
    }
    log.push({
      commandId: `c${log.length + 1}`,
      revision: log.length + 1,
      actorSeat: candidate.actor,
      fromUserId: '',
      action,
      matchId: 0,
      roundId: 0,
      acceptedAt: '',
    } as AcceptedRoomCommand);
  }
  return { snapshot, live, log, matches, rejectsChecked, dirtyRebuilds };
}

describe('[2026-10-09 A5] 記録の読み直しを軽くしても状態は変わらない', () => {
  const scenarios: Array<{ seed: number; members: Member[]; label: string }> = [
    { seed: 20261009, label: 'HHH', members: [{ seat: 0, is_cpu: false }, { seat: 1, is_cpu: false }, { seat: 2, is_cpu: false }] },
    { seed: 4242, label: 'HCC', members: [{ seat: 0, is_cpu: false }, { seat: 1, is_cpu: true }, { seat: 2, is_cpu: true }] },
  ];

  for (const scenario of scenarios) {
    it(`${scenario.label}: 区切りから読んだ authority は頭から読んだ物と同じで、その先も一致し続ける`, () => {
      const { snapshot, live, log, matches, rejectsChecked } = runScenario(scenario.seed, scenario.members, 3);
      expect(matches).toBeGreaterThanOrEqual(3);
      expect(rejectsChecked).toBeGreaterThan(50);
      expect(lastReplayableMatchBoundary(log)).not.toBeNull();

      // 最後まで: 生きている authority ・ 頭から ・ 区切りから の 3 つが一致
      const t0 = performance.now();
      const full = restoreAuthority(snapshot, withoutBoundaries(log))!;
      const t1 = performance.now();
      const jumped = restoreAuthority(snapshot, log)!;
      const t2 = performance.now();
      const liveFp = fingerprint(live);
      expect(fingerprint(full)).toBe(liveFp);
      expect(fingerprint(jumped)).toBe(liveFp);
      console.info(`[A5 ${scenario.label}] commands=${log.length} matches=${matches} full=${(t1 - t0).toFixed(0)}ms jump=${(t2 - t1).toFixed(0)}ms`);

      // 途中の何か所かで切って、その先 40 手を両方に流しても一致し続ける
      const boundaries = log.map((command, index) => (command.action.type === 'nextMatch' ? index : -1)).filter((index) => index >= 0);
      const cuts = new Set<number>();
      for (const boundary of boundaries) {
        cuts.add(boundary + 1); // 区切りの直後
        cuts.add(Math.min(log.length, boundary + 37));
      }
      cuts.add(Math.floor(log.length * 0.9));
      for (const cut of cuts) {
        const prefix = log.slice(0, cut);
        const a = restoreAuthority(snapshot, withoutBoundaries(prefix))!;
        const b = restoreAuthority(snapshot, prefix)!;
        expect(fingerprint(b), `diverged right after restore at cut ${cut}`).toBe(fingerprint(a));
        for (const command of log.slice(cut, cut + 40)) {
          const ra = a.validateAndApply(command.actorSeat, structuredClone(command.action), scenario.members);
          const rb = b.validateAndApply(command.actorSeat, structuredClone(command.action), scenario.members);
          expect(rb, `apply result diverged at revision ${command.revision}`).toBe(ra);
          a.takeCanonicalChipEffects();
          b.takeCanonicalChipEffects();
        }
        expect(fingerprint(b), `diverged after continuing from cut ${cut}`).toBe(fingerprint(a));
      }
    }, 600_000);
  }

  it('_startChipLedger の無い古い区切りは頭から読む [この版より前の command]', () => {
    const commands = [
      { action: { type: 'nextMatch', preShuffledPool: ['m1'], _startChipLedger: { 0: 1, 1: -1, 2: 0 } } },
      { action: { type: 'discard', pai: 'm1' } },
      { action: { type: 'nextMatch', preShuffledPool: ['m1'] } },
    ] as unknown as AcceptedRoomCommand[];
    expect(lastReplayableMatchBoundary(commands)).toBeNull();
    expect(lastReplayableMatchBoundary(commands.slice(0, 2))).toBe(0);
    expect(lastReplayableMatchBoundary([])).toBeNull();
  });
});
