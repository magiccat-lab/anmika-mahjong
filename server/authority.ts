import { Game3 } from '../src/lib/game3';
import { createGameStore, type StoreState } from '../src/lib/store';
import { get } from 'svelte/store';
import { toCorePai } from '../src/lib/helpers';
import { resolveNukiBeiMeta } from '../src/lib/game3/bei';
import type { Pai, PlayerId } from '../src/lib/types';

export type AuthorityMember = {
  seat: number;
  is_cpu?: boolean;
};

type LastDapai = {
  player: PlayerId;
  pai: Pai;
};

type PendingQianggang = {
  player: PlayerId;
  mianzi: string;
  kakanPai: Pai;
};

export type RoomAuthorityInit = {
  preShuffledPool: string[];
  qijia: number;
};

const PLAYERS: PlayerId[] = [0, 1, 2];
const POST_WIN_ACTIONS = new Set([
  'selectFuyu',
  'selectKinpei',
  'selectSaiKoroCombo',
  'rollSaiKoroDice',
  'advanceSaiKoro',
  'continueFever',
  'agariyame',
]);

const LIVE_GAMEPLAY_ACTIONS = new Set([
  'discard',
  'tsumokiri',
  'drawNext',
  'tsumo',
  'ron',
  'pass',
  'pon',
  'damingang',
  'declareKan',
  'nukiBei',
  'lizhi',
]);

function asPlayerId(value: number): PlayerId | null {
  return value === 0 || value === 1 || value === 2 ? value : null;
}

function chooseWinnerByOya(game: Game3, winners: PlayerId[]): PlayerId {
  const oya = game.currentOya;
  return winners.includes(oya) ? oya : winners[winners.length - 1];
}

export class RoomAuthority {
  game: Game3;
  private readonly canonicalStore = createGameStore();
  lastZimo: Pai | null = null;
  lastDapai: LastDapai | null = null;
  awaitingRonDecision = false;
  awaitingFulou = false;
  ponCandidates: Array<{ player: PlayerId; mianzi: string[] }> = [];
  kanCandidates: Array<{ player: PlayerId; mianzi: string[] }> = [];
  ronCandidates: PlayerId[] = [];
  ronPassedPlayers: PlayerId[] = [];
  ronDeclaredPlayers: PlayerId[] = [];
  pendingQianggang: PendingQianggang | null = null;
  private pendingLizhiOpts: { open: boolean; shuvari: boolean; fever: boolean } | null = null;
  roundEnded = false;
  lastWinner: PlayerId | null = null;
  private cpuSeats = new Set<PlayerId>();
  private deferredCpuRon: PlayerId[] = [];
  /** commandId 導入前のWSA-A7暫定冪等窓。次局開始後、最初の非nextRound操作まで有効。 */
  private duplicateNextRoundAckOpen = false;

  constructor(init: RoomAuthorityInit) {
    this.game = new Game3({
      qijia: asPlayerId(init.qijia) ?? 0,
      preShuffledPool: init.preShuffledPool as Pai[],
    });
    this.startKyoku();
    this.canonicalStore.reset({
      preShuffledPool: init.preShuffledPool,
      qijia: asPlayerId(init.qijia) ?? 0,
    });
    this.canonicalStore.setOnlineReplayMode(true);
  }

  resetMatch(init: RoomAuthorityInit): void {
    this.game = new Game3({
      qijia: asPlayerId(init.qijia) ?? 0,
      preShuffledPool: init.preShuffledPool as Pai[],
    });
    this.startKyoku();
  }

  canonicalState(): StoreState {
    return get(this.canonicalStore);
  }

  isPostWinResolved(): boolean {
    const state = this.canonicalState();
    return state.roundEnded
      && !state.awaitingRonDecision
      && !state.awaitingFulou
      && !state.pendingFuyu
      && !state.pendingKinpei
      && !state.pendingFeverContinue
      && !state.pendingSaiKoro
      && !state.pendingQianggang;
  }

  currentPlayer(): PlayerId {
    return this.game.lunbanToPlayerId(this.game.state.lunban);
  }

