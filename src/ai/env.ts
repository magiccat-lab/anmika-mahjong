
// AnmikaEnv v5: self-play RL 用 env、 reset / step 実装
// docs/ai_v0_plan.md 参照
//
// scope [v5]:
//  - reset で qipai → 自分視点 obs を返す
//  - step は active player の action を game に注入、 次の意思決定 phase まで進める
//  - 報酬 = 局終了時の点数差分 / 1000、 done = 半荘終了
//
// 制限 [v5、 後続で拡張]:
//  - 副露 [pon/kan] は env 自動 pass [意思決定対象から外す、 まずは打牌 loop 安定]
//  - リーチ宣言 = canLizhi 時のみ
//  - 抜き北 = z4 ツモ時のみ
//  - 他 player は pickBestDiscard ベース [既存 cpuStep 流用]
//  - phase 'fulou' / 'ron' は env 内部で skip [pass 自動]、 active player の意思決定 phase は 'self' のみ表面化

import { Game3 } from '../lib/game3';
import type { PlayerId } from '../lib/types';
import { encodeObs, OBS_DIM } from './encoder';
import {
  ACTION_SPACE_SIZE, ACT_DAPAI_BASE, ACT_PON_BASE, ACT_LIZHI_BASE,
  ACT_TSUMO, ACT_RON, ACT_PASS, ACT_NUKI_BEI,
  buildLegalMask,
} from './action';
import { TILE_KEYS } from './tiles';

export { OBS_DIM, ACTION_SPACE_SIZE };

export interface EnvObsInfo {
  round: number;
  lunban: number;
  phase: 'self' | 'fulou' | 'ron' | 'end';
}

export interface EnvObs {
  obs: Float32Array;
  legal_mask: boolean[];
  player: PlayerId;
  done: boolean;
  reward: number;
  info: EnvObsInfo;
}

export interface AnmikaEnvOpts {
  /** active player [obs 視点 + 意思決定 player]、 default 0 */
  activePlayer?: PlayerId;
  /** 半荘 max 局 [安全上限]、 default 16 */
  maxRounds?: number;
}

export class AnmikaEnv {
  private game!: Game3;
  private active: PlayerId;
  private maxRounds: number;
  private prevDefen = 0;
  private roundsPlayed = 0;

  constructor(opts: AnmikaEnvOpts = {}) {
    this.active = opts.activePlayer ?? 0;
    this.maxRounds = opts.maxRounds ?? 16;
  }

  reset(_seed?: number): EnvObs {
    this.game = new Game3();
    this.game.qipai();
    // 最初の zimo を引いておく [active player が現家じゃない場合は他家進行で進む]
    this.game.zimo();
    const def0 = (this.game.state.defen ?? {}) as Record<PlayerId, number>;
    this.prevDefen = def0[this.active] ?? 0;
    this.roundsPlayed = 0;
    try {
      const xt = (this.game as any).xiangting?.(this.active);
      this.prevXiangting = (typeof xt === 'number') ? xt : 8;
    } catch (e) { this.prevXiangting = 8; }
    this.advanceToActiveSelfPhase();
    return this.observe(0);
  }

  step(action: number): EnvObs {
    if (!this.game) throw new Error('env not reset');
    if (action < 0 || action >= ACTION_SPACE_SIZE) {
      return this.observe(0);  // illegal、 noop
    }
    // 現在の active player の self phase で action を解釈
    if (action >= ACT_DAPAI_BASE && action < ACT_PON_BASE) {
      // 打牌 [tile index]、 game3.dapai(pai) は player 引数取らず lunban 経由で current player 解釈
      const idx = action - ACT_DAPAI_BASE;
      const key = TILE_KEYS[idx];
      if (key) {
        try { (this.game as any).dapai?.(key); } catch (e) {}
      }
    } else if (action === ACT_LIZHI_BASE) {
      try {
        const ok = (this.game as any).declareLizhi?.({});
        if (ok) this.lizhiBonusPending = 1.0;  // v9: リーチ宣言で +1.0 reward
      } catch (e) {}
    } else if (action === ACT_TSUMO) {
      try {
        const r = (this.game as any).hule?.(this.active);
        if (r) (this.game as any).applyHule?.(r, this.active, null);
      } catch (e) {}
    } else if (action === ACT_RON) {
      try {
        // ron は他家の dapai が relevant だが、 v5 は lastDapai source 自動推定にする
        const r = (this.game as any).hule?.(this.active);
        if (r) (this.game as any).applyHule?.(r, this.active, null);
      } catch (e) {}
    } else if (action === ACT_NUKI_BEI) {
      try { (this.game as any).declareNukiBei?.(this.active); } catch (e) {}
    } else if (action === ACT_PASS) {
      // noop
    }

    // 局 / 半荘 終了 check
    const finished = (this.game as any).state?.finished;
    if (finished) {
      const reward = this.computeReward();
      return this.observe(reward, true);
    }

    // 局終了したら nextRound
    if ((this.game as any).roundEnded) {
      try { (this.game as any).nextRound?.(); } catch (e) {}
      this.roundsPlayed += 1;
      if (this.roundsPlayed >= this.maxRounds) {
        const reward = this.computeReward();
        return this.observe(reward, true);
      }
      try { this.game.zimo(); } catch (e) {}
    }

    // 他 player を進めて active player の self phase まで
    this.advanceToActiveSelfPhase();
    const reward = this.computeReward();
    return this.observe(reward, false);
  }

