// [2026-09-02 yuma] projection → hydrate の property test。
//
// 8/9 の 6U1V [試合終了投影が hydrate 不能 → resync 無限往復] の一般化。
// seeded fuzz [codex R3 harness と同じ mulberry32、server driver + client 操作の混合] で
// 対局を進めながら、毎 step で server が配る seat projection [0/1/2/観戦 -1] を
// createGameStore().setOnlineSeat(seat).hydrateOnlineProjection() に通し、false が
// 一度でも出たら fail する。false = その client は resync ループで固まる [client 可視の停止]。
//
// 2 系統の client を模す:
//   - 追従 client: 席ごとに 1 つの store を作り、毎 step 同じ store へ hydrate [通常進行]
//   - 再接続 client: 数 step ごとに新品 store へ hydrate [reconnect / sync 直後]
// 通常 suite に入れる [8 seed × 300 step、目安 < 60s]。
import { describe, expect, it, vi } from 'vitest';

import { createRoomAuthority, type RoomAuthority } from '../../../server/authority';
import {
  captureSeatProjection,
  reactionTimeoutAction,
  turnTimeoutAction,
} from '../../../server/ws_server';
import { physicalDiscardCandidates } from '../game3/tileIdentity';
import { defaultSanmaRule, generateTilePool } from '../shan3';
import { createGameStore } from '../store';
import { get } from 'svelte/store';

const SEEDS = [0x00000001, 0x0000c0de, 0x00c0ffee, 0x12345678, 0x5eed5eed, 0x7fffffff, 0x80000000, 0xdeadbeef];
const STEPS = Number(process.env.HYDRATE_PROPERTY_STEPS || 300);
const FRESH_EVERY = 7;

type Member = { seat: number; is_cpu: boolean };
type Cand = { actor: number; action: any; tag: string };
const MEMBER_CONFIGS: Array<{ label: string; cpu: number[] }> = [
  { label: 'HHH', cpu: [] },
  { label: 'HCC', cpu: [1, 2] },
  { label: 'HHC', cpu: [2] },
  { label: 'CCC', cpu: [0, 1, 2] },
];

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

function shuffle<T>(random: () => number, values: readonly T[]): T[] {
  const out = [...values];
  for (let index = out.length - 1; index > 0; index -= 1) {
    const other = Math.floor(random() * (index + 1));
    [out[index], out[other]] = [out[other], out[index]];
  }
  return out;
}

function ownerOf(pending: any): number {
  return pending?.decisionOwners?.[pending?.decisionOwnerIndex ?? 0] ?? pending?.winner ?? 0;
}

/** server 代行 [ws_server computePostWinAutoAction 相当] */
function postWinDriver(state: any, random: () => number): Cand | null {
  if (state.pendingFuyu) return { actor: ownerOf(state.pendingFuyu), action: { type: 'selectFuyu', use: true }, tag: 'srv:selectFuyu' };
  if (state.pendingKinpei) {
    const pending = state.pendingKinpei;
    const hua: string[] = pending.availableHuapai ?? state.game.effectiveHuapaiAtHule(pending.winner);
    const target = hua.includes('f4') ? 'fuyu' : hua.includes('f3') ? 'aki' : hua.includes('f2') ? 'natsu' : hua.includes('f1') ? 'haru' : null;
    return { actor: ownerOf(pending), action: { type: 'selectKinpei', target }, tag: 'srv:selectKinpei' };
  }
  if (state.pendingKamiPochi) {
    const pending = state.pendingKamiPochi;
    return { actor: ownerOf(pending), action: { type: 'selectKamiPochi', target: pending.candidates?.[0], occurrenceKey: pending.occurrenceKey }, tag: 'srv:selectKamiPochi' };
  }
  if (state.pendingPochiSwap) {
    const pending = state.pendingPochiSwap;
    return { actor: ownerOf(pending), action: { type: 'selectPochiSwap', target: pending.candidates?.[0]?.target }, tag: 'srv:selectPochiSwap' };
  }
  if (state.pendingSaiKoro) {
    const pending = state.pendingSaiKoro;
    const chance = pending.chances?.[pending.currentIdx ?? 0];
    const actor = chance?.winner ?? pending.winner;
    if (!pending.selectedCombo) return { actor, action: { type: 'selectSaiKoroCombo', small: 1, large: 6 }, tag: 'srv:selectSaiKoroCombo' };
    if (!pending.finalized) {
      return { actor, action: { type: 'rollSaiKoroDice', override: [1 + Math.floor(random() * 6), 1 + Math.floor(random() * 6)] }, tag: 'srv:rollSaiKoroDice' };
    }
    return { actor, action: { type: 'advanceSaiKoro' }, tag: 'srv:advanceSaiKoro' };
  }
  if (state.pendingFeverContinue) return { actor: state.pendingFeverContinue.winner, action: { type: 'continueFever' }, tag: 'srv:continueFever' };
  return null;
}