  validateAndApply(actorSeat: number, action: any, _members: Iterable<AuthorityMember> = []): string | null {
    this.cpuSeats = new Set(
      Array.from(_members)
        .filter((member) => member.is_cpu)
        .map((member) => asPlayerId(member.seat))
        .filter((seat): seat is PlayerId => seat !== null),
    );
    this.canonicalStore.setCpuSeats([...this.cpuSeats]);
    const actor = asPlayerId(actorSeat);
    if (actor === null) return `invalid actor seat ${actorSeat}`;
    if (!action || typeof action !== 'object' || typeof action.type !== 'string') {
      return 'missing action.type';
    }
    if (action.type !== 'nextRound') this.duplicateNextRoundAckOpen = false;

    if (LIVE_GAMEPLAY_ACTIONS.has(action.type)) {
      const phaseError = this.requireCanonicalLivePhase(action.type);
      if (phaseError) return phaseError;
    }

    let reason: string | null;
    try {
      switch (action.type) {
        case 'discard':
          reason = this.applyDiscard(actor, String(action.pai ?? ''), action.meta); break;
        case 'tsumokiri':
          reason = this.applyTsumokiri(actor); break;
        case 'drawNext':
          reason = this.applyDrawNext(actor); break;
        case 'tsumo':
          reason = this.applyTsumo(actor); break;
        case 'ron':
          reason = this.applyRon(actor, action.player); break;
        case 'pass':
          reason = this.applyPass(actor); break;
        case 'pon':
          reason = this.applyPon(actor, action.player, action.mianzi, action); break;
        case 'damingang':
          reason = this.applyDamingang(actor, action.player, action.mianzi, action); break;
        case 'declareKan':
          reason = this.applyDeclareKan(actor, action.mianzi); break;
        case 'nukiBei':
          reason = this.applyNukiBei(actor, action.meta); break;
        case 'lizhi':
          reason = this.applyLizhi(actor, action.opts); break;
        case 'nextRound':
          reason = this.applyNextRound(action); break;
        case 'nextMatch':
          reason = this.applyNextMatch(action); break;
        default:
          reason = POST_WIN_ACTIONS.has(action.type)
            ? this.validatePostWinAction(actor, action.type)
            : `unknown action type ${action.type}`;
      }
    } catch (e: any) {
      return e?.message ? `authority exception: ${e.message}` : 'authority exception';
    }
    if (reason) return reason;
    try {
      this.applyCanonicalAction(actor, action);
      const canonical = this.canonicalState();
      // WSA: canonical store の reducer は副作用を伴う (continueFever→draw→discard 等)。
      // state/chipLedger だけでなく、検証に必要な全フィールドを同期する。
      this.syncFromCanonical(canonical);
      this.roundEnded = canonical.roundEnded;
      this.lastWinner = canonical.lastWinner as PlayerId | null;
      return null;
    } catch (e: any) {
      return e?.message ? `canonical reducer exception: ${e.message}` : 'canonical reducer exception';
    }
  }

  private applyCanonicalAction(actor: PlayerId, action: any): void {
    const store = this.canonicalStore as any;
    switch (action.type) {
      case 'stamp': break;
      case 'discard': store.discard(action.pai, action.meta); break;
      case 'lizhi': store.lizhi(action.opts ?? {}); break;
      case 'tsumo': store.tsumo(); break;
      case 'ron': store.ron(action.player ?? actor); break;
      case 'pass': store.pass(action.player ?? actor); break;
      case 'declareKan': store.declareKan(action.mianzi); break;
      case 'nukiBei': store.nukiBei(action.meta); break;
      case 'tsumokiri': store.tsumokiri(); break;
      case 'drawNext': store.drawNext(); break;
      case 'selectFuyu': store.selectFuyu(action.use); break;
      case 'selectKinpei': store.selectKinpei(action.target); break;
      case 'continueFever': store.continueFever(); break;
      case 'nextRound': store.nextRound(action.preShuffledPool); break;
      case 'nextMatch': store.nextMatch({
        finalize: action.finalize,
        resetChip: action.resetChip,
        preShuffledPool: action.preShuffledPool,
        qijia: action.qijia,
        cpuSeats: [...this.cpuSeats],
      }); break;
      case 'selectSaiKoroCombo': store.selectSaiKoroCombo(action.small, action.large); break;
      case 'rollSaiKoroDice': store.rollSaiKoroDice(action.override); break;
      case 'advanceSaiKoro': store.advanceSaiKoro(); break;
      case 'agariyame': store.agariyame(); break;
      case 'pon': store.pon(action.player ?? actor, action.mianzi); break;
      case 'damingang': store.damingang(action.player ?? actor, action.mianzi); break;
    }
  }