  private advanceToActiveSelfPhase(): void {
    // 簡略 v5: 安全上限 200 step
    for (let i = 0; i < 200; i++) {
      const finished = (this.game as any).state?.finished;
      if (finished) return;
      if ((this.game as any).roundEnded) {
        try { (this.game as any).nextRound?.(); } catch (e) {}
        this.roundsPlayed += 1;
        if (this.roundsPlayed >= this.maxRounds) return;
        try { this.game.zimo(); } catch (e) {}
        continue;
      }
      const cur = this.game.state.lunban;
      const curPlayer = (this.game as any).lunbanToPlayerId?.(cur) ?? cur;
      if (curPlayer === this.active && !(this.game as any).awaitingFulou) {
        // active player の zimo 確保 [打牌 action 受付前提]
        const sspA = this.game.shoupai.get(this.active);
        const hasZimoA = sspA && (sspA as any)._zimo != null;
        if (!hasZimoA) {
          try {
            const z = this.game.zimo();
            if (!z) {
              (this.game as any).pendingPingju = true;
              (this.game as any).roundEnded = true;
              continue;
            }
          } catch (e) { return; }
        }
        return;
      }
      // 他家: zimo 必要なら zimo してから pickBestDiscard で discard
      const ssp = this.game.shoupai.get(curPlayer);
      const hasZimo = ssp && (ssp as any)._zimo != null;
      if (!hasZimo) {
        try {
          const z = this.game.zimo();
          if (!z) {
            // 山切れ → 流局
            (this.game as any).pendingPingju = true;
            (this.game as any).roundEnded = true;
            continue;
          }
        } catch (e) { break; }
      }
      try {
        const pick = (this.game as any).pickBestDiscard?.(curPlayer);
        if (pick) {
          (this.game as any).dapai?.(pick);
        } else {
          // 候補ナシ → ツモ切り fallback
          const sspNow = this.game.shoupai.get(curPlayer);
          const z = (sspNow as any)?._zimo;
          if (z && typeof z === 'string' && z.length <= 3) {
            (this.game as any).dapai?.(z);
          } else {
            break;
          }
        }
      } catch (e) { break; }
    }
  }

  private prevXiangting = 8;
  private lizhiBonusPending = 0;
  private computeReward(): number {
    const def = (this.game.state.defen ?? {}) as Record<PlayerId, number>;
    const cur = def[this.active] ?? 0;
    const delta = (cur - this.prevDefen) / 1000;
    this.prevDefen = cur;
    // v11 reward 再設計: tenpai 維持 reward 削除 [v8/v10 で reward hacking 確認]
    // - シャンテン低下 +0.05/step [valid progress]
    // - tenpai 初到達 +0.5 [一回限り]、 維持 reward なし
    // - リーチ宣言 +1.0 [一回限り]
    // - hule 確定は computeReward の defen delta で +N [自然]
    // - 局終了時 -0.3 [流局回避 incentive]
    let shapingR = 0;
    try {
      const xt = (this.game as any).xiangting?.(this.active);
      if (typeof xt === 'number') {
        if (xt < this.prevXiangting) {
          shapingR += 0.05 * (this.prevXiangting - xt);
          if (xt === 0 && this.prevXiangting > 0) shapingR += 0.5;
        }
        // v11: tenpai 維持 reward 削除 [+0.02/step は exploit される]
        this.prevXiangting = xt;
      }
    } catch (e) { /* noop */ }
    const lizhiR = this.lizhiBonusPending;
    this.lizhiBonusPending = 0;
    // v12: 局終了 pen 緩和 -0.1、 但し defen delta が +0 [流局] なら -0.5、 hule 成立 [delta>0] で大 bonus +2
    let endR = 0;
    if ((this.game as any).roundEnded) {
      if (delta > 0.5) endR += 2.0;       // hule 成立 (1000+点獲得) で大 bonus
      else if (delta < -0.5) endR -= 1.0; // 放銃で pen
      else endR -= 0.5;                    // 流局 [delta ≈ 0] は pen
    }
    return Math.max(-10, Math.min(10, delta + shapingR + lizhiR + endR));
  }

  private observe(reward: number, done = false): EnvObs {
    const obs = encodeObs(this.game, this.active);
    const cur = this.game.state.lunban;
    const curPlayer = (this.game as any).lunbanToPlayerId?.(cur) ?? cur;
    // R24 P2 #7 fix: phase を game state から動的判定、 旧 code は常に 'self' で
    // fulou / ron 経路 が死んでた [副露 / ロン候補 が legal_mask に乗らない]
    // 判定: awaitingFulou=true → fulou、 lastDapai 直後で他家の active が決定権 → ron、 自分手番 → self
    let phase: EnvObsInfo['phase'];
    if (done) {
      phase = 'end';
    } else if ((this.game as any).awaitingFulou) {
      phase = 'fulou';
    } else if ((this.game as any).awaitingRonDecision && curPlayer !== this.active) {
      phase = 'ron';
    } else {
      phase = 'self';
    }
    const lastDapai = (this.game as any).lastDapai ?? null;
    const legal_mask = done
      ? new Array(ACTION_SPACE_SIZE).fill(false)
      : buildLegalMask(this.game, {
          player: this.active,
          decisionPlayer: this.active,
          // done=false なので phase は 'end' にならない、 ActionContext の union に narrow
          phase: phase as 'self' | 'fulou' | 'ron',
          lastDapai,
        });
    // 安全弁: 全部 false なら pass [94] を必ず legal にする [模型側 mask all-False 回避]
    if (!done && !legal_mask.some((b) => b)) {
      legal_mask[ACT_PASS] = true;
    }
    return {
      obs,
      legal_mask,
      player: this.active,
      done: !!done,
      reward,
      info: {
        round: this.game.state.changbang ?? 0,
        lunban: this.game.state.lunban,
        phase,
      },
    };
  }
}