function humanPostWin(state: any): Cand[] {
  const out: Cand[] = [];
  const owners = (pending: any): number[] => {
    const list = Array.isArray(pending?.decisionOwners) && pending.decisionOwners.length > 0 ? pending.decisionOwners : [pending?.winner];
    return list.filter((seat: unknown) => seat === 0 || seat === 1 || seat === 2);
  };
  if (state.pendingFuyu) for (const actor of owners(state.pendingFuyu)) for (const use of [true, false]) out.push({ actor, action: { type: 'selectFuyu', use }, tag: 'selectFuyu' });
  if (state.pendingKinpei) for (const actor of owners(state.pendingKinpei)) for (const target of [null, 'haru', 'natsu', 'aki', 'fuyu']) out.push({ actor, action: { type: 'selectKinpei', target }, tag: 'selectKinpei' });
  if (state.pendingKamiPochi) for (const actor of owners(state.pendingKamiPochi)) for (const target of state.pendingKamiPochi.candidates ?? []) out.push({ actor, action: { type: 'selectKamiPochi', target, occurrenceKey: state.pendingKamiPochi.occurrenceKey }, tag: 'selectKamiPochi' });
  if (state.pendingPochiSwap) for (const actor of owners(state.pendingPochiSwap)) for (const candidate of state.pendingPochiSwap.candidates ?? []) out.push({ actor, action: { type: 'selectPochiSwap', target: candidate?.target }, tag: 'selectPochiSwap' });
  return out;
}

function reactionCandidates(authority: RoomAuthority): Cand[] {
  const out: Cand[] = [];
  for (const player of authority.ronCandidates) {
    out.push({ actor: player, action: { type: 'ron', player }, tag: 'ron' });
    out.push({ actor: player, action: { type: 'pass', player }, tag: 'pass' });
  }
  for (const candidate of authority.ponCandidates) {
    for (const mianzi of candidate.mianzi) out.push({ actor: candidate.player, action: { type: 'pon', player: candidate.player, mianzi }, tag: 'pon' });
    out.push({ actor: candidate.player, action: { type: 'pass', player: candidate.player }, tag: 'pass' });
  }
  for (const candidate of authority.kanCandidates) {
    for (const mianzi of candidate.mianzi) out.push({ actor: candidate.player, action: { type: 'damingang', player: candidate.player, mianzi }, tag: 'damingang' });
    out.push({ actor: candidate.player, action: { type: 'pass', player: candidate.player }, tag: 'pass' });
  }
  return out;
}

function turnCandidates(authority: RoomAuthority, actor: number): Cand[] {
  const game = authority.game;
  const sp: any = game.shoupai.get(actor as 0 | 1 | 2);
  const out: Cand[] = [];
  out.push({ actor, action: { type: 'tsumo' }, tag: 'tsumo' });
  out.push({ actor, action: { type: 'tsumokiri' }, tag: 'tsumokiri' });
  out.push({ actor, action: { type: 'drawNext', player: actor }, tag: 'drawNext' });
  let core: string[] = [];
  try { core = (sp?.get_dapai?.(false) ?? []) as string[]; } catch { core = []; }
  const faces = new Set<string>(physicalDiscardCandidates(sp, core));
  for (const candidate of core) faces.add(String(candidate).replace(/[_*]$/, ''));
  faces.add('z4');
  for (const pai of faces) if (pai) out.push({ actor, action: { type: 'discard', pai }, tag: 'discard' });
  let kans: string[] = [];
  try { kans = game.getKanCandidates(actor as 0 | 1 | 2); } catch { kans = []; }
  for (const mianzi of kans) out.push({ actor, action: { type: 'declareKan', mianzi }, tag: 'declareKan' });
  out.push({ actor, action: { type: 'nukiBei', meta: { gold: false } }, tag: 'nukiBei' });
  out.push({ actor, action: { type: 'nukiBei', meta: { gold: true } }, tag: 'nukiBei' });
  let canLizhi = false;
  try { canLizhi = game.canLizhi(actor as 0 | 1 | 2); } catch { canLizhi = false; }
  if (canLizhi) {
    for (const open of [false, true]) for (const shuvari of [false, true]) for (const fever of [false, true]) {
      out.push({ actor, action: { type: 'lizhi', opts: { open, shuvari, fever } }, tag: 'lizhi' });
    }
  }
  for (const player of [0, 1, 2] as const) {
    let late = false;
    try { late = game.canDeclareLateShuvari(player); } catch { late = false; }
    if (late) out.push({ actor: player, action: { type: 'shuvari', player }, tag: 'shuvari' });
  }
  return out;
}