  private syncFromCanonical(canonical: StoreState): void {
    const cg = canonical.game;
    this.game.state = structuredClone(cg.state);
    this.game.chipLedger = structuredClone(cg.chipLedger);
    // 山・手牌・河は canonical reducer の副作用で変わりうる
    this.game.shan = cg.shan;
    for (const p of PLAYERS) {
      const sp = cg.shoupai.get(p);
      if (sp) this.game.shoupai.set(p, sp);
      const he = cg.he.get(p);
      if (he) this.game.he.set(p, he);
    }
    this.game.lizhi = new Set(cg.lizhi);
    this.game.openLizhi = new Set(cg.openLizhi);
    this.game.feverActive = { ...cg.feverActive };
    this.game.feverTier = { ...cg.feverTier };
    this.game.justNukidBei = { ...cg.justNukidBei };
    this.game.nukidora = { ...cg.nukidora };
    this.game.nukidoraGold = { ...cg.nukidoraGold };
    this.game.yifaActive = { ...cg.yifaActive };
    this.game.lingshangActive = { ...cg.lingshangActive };
    this.game.qianggangPending = cg.qianggangPending;
    this.game.lastZimoInfo = { ...cg.lastZimoInfo };
    this.lastZimo = canonical.lastZimo;
  }

  private startKyoku(): void {
    this.clearPending();
    this.roundEnded = false;
    this.lastWinner = null;
    this.game.qipai();
    this.lastZimo = this.game.zimo();
    if (this.lastZimo === null) this.roundEnded = true;
  }

  private clearPending(): void {
    this.lastDapai = null;
    this.awaitingRonDecision = false;
    this.awaitingFulou = false;
    this.ponCandidates = [];
    this.kanCandidates = [];
    this.ronCandidates = [];
    this.ronPassedPlayers = [];
    this.ronDeclaredPlayers = [];
    this.deferredCpuRon = [];
    this.pendingQianggang = null;
    this.pendingLizhiOpts = null;
    this.game.qianggangPending = false;
  }

  private hasReactionPending(): boolean {
    return this.awaitingRonDecision || this.awaitingFulou || this.pendingQianggang !== null;
  }

  private requireCurrent(actor: PlayerId, type: string): string | null {
    const current = this.currentPlayer();
    return actor === current ? null : `${type}: actor ${actor} is not current player ${current}`;
  }

  private requireNoReactionPending(type: string): string | null {
    return this.hasReactionPending() ? `${type}: reaction decision is pending` : null;
  }

  /**
   * The validation Game3 intentionally tracks the physical hand separately from
   * the canonical reducer. Post-win choices only exist in the canonical reducer,
   * so every live command must be stopped here until that choice is resolved.
   * Otherwise a delayed/malicious command can discard or draw through a modal and
   * leave all clients in a state that no legal action can recover from.
   */
  private requireCanonicalLivePhase(type: string): string | null {
    const state = this.canonicalState();
    if (state.pendingFuyu || state.pendingKinpei || state.pendingSaiKoro || state.pendingFeverContinue) {
      return `${type}: post-win decision is pending`;
    }
    if (state.roundEnded || state.pendingPingju) {
      return `${type}: round is ended`;
    }
    if (state.lizhiPending !== null && type !== 'discard') {
      return `${type}: riichi discard is pending`;
    }
    return null;
  }

