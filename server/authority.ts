import { Game3 } from '../src/lib/game3';
import { toCorePai } from '../src/lib/helpers';
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

function asPlayerId(value: number): PlayerId | null {
  return value === 0 || value === 1 || value === 2 ? value : null;
}

function chooseWinnerByOya(game: Game3, winners: PlayerId[]): PlayerId {
  const oya = game.currentOya;
  return winners.includes(oya) ? oya : winners[winners.length - 1];
}

export class RoomAuthority {
  game: Game3;
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
  roundEnded = false;
  lastWinner: PlayerId | null = null;

  constructor(init: RoomAuthorityInit) {
    this.game = new Game3({
      qijia: asPlayerId(init.qijia) ?? 0,
      preShuffledPool: init.preShuffledPool as Pai[],
    });
    this.startKyoku();
  }

  resetMatch(init: RoomAuthorityInit): void {
    this.game = new Game3({
      qijia: asPlayerId(init.qijia) ?? 0,
      preShuffledPool: init.preShuffledPool as Pai[],
    });
    this.startKyoku();
  }

  currentPlayer(): PlayerId {
    return this.game.lunbanToPlayerId(this.game.state.lunban);
  }

  validateAndApply(actorSeat: number, action: any, _members: Iterable<AuthorityMember> = []): string | null {
    const actor = asPlayerId(actorSeat);
    if (actor === null) return `invalid actor seat ${actorSeat}`;
    if (!action || typeof action !== 'object' || typeof action.type !== 'string') {
      return 'missing action.type';
    }

    try {
      switch (action.type) {
        case 'discard':
          return this.applyDiscard(actor, String(action.pai ?? ''), action.meta);
        case 'tsumokiri':
          return this.applyTsumokiri(actor);
        case 'drawNext':
          return this.applyDrawNext(actor);
        case 'tsumo':
          return this.applyTsumo(actor);
        case 'ron':
          return this.applyRon(actor, action.player);
        case 'pass':
          return this.applyPass(actor);
        case 'pon':
          return this.applyPon(actor, action.player, action.mianzi);
        case 'damingang':
          return this.applyDamingang(actor, action.player, action.mianzi);
        case 'declareKan':
          return this.applyDeclareKan(actor, action.mianzi);
        case 'nukiBei':
          return this.applyNukiBei(actor, action.meta);
        case 'lizhi':
          return this.applyLizhi(actor, action.opts);
        case 'nextRound':
          return this.applyNextRound(action);
        case 'nextMatch':
          return this.applyNextMatch(action);
        default:
          if (POST_WIN_ACTIONS.has(action.type)) return this.validatePostWinAction(actor, action.type);
          return `unknown action type ${action.type}`;
      }
    } catch (e: any) {
      return e?.message ? `authority exception: ${e.message}` : 'authority exception';
    }
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
    this.pendingQianggang = null;
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

  private applyDiscard(actor: PlayerId, paiValue: string, meta?: { gold?: boolean; pochi?: any }): string | null {
    const currentErr = this.requireCurrent(actor, 'discard');
    if (currentErr) return currentErr;
    const pendingErr = this.requireNoReactionPending('discard');
    if (pendingErr) return pendingErr;
    if (!paiValue) return 'discard: missing pai';

    const pai = paiValue as Pai;
    if (toCorePai(pai) === 'z4' && this.game.canNukiBei(actor)) {
      const replacement = this.game.declareNukiBei(actor, {
        gold: meta?.gold === true || pai === 'gN' || (this.game.shan.lastZimoGold && toCorePai(this.lastZimo ?? '') === 'z4'),
      });
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
    this.lastDapai = { player: actor, pai };
    this.rebuildDiscardReactions(actor, pai);
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
      if (!this.ronPassedPlayers.includes(actor) && !this.ronDeclaredPlayers.includes(actor)) {
        this.ronPassedPlayers.push(actor);
      }
      matched = true;
      const remainingRon = this.ronCandidates.filter(
        (p) => !this.ronPassedPlayers.includes(p) && !this.ronDeclaredPlayers.includes(p),
      );
      if (remainingRon.length === 0) {
        this.awaitingRonDecision = false;
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
      }
    }

    return matched ? null : `pass: player ${actor} has no pending decision`;
  }

  private applyPon(actor: PlayerId, actionPlayer: unknown, mianziValue: unknown): string | null {
    if (typeof actionPlayer === 'number' && actionPlayer !== actor) {
      return `pon: action.player ${actionPlayer} != actor ${actor}`;
    }
    if (this.awaitingRonDecision) return 'pon: ron decision has priority';
    if (!this.lastDapai) return 'pon: no last dapai';
    const candidates = this.ponCandidates.find((c) => c.player === actor)?.mianzi ?? [];
    const mianzi = typeof mianziValue === 'string' ? mianziValue : candidates[0];
    if (!mianzi || !candidates.includes(mianzi)) return `pon: mianzi ${String(mianziValue)} not in candidates`;
    if (!this.game.declarePon(actor, mianzi, this.lastDapai.player)) return `pon: declare ${mianzi} failed`;
    this.lastZimo = null;
    this.clearPending();
    return null;
  }

  private applyDamingang(actor: PlayerId, actionPlayer: unknown, mianziValue: unknown): string | null {
    if (typeof actionPlayer === 'number' && actionPlayer !== actor) {
      return `damingang: action.player ${actionPlayer} != actor ${actor}`;
    }
    if (this.awaitingRonDecision) return 'damingang: ron decision has priority';
    if (!this.lastDapai) return 'damingang: no last dapai';
    const candidates = this.kanCandidates.find((c) => c.player === actor)?.mianzi ?? [];
    const mianzi = typeof mianziValue === 'string' ? mianziValue : candidates[0];
    if (!mianzi || !candidates.includes(mianzi)) return `damingang: mianzi ${String(mianziValue)} not in candidates`;
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
        this.pendingQianggang = { player: actor, mianzi, kakanPai };
        this.awaitingRonDecision = true;
        this.ronCandidates = ronCandidates;
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
    const ok = this.game.declareLizhi({
      open: opts.open === true,
      shuvari: opts.shuvari === true,
      fever: opts.fever === true,
    });
    return ok ? null : `lizhi: declare failed for player ${actor}`;
  }

  private applyNextRound(action: any): string | null {
    if (this.hasReactionPending()) return 'nextRound: reaction decision is pending';
    if (!Array.isArray(action.preShuffledPool) || action.preShuffledPool.length === 0) {
      return 'nextRound: missing server preShuffledPool';
    }
    if (!this.roundEnded && action.from_role !== 'host') {
      return 'nextRound: round is not ended';
    }
    const winner = this.roundEnded ? this.lastWinner : null;
    this.game.nextRound({ winner, preShuffledPool: action.preShuffledPool as Pai[] });
    this.startKyoku();
    return null;
  }

  private applyNextMatch(action: any): string | null {
    if (!Array.isArray(action.preShuffledPool) || action.preShuffledPool.length === 0) {
      return 'nextMatch: missing server preShuffledPool';
    }
    this.resetMatch({
      qijia: typeof action.qijia === 'number' ? action.qijia : this.game.state.qijia,
      preShuffledPool: action.preShuffledPool,
    });
    return null;
  }

  private validatePostWinAction(actor: PlayerId, type: string): string | null {
    if (!this.roundEnded && type !== 'rollSaiKoroDice') return `${type}: no win is pending`;
    if (type === 'rollSaiKoroDice' || type === 'selectSaiKoroCombo' || type === 'advanceSaiKoro') {
      return null;
    }
    if (this.lastWinner !== null && actor !== this.lastWinner && type !== 'rollSaiKoroDice') {
      return `${type}: actor ${actor} is not last winner ${this.lastWinner}`;
    }
    if (type === 'agariyame') this.game.agariyame();
    return null;
  }

  private rebuildDiscardReactions(discarder: PlayerId, pai: Pai): void {
    this.ronCandidates = PLAYERS.filter((p) => p !== discarder && this.game.canRon(p, pai, discarder));
    this.ronPassedPlayers = [];
    this.ronDeclaredPlayers = [];
    this.ponCandidates = [];
    this.kanCandidates = [];

    for (const p of PLAYERS) {
      if (p === discarder) continue;
      const pon = this.game.getPonCandidates(p, discarder, pai);
      if (pon.length > 0) this.ponCandidates.push({ player: p, mianzi: pon });
      const kan = this.game.getDamingangCandidates(p, discarder, pai);
      if (kan.length > 0) this.kanCandidates.push({ player: p, mianzi: kan });
    }

    this.awaitingRonDecision = this.ronCandidates.length > 0;
    this.awaitingFulou = !this.awaitingRonDecision && (this.ponCandidates.length > 0 || this.kanCandidates.length > 0);
  }
}

export function createRoomAuthority(init: RoomAuthorityInit): RoomAuthority {
  return new RoomAuthority(init);
}