/** 1 step 進める。accept された command の tag を返す [誰も進めなければ null = stall] */
function progress(authority: RoomAuthority, members: Member[], random: () => number): string | null {
  const state: any = authority.canonicalState();
  const isCpu = (seat: number) => members.find((member) => member.seat === seat)?.is_cpu === true;
  const candidates: Cand[] = [];
  if (state.pendingFuyu || state.pendingKinpei || state.pendingKamiPochi || state.pendingPochiSwap || state.pendingSaiKoro || state.pendingFeverContinue) {
    const driver = postWinDriver(state, random);
    if (driver) candidates.push(driver);
    candidates.push(...shuffle(random, humanPostWin(state)));
  } else if (authority.awaitingRonDecision || authority.awaitingFulou || authority.pendingQianggang) {
    const seats = new Set<number>([...authority.ronCandidates, ...authority.ponCandidates.map((c) => c.player), ...authority.kanCandidates.map((c) => c.player)]);
    const drivers = [...seats].filter((seat) => !isCpu(seat)).map((seat) => ({ actor: seat, action: reactionTimeoutAction(authority, seat), tag: 'srv:reaction' }));
    candidates.push(...(random() < 0.4 ? [...drivers, ...shuffle(random, reactionCandidates(authority))] : [...shuffle(random, reactionCandidates(authority)), ...drivers]));
  } else if (state.roundEnded || authority.roundEnded) {
    if (state.game.state.finished) {
      candidates.push({ actor: 0, action: { type: 'nextMatch', preShuffledPool: shuffledPool(random), qijia: Math.floor(random() * 3), finalize: true, resetChip: false }, tag: 'nextMatch' });
    } else {
      const winner = state.lastWinner;
      if ((winner === 0 || winner === 1 || winner === 2) && random() < 0.5) {
        let can = false;
        try { can = state.game.canAgariyame(winner); } catch { can = false; }
        if (can) candidates.push({ actor: winner, action: { type: 'agariyame' }, tag: 'agariyame' });
      }
      candidates.push({ actor: Math.floor(random() * 3), action: { type: 'nextRound', preShuffledPool: shuffledPool(random) }, tag: 'nextRound' });
    }
  } else {
    const current = authority.currentPlayer();
    const driver = turnTimeoutAction(authority, isCpu(current));
    const drivers = driver ? [{ actor: current, action: driver, tag: 'srv:turn' }] : [];
    const human = shuffle(random, turnCandidates(authority, current));
    candidates.push(...(isCpu(current) || random() < 0.25 ? [...drivers, ...human] : [...human, ...drivers]));
  }
  for (const cand of candidates) {
    if (authority.validateAndApply(cand.actor, cand.action, members) === null) return cand.tag;
  }
  return null;
}

describe('projection → hydrate property [2026-09-02]', { timeout: 300_000 }, () => {
  for (const [seedIndex, seed] of SEEDS.entries()) {
    const seedHex = `0x${seed.toString(16).padStart(8, '0')}`;
    const config = MEMBER_CONFIGS[seedIndex % MEMBER_CONFIGS.length];
    it(`seed ${seedHex} members=${config.label}: every seat projection hydrates at every step`, () => {
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
      try {
        const random = rng(seed);
        const members: Member[] = [0, 1, 2].map((seat) => ({ seat, is_cpu: config.cpu.includes(seat) }));
        const authority = createRoomAuthority({
          preShuffledPool: shuffledPool(random),
          qijia: Math.floor(random() * 3),
          changshu: random() < 0.5 ? 1 : 2,
        });
        authority.validateAndApply(-1, { type: 'unknown' }, members);

        // 追従 client [席ごとに 1 store、毎 step 同じ store へ hydrate]
        const following = new Map<number, ReturnType<typeof createGameStore>>();
        for (const seat of [0, 1, 2, -1] as const) {
          const store = createGameStore();
          store.setOnlineSeat(seat);
          following.set(seat, store);
        }
        const failures: string[] = [];
        let lastTag: string | null = 'start';
        const stats: Record<string, number> = {};

        const check = (step: number) => {
          for (const seat of [0, 1, 2, -1] as const) {
            const projection: any = captureSeatProjection(authority, seat);
            if (seat !== -1 && !projection.privateHand) failures.push(`step=${step} seat=${seat}: privateHand null`);
            const store = following.get(seat)!;
            if (!store.hydrateOnlineProjection(projection)) {
              failures.push(`step=${step} seat=${seat} after=${lastTag}: following hydrate rejected`);
            }
            const hydrated: any = get(store);
            if (hydrated.game.state.lunban !== authority.game.state.lunban) failures.push(`step=${step} seat=${seat}: hydrated lunban mismatch`);
            if (!!hydrated.roundEnded !== !!authority.canonicalState().roundEnded) failures.push(`step=${step} seat=${seat}: hydrated roundEnded mismatch`);
            if (step % FRESH_EVERY === 0) {
              const fresh = createGameStore();
              fresh.setOnlineSeat(seat);
              if (!fresh.hydrateOnlineProjection(projection)) {
                failures.push(`step=${step} seat=${seat} after=${lastTag}: fresh [reconnect] hydrate rejected`);
              }
            }
          }
        };

        check(0);
        for (let step = 1; step <= STEPS; step += 1) {
          lastTag = progress(authority, members, random);
          if (lastTag === null) {
            failures.push(`step=${step}: no legal action accepted [stall]`);
            break;
          }
          stats[lastTag] = (stats[lastTag] ?? 0) + 1;
          check(step);
          if (failures.length > 20) break;
        }
        expect(failures, `seed=${seedHex} members=${config.label} stats=${JSON.stringify(stats)}`).toEqual([]);
      } finally {
        warn.mockRestore();
      }
    });
  }
});