  private applyDiscard(actor: PlayerId, paiValue: string, meta?: { gold?: boolean; pochi?: any }): string | null {
    const currentErr = this.requireCurrent(actor, 'discard');
    if (currentErr) return currentErr;
    const pendingErr = this.requireNoReactionPending('discard');
    if (pendingErr) return pendingErr;
    if (!paiValue) return 'discard: missing pai';

    const pai = paiValue as Pai;

    // Handle pending lizhi (2-stage): call declareLizhi at discard time with
    // feverCheck / feverDapai computed from the current hand, matching the
    // canonical store's processing order (store.ts lines 631-660).
    if (this.pendingLizhiOpts) {
      const lizhiOpts = this.pendingLizhiOpts;
      this.pendingLizhiOpts = null;
      if (lizhiOpts.fever) {
        const feverMap = this.game.feverCandidatesByDapai(actor);
        const feverCheck = feverMap.get(pai);
        if (!feverCheck) {
          return `discard: ${pai} does not satisfy fever condition`;
        }
        if (!this.game.declareLizhi({ open: lizhiOpts.open, shuvari: lizhiOpts.shuvari, fever: true, feverCheck, feverDapai: pai })) {
          return `lizhi: declare failed for player ${actor}`;
        }
      } else {
        // WSA: 通常リーチの宣言牌が正規候補内か検証 [聴牌を崩す牌で進行不能を防ぐ]
        const lizhiCandidates = this.game.getLizhiCandidates(actor);
        if (lizhiCandidates.length > 0 && !lizhiCandidates.includes(toCorePai(pai))) {
          return `discard: ${pai} is not a valid lizhi candidate`;
        }
        if (!this.game.declareLizhi({ open: lizhiOpts.open, shuvari: lizhiOpts.shuvari })) {
          return `lizhi: declare failed for player ${actor}`;
        }
      }
    }

    if (toCorePai(pai) === 'z4' && this.game.canNukiBei(actor)) {
      const replacement = this.game.declareNukiBei(actor, resolveNukiBeiMeta({
        requestedPai: pai,
        metaGold: meta?.gold,
        lastZimo: this.lastZimo,
        lastZimoGold: this.game.shan.lastZimoGold,
      }));
      this.lastZimo = replacement;
      if (replacement === null) this.roundEnded = true;
      return null;
    }

    try {
      this.game.dapai(pai, meta);
    } catch (e: any) {
      return `discard: ${e?.message ?? 'illegal pai'}`;
    }
    this.lastZimo = null;
    const committedPai = this.game.discardLog[actor]?.at(-1)?.pai ?? pai;
    this.lastDapai = { player: actor, pai: committedPai };
    this.rebuildDiscardReactions(actor, committedPai);
    return null;
  }

  private applyTsumokiri(actor: PlayerId): string | null {
    const pai = this.lastZimo ?? (this.game.shoupai.get(actor)?._zimo as Pai | null);
    if (!pai || typeof pai !== 'string') return 'tsumokiri: no last zimo';
    return this.applyDiscard(actor, pai);
  }

  private applyDrawNext(actor: PlayerId): string | null {
    const currentErr = this.requireCurrent(actor, 'drawNext');
    if (currentErr) return currentErr;
    const pendingErr = this.requireNoReactionPending('drawNext');
    if (pendingErr) return pendingErr;
    const z = this.game.zimo();
    this.lastZimo = z;
    if (z === null) this.roundEnded = true;
    return null;
  }

  private applyTsumo(actor: PlayerId): string | null {
    const currentErr = this.requireCurrent(actor, 'tsumo');
    if (currentErr) return currentErr;
    const pendingErr = this.requireNoReactionPending('tsumo');
    if (pendingErr) return pendingErr;
    if (!this.game.canTsumo(actor)) return `tsumo: player ${actor} cannot tsumo`;
    this.roundEnded = true;
    this.lastWinner = actor;
    return null;
  }

  private applyRon(actor: PlayerId, actionPlayer: unknown): string | null {
    if (typeof actionPlayer === 'number' && actionPlayer !== actor) {
      return `ron: action.player ${actionPlayer} != actor ${actor}`;
    }
    const source = this.pendingQianggang
      ? { player: this.pendingQianggang.player, pai: this.pendingQianggang.kakanPai }
      : this.lastDapai;
    if (!this.awaitingRonDecision || !source) return 'ron: no ron decision pending';
    if (actor === source.player) return 'ron: discarder cannot ron own pai';
    if (this.ronPassedPlayers.includes(actor)) return `ron: player ${actor} already passed`;
    if (this.ronDeclaredPlayers.includes(actor)) return `ron: player ${actor} already declared`;
    if (!this.ronCandidates.includes(actor)) return `ron: player ${actor} not in candidates`;
    if (!this.game.canRon(actor, source.pai, source.player)) {
      return `ron: player ${actor} cannot ron ${source.pai}`;
    }

    this.ronDeclaredPlayers.push(actor);
    this.roundEnded = true;
    this.lastWinner = chooseWinnerByOya(this.game, this.ronDeclaredPlayers);
    this.closeRonWindowIfSettled();
    return null;
  }

  private closeRonWindowIfSettled(): void {
    const remaining = this.ronCandidates.filter(
      (p) => !this.ronPassedPlayers.includes(p) && !this.ronDeclaredPlayers.includes(p),
    );
    if (remaining.length > 0) return;
    if (this.deferredCpuRon.length > 0) {
      for (const player of this.deferredCpuRon) {
        if (!this.ronDeclaredPlayers.includes(player)) this.ronDeclaredPlayers.push(player);
      }
      this.deferredCpuRon = [];
      this.roundEnded = true;
      this.lastWinner = chooseWinnerByOya(this.game, this.ronDeclaredPlayers);
    }
    this.awaitingRonDecision = false;
    this.ronCandidates = [];
    this.ronPassedPlayers = [];
    if (this.pendingQianggang) {
      this.pendingQianggang = null;
      this.game.qianggangPending = false;
    }
  }

  private applyPass(actor: PlayerId): string | null {
    let matched = false;
    if (this.awaitingRonDecision && this.ronCandidates.includes(actor)) {
      const source = this.pendingQianggang
        ? { player: this.pendingQianggang.player, pai: this.pendingQianggang.kakanPai }
        : this.lastDapai;
      if (source && this.game.shuvariActive[actor] && this.game.canRon(actor, source.pai, source.player)) {
        return `pass: player ${actor} is in shuvari and must declare ron`;
      }
      if (!this.ronPassedPlayers.includes(actor) && !this.ronDeclaredPlayers.includes(actor)) {
        this.ronPassedPlayers.push(actor);
      }
      matched = true;
      const remainingRon = this.ronCandidates.filter(
        (p) => !this.ronPassedPlayers.includes(p) && !this.ronDeclaredPlayers.includes(p),
      );
      if (remainingRon.length === 0) {
        this.awaitingRonDecision = false;
        if (this.deferredCpuRon.length > 0) {
          for (const player of this.deferredCpuRon) {
            if (!this.ronDeclaredPlayers.includes(player)) this.ronDeclaredPlayers.push(player);
          }
          this.lastWinner = chooseWinnerByOya(this.game, this.ronDeclaredPlayers);
          this.roundEnded = true;
          this.deferredCpuRon = [];
          this.ronCandidates = [];
          this.ronPassedPlayers = [];
          this.ponCandidates = [];
          this.kanCandidates = [];
          this.awaitingFulou = false;
          return null;
        }
        if (this.pendingQianggang) {
          const pending = this.pendingQianggang;
          this.pendingQianggang = null;
          this.ronCandidates = [];
          this.ronPassedPlayers = [];
          if (this.ronDeclaredPlayers.length === 0) {
            this.game.qianggangPending = false;
            const replacement = this.game.declareKan(pending.player, pending.mianzi);
            if (replacement === null) return `pass: deferred kan ${pending.mianzi} failed`;
            this.lastZimo = replacement;
            this.clearPending();
          } else {
            this.game.qianggangPending = false;
          }
        } else if (this.ronDeclaredPlayers.length === 0 && (this.ponCandidates.length > 0 || this.kanCandidates.length > 0)) {
          this.awaitingFulou = true;
        } else if (this.ronDeclaredPlayers.length === 0) {
          this.drawAfterReactions();
        }
      }
    }

    if (this.awaitingFulou) {
      const before = this.ponCandidates.length + this.kanCandidates.length;
      this.ponCandidates = this.ponCandidates.filter((c) => c.player !== actor);
      this.kanCandidates = this.kanCandidates.filter((c) => c.player !== actor);
      if (before !== this.ponCandidates.length + this.kanCandidates.length) matched = true;
      if (this.ponCandidates.length === 0 && this.kanCandidates.length === 0) {
        this.awaitingFulou = false;
        this.drawAfterReactions();
      }
    }

    return matched ? null : `pass: player ${actor} has no pending decision`;
  }

  private applyPon(actor: PlayerId, actionPlayer: unknown, mianziValue: unknown, action: any): string | null {
    if (typeof actionPlayer === 'number' && actionPlayer !== actor) {
      return `pon: action.player ${actionPlayer} != actor ${actor}`;
    }
    if (this.awaitingRonDecision) return 'pon: ron decision has priority';
    if (!this.lastDapai) return 'pon: no last dapai';
    const candidates = this.ponCandidates.find((c) => c.player === actor)?.mianzi ?? [];
    const mianzi = typeof mianziValue === 'string' ? mianziValue : candidates[0];
    if (!mianzi || !candidates.includes(mianzi)) return `pon: mianzi ${String(mianziValue)} not in candidates`;
    // WSA: 正規化した mianzi を action に書き戻し、canonical/relay で undefined にならないようにする
    action.mianzi = mianzi;
    if (!this.game.declarePon(actor, mianzi, this.lastDapai.player)) return `pon: declare ${mianzi} failed`;
    this.lastZimo = null;
    this.clearPending();
    return null;
  }

  private applyDamingang(actor: PlayerId, actionPlayer: unknown, mianziValue: unknown, action: any): string | null {
    if (typeof actionPlayer === 'number' && actionPlayer !== actor) {
      return `damingang: action.player ${actionPlayer} != actor ${actor}`;
    }
    if (this.awaitingRonDecision) return 'damingang: ron decision has priority';
    if (!this.lastDapai) return 'damingang: no last dapai';
    const candidates = this.kanCandidates.find((c) => c.player === actor)?.mianzi ?? [];
    const mianzi = typeof mianziValue === 'string' ? mianziValue : candidates[0];
    if (!mianzi || !candidates.includes(mianzi)) return `damingang: mianzi ${String(mianziValue)} not in candidates`;
    // WSA: 正規化した mianzi を action に書き戻す
    action.mianzi = mianzi;
    const replacement = this.game.declareDamingang(actor, mianzi, this.lastDapai.player);
    if (replacement === null) return `damingang: declare ${mianzi} failed`;
    this.lastZimo = replacement;
    this.clearPending();
    return null;
  }

  private applyDeclareKan(actor: PlayerId, mianziValue: unknown): string | null {
    const currentErr = this.requireCurrent(actor, 'declareKan');
    if (currentErr) return currentErr;
    const pendingErr = this.requireNoReactionPending('declareKan');
    if (pendingErr) return pendingErr;
    const candidates = this.game.getKanCandidates(actor);
    const mianzi = typeof mianziValue === 'string' ? mianziValue : candidates[0];
    if (!mianzi || !candidates.includes(mianzi)) return `declareKan: mianzi ${String(mianziValue)} not in candidates`;

    const isKakan = /[\+\=\-]\d$/.test(mianzi);
    if (isKakan) {
      const kakanPai = (mianzi[0] + mianzi[mianzi.length - 1]) as Pai;
      this.game.qianggangPending = true;
      const ronCandidates = PLAYERS.filter((p) => p !== actor && this.game.canRon(p, kakanPai, actor));
      if (ronCandidates.length > 0) {
        // WSA: CPU-only の槍槓候補は通常ロンと同様に即時確定 [human 反応待ちに残さない]
        const humanRon = ronCandidates.filter((p) => !this.cpuSeats.has(p));
        const cpuRon = ronCandidates.filter((p) => this.cpuSeats.has(p));
        if (humanRon.length === 0 && cpuRon.length > 0) {
          this.ronDeclaredPlayers = [...cpuRon];
          this.lastWinner = chooseWinnerByOya(this.game, cpuRon);
          this.roundEnded = true;
          this.game.qianggangPending = false;
          return null;
        }
        this.pendingQianggang = { player: actor, mianzi, kakanPai };
        this.awaitingRonDecision = true;
        this.ronCandidates = humanRon;
        this.deferredCpuRon = humanRon.length > 0 ? cpuRon : [];
        this.ronPassedPlayers = [];
        this.ronDeclaredPlayers = [];
        return null;
      }
      this.game.qianggangPending = false;
    }

    const replacement = this.game.declareKan(actor, mianzi);
    if (replacement === null) return `declareKan: declare ${mianzi} failed`;
    this.lastZimo = replacement;
    return null;
  }

  private applyNukiBei(actor: PlayerId, meta?: { gold?: boolean }): string | null {
    const currentErr = this.requireCurrent(actor, 'nukiBei');
    if (currentErr) return currentErr;
    const pendingErr = this.requireNoReactionPending('nukiBei');
    if (pendingErr) return pendingErr;
    if (!this.game.canNukiBei(actor)) return `nukiBei: player ${actor} cannot nuki`;
    const replacement = this.game.declareNukiBei(actor, meta);
    this.lastZimo = replacement;
    if (replacement === null) this.roundEnded = true;
    return null;
  }

  private applyLizhi(actor: PlayerId, optsValue: unknown): string | null {
    const currentErr = this.requireCurrent(actor, 'lizhi');
    if (currentErr) return currentErr;
    const pendingErr = this.requireNoReactionPending('lizhi');
    if (pendingErr) return pendingErr;
    if (!this.game.canLizhi(actor)) return `lizhi: player ${actor} cannot lizhi`;
    const opts = optsValue && typeof optsValue === 'object' ? optsValue as Record<string, unknown> : {};
    const open = opts.open === true;
    const shuvari = opts.shuvari === true;
    const fever = opts.fever === true;
    // Fever pre-validation: same as canonical store — allow if canFeverLizhi
    // is ok OR feverCandidatesByDapai has entries (conditional fever that
    // becomes valid only after specific discards).
    if (fever) {
      const fv = this.game.canFeverLizhi(actor);
      const feverByDapai = this.game.feverCandidatesByDapai(actor);
      if (!fv.ok && feverByDapai.size === 0) {
        return `lizhi: player ${actor} cannot declare fever`;
      }
    }
    // Defer declareLizhi to discard time (2-stage processing, same as
    // canonical store). This ensures feverCheck and feverDapai are computed
    // from the post-discard hand, not the pre-discard hand.
    this.pendingLizhiOpts = { open, shuvari, fever };
    return null;
  }

  private applyNextRound(action: any): string | null {
    if (this.hasReactionPending()) return 'nextRound: reaction decision is pending';
    if (!Array.isArray(action.preShuffledPool) || action.preShuffledPool.length === 0) {
      return 'nextRound: missing server preShuffledPool';
    }
    if (!this.roundEnded) {
      if (this.duplicateNextRoundAckOpen) return null;
      return 'nextRound: round is not ended';
    }
    if (!this.isPostWinResolved()) return 'nextRound: post-win decision is pending';
    const winner = this.lastWinner;
    this.game.nextRound({ winner, preShuffledPool: action.preShuffledPool as Pai[] });
    this.startKyoku();
    this.duplicateNextRoundAckOpen = true;
    return null;
  }

  private applyNextMatch(action: any): string | null {
    if (!Array.isArray(action.preShuffledPool) || action.preShuffledPool.length === 0) {
      return 'nextMatch: missing server preShuffledPool';
    }
    if (!this.canonicalState().game.state.finished) return 'nextMatch: match is not ended';
    this.resetMatch({
      qijia: typeof action.qijia === 'number' ? action.qijia : this.game.state.qijia,
      preShuffledPool: action.preShuffledPool,
    });
    return null;
  }

  private validatePostWinAction(actor: PlayerId, type: string): string | null {
    const state = this.canonicalState();
    if (type === 'rollSaiKoroDice' || type === 'selectSaiKoroCombo' || type === 'advanceSaiKoro') {
      const pending = state.pendingSaiKoro;
      if (!pending) return `${type}: no dice chance is pending`;
      const chance = pending.chances[pending.currentIdx] as any;
      const owner = chance?.winner ?? pending.winner;
      if (actor !== owner) return `${type}: actor ${actor} is not chance owner ${owner}`;
      if (type === 'selectSaiKoroCombo' && pending.selectedCombo) return `${type}: combo already selected`;
      if (type === 'rollSaiKoroDice' && (!pending.selectedCombo || pending.finalized)) {
        return `${type}: combo is not ready for a roll`;
      }
      if (type === 'advanceSaiKoro' && !pending.finalized) return `${type}: roll is not finalized`;
      return null;
    }
    const owner = type === 'selectFuyu' ? state.pendingFuyu?.winner
      : type === 'selectKinpei' ? state.pendingKinpei?.winner
      : type === 'continueFever' ? state.pendingFeverContinue?.winner
      : state.lastWinner;
    if (type === 'agariyame' && !state.roundEnded) return `${type}: round is not ended`;
    if (owner === undefined || owner === null) return `${type}: no matching decision is pending`;
    if (actor !== owner) return `${type}: actor ${actor} is not decision owner ${owner}`;
    if (type === 'agariyame') this.game.agariyame();
    return null;
  }

  private rebuildDiscardReactions(discarder: PlayerId, pai: Pai): void {
    const allRonCandidates = PLAYERS.filter((p) => p !== discarder && this.game.canRon(p, pai, discarder));
    const cpuRonCandidates = allRonCandidates.filter((p) => this.cpuSeats.has(p));
    const humanRonCandidates = allRonCandidates.filter((p) => !this.cpuSeats.has(p));
    this.ronCandidates = humanRonCandidates;
    this.ronPassedPlayers = [];
    this.ronDeclaredPlayers = [];
    this.deferredCpuRon = humanRonCandidates.length > 0 ? cpuRonCandidates : [];
    this.ponCandidates = [];
    this.kanCandidates = [];

    // Fever gate: during fever, only the fever-active player may call
    // pon/damingang (same as canonical store, store.ts lines 2473-2484).
    const someoneFever = PLAYERS.some((p) => this.game.feverActive[p]);
    for (const p of PLAYERS) {
      if (p === discarder) continue;
      if (someoneFever && !this.game.feverActive[p]) continue;
      const pon = this.game.getPonCandidates(p, discarder, pai);
      if (pon.length > 0) this.ponCandidates.push({ player: p, mianzi: pon });
      const kan = this.game.getDamingangCandidates(p, discarder, pai);
      if (kan.length > 0) this.kanCandidates.push({ player: p, mianzi: kan });
    }

    if (humanRonCandidates.length === 0 && cpuRonCandidates.length > 0) {
      this.ronDeclaredPlayers = [...cpuRonCandidates];
      this.lastWinner = chooseWinnerByOya(this.game, cpuRonCandidates);
      this.roundEnded = true;
      this.ronCandidates = [];
      this.ponCandidates = [];
      this.kanCandidates = [];
      this.awaitingRonDecision = false;
      this.awaitingFulou = false;
      return;
    }

    this.awaitingRonDecision = humanRonCandidates.length > 0;
    if (this.awaitingRonDecision) {
      this.ponCandidates = this.ponCandidates.filter((candidate) => !this.cpuSeats.has(candidate.player));
      this.kanCandidates = this.kanCandidates.filter((candidate) => !this.cpuSeats.has(candidate.player));
      return;
    }

    if (this.applyAutomaticCpuFulou(discarder, pai)) return;
    this.ponCandidates = this.ponCandidates.filter((candidate) => !this.cpuSeats.has(candidate.player));
    this.kanCandidates = this.kanCandidates.filter((candidate) => !this.cpuSeats.has(candidate.player));
    this.awaitingFulou = this.ponCandidates.length > 0 || this.kanCandidates.length > 0;
    if (!this.awaitingFulou) this.drawAfterReactions();
  }

  private applyAutomaticCpuFulou(discarder: PlayerId, pai: Pai): boolean {
    const core = toCorePai(pai);
    const isSanyuanpai = core[0] === 'z' && (core[1] === '5' || core[1] === '6' || core[1] === '7');
    const isFengpai = core[0] === 'z' && (core[1] === '1' || core[1] === '2' || core[1] === '3');
    const paiN = isFengpai ? Number(core[1]) : -1;
    const shouldCallHonor = (player: PlayerId): boolean => {
      if (isSanyuanpai) return true;
      return isFengpai && (paiN === this.game.changfengZ || paiN === this.game.zifengZ(player));
    };

    // Fever gate: non-fever CPU players must not call during fever.
    const someoneFever = PLAYERS.some((p) => this.game.feverActive[p]);

    for (const candidate of this.ponCandidates) {
      if (!this.cpuSeats.has(candidate.player) || candidate.mianzi.length === 0) continue;
      if (someoneFever && !this.game.feverActive[candidate.player]) continue;
      let shouldPon = shouldCallHonor(candidate.player);
      if (!isSanyuanpai && !isFengpai) {
        const isSeven = (core[0] === 'm' || core[0] === 'p' || core[0] === 's') && core[1] === '7';
        const fulouCount = this.game.shoupai.get(candidate.player)?._fulou?.length ?? 0;
        if (!isSeven && fulouCount >= 1) {
          try {
            const estimate = this.game.estimateXiangtingWithExtra(candidate.player, core);
            shouldPon = estimate.base <= 2 && estimate.withExtra < estimate.base;
          } catch { /* pass */ }
        }
      }
      if (shouldPon && this.game.declarePon(candidate.player, candidate.mianzi[0], discarder)) {
        this.lastZimo = null;
        this.clearPending();
        return true;
      }
    }

    for (const candidate of this.kanCandidates) {
      if (!this.cpuSeats.has(candidate.player) || candidate.mianzi.length === 0) continue;
      if (someoneFever && !this.game.feverActive[candidate.player]) continue;
      if (!shouldCallHonor(candidate.player)) continue;
      const replacement = this.game.declareDamingang(candidate.player, candidate.mianzi[0], discarder);
      if (replacement !== null) {
        this.lastZimo = replacement;
        this.clearPending();
        return true;
      }
    }
    return false;
  }

  private drawAfterReactions(): void {
    const committedDiscard = this.lastDapai;
    this.clearPending();
    const zimo = this.game.zimo();
    this.lastZimo = zimo;
    // reaction source としては無効だが、監査・snapshot表示用に直近打牌は保持する。
    this.lastDapai = committedDiscard;
    if (zimo === null) this.roundEnded = true;
  }
}

export function createRoomAuthority(init: RoomAuthorityInit): RoomAuthority {
  return new RoomAuthority(init);
}
