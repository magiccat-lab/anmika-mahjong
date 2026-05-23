// env_server.ts から使う AnmikaEnv ヘルパー
// Game3 / Shan3 を直接呼んで、 1 player [P0] を学習者にする gym-style wrapper
//
// 実装段階: v0 scaffold
//   - reset: 新半荘 init、 学習者番まで進める
//   - step: 学習者 1 action → 局終了 or 学習者次番まで進める
//   - observe: 手牌 multihot + meta scalars
//
// 注意: TS から直接 anmika-mahjong/src/lib/game3.ts を import するため
//   tsconfig で paths 設定要、 v0 では fetchable な機能だけ stub
//
// TODO [起動後に詰める]:
//   - actual Game3 init [import path resolve]
//   - CPU policy 強化 [現状 random]
//   - observation 詳細化 [現状 hand + defen のみ]

import { Game3 } from '../src/lib/game3.js';
import type { PlayerId } from '../src/lib/game3/chip.js';

const LEARNER: PlayerId = 0;

export interface StepResult {
  obs: number[];
  legalActions: number[];
  reward: number;
  done: boolean;
  info?: any;
}

export class AnmikaEnv {
  game: Game3;
  turn: number = 0;
  done: boolean = false;

  constructor() {
    this.game = new Game3({ qijia: 0 });
    this.game.qipai();
  }

  /** 半荘終了したか */
  isGameOver(): boolean {
    return this.game.state.finished === true;
  }

  /** events 内で 既に処理済の hule index を tracking、 同一 hule を二度回さないため */
  lastProcessedHuleIdx: number = -1;

  /** 局終了状態 [hule または paishu=0 流局] なら nextRound で次局開始 */
  maybeAdvanceRound(): boolean {
    if (this.game.state.finished) return false;
    // 未処理の hule event 検出
    let newHuleIdx = -1;
    let newHulePlayer: PlayerId | null = null;
    const events = this.game.events;
    for (let i = events.length - 1; i > this.lastProcessedHuleIdx; i--) {
      if ((events[i] as any).type === 'hule') {
        newHuleIdx = i;
        newHulePlayer = (events[i] as any).player;
        break;
      }
    }
    if (newHuleIdx >= 0 && newHulePlayer !== null) {
      this.game.nextRound({ winner: newHulePlayer });
      this.game.qipai();
      this.lastProcessedHuleIdx = this.game.events.length - 1;
      return true;
    }
    if (this.game.shan.paishu === 0) {
      this.game.nextRound();
      this.game.qipai();
      this.lastProcessedHuleIdx = this.game.events.length - 1;
      return true;
    }
    return false;
  }

  /** CPU 番なら 1 ターンずつ進めて学習者番に到達するまで loop */
  advanceUntilLearnerTurn(): void {
    let safety = 0;
    let lastLunban = -1;
    let stuckCount = 0;
    const startMs = Date.now();
    while (safety++ < 1500) {
      // wall-clock 3 秒で abort [stuck 対策]
      if (Date.now() - startMs > 3000) {
        this.done = true;
        return;
      }
      if (this.game.state.finished) { this.done = true; return; }
      if (this.maybeAdvanceRound()) { lastLunban = -1; stuckCount = 0; continue; }
      const lun = this.game.state.lunban;
      if (lun === lastLunban) {
        stuckCount++;
        if (stuckCount > 5) {
          // 進まない: nextRound 直 call で次局
          try {
            this.game.nextRound();
            this.game.qipai();
            this.lastProcessedHuleIdx = this.game.events.length - 1;
          } catch (e) {
            this.done = true;
            return;
          }
          lastLunban = -1;
          stuckCount = 0;
          continue;
        }
      } else {
        lastLunban = lun;
        stuckCount = 0;
      }
      const cur = this.game.lunbanToPlayerId(lun) as PlayerId;
      if (cur === LEARNER) {
        const sp = this.game.shoupai.get(LEARNER);
        if (sp?._zimo == null) {
          const z = this.game.zimo();
          if (z == null) {
            if (this.maybeAdvanceRound()) continue;
            this.done = true;
            return;
          }
        }
        return;
      }
      this.cpuStep(cur);
    }
    // safety cap: done で抜ける
    this.done = true;
  }

  cpuStep(p: PlayerId): void {
    let sp = this.game.shoupai.get(p);
    if (sp?._zimo == null) {
      const z = this.game.zimo();
      if (z == null) { return; }
      sp = this.game.shoupai.get(p);
    }
    // canTsumo なら即 hule [半荘 finish 判定は applyHule 内に任せる]
    try {
      const res = this.game.hule(p);
      if (res != null && (res.fanshu ?? 0) > 0) {
        this.game.applyHule(res, p, null);
        return;
      }
    } catch (e) {}
    // tenpai 入ったら 80% 確率で立直 [シュバ判定は spec、 普通の立直で十分]
    try {
      if (!this.game.lizhi.has(p) && (this.game as any).canLizhi?.(p) && Math.random() < 0.8) {
        (this.game as any).declareLizhi?.({});
      }
    } catch (e) {}
    // 北抜き [z4 ツモ済なら抜く]
    if (sp?._zimo === 'z4') {
      try {
        const r = this.game.declareNukiBei(p);
        if (r == null) { this.done = true; return; }
      } catch (e) {}
      return; // 抜いた後は再 zimo 済、 次 ターン
    }
    // smart discard: Game3.pickBestDiscard で シャンテン最小化、 fallback ツモ切り
    let pick: string | null = null;
    try {
      pick = (this.game as any).pickBestDiscard?.(p) ?? null;
    } catch (e) {}
    if (pick == null) {
      const cand = sp?.get_dapai?.(false) ?? [];
      const filtered = cand.filter((c: string) => c !== 'z4');
      const candidates = filtered.length > 0 ? filtered : (sp?._zimo ? [sp._zimo] : []);
      if (candidates.length === 0) { return; }
      pick = candidates[Math.floor(Math.random() * candidates.length)];
    }
    if (pick == null) return;
    try {
      this.game.dapai(pick, {});
      // ロン check: 他家 candidate を 50% 確率で取る [自動]
      for (const op of [0, 1, 2] as PlayerId[]) {
        if (op === p) continue;
        try {
          if (this.game.canRon(op, pick, p) && Math.random() < 0.5) {
            const res = this.game.hule(op, pick, p);
            if (res != null && (res.fanshu ?? 0) > 0) {
              this.game.applyHule(res, op, p);
              return;
            }
          }
        } catch (e) {}
      }
    } catch (e) {
      // dapai 失敗 [禁じ手 / 副露 wait 等] → silent skip、 env 継続
    }
  }

  step(action: number): StepResult {
    if (this.done) return { obs: this.observe().obs, legalActions: [], reward: 0, done: true };
    const sp = this.game.shoupai.get(LEARNER);
    if (sp == null) { this.done = true; return { obs: this.observe().obs, legalActions: [], reward: 0, done: true }; }
    // action 0-13: 手牌位置を切る、 14: 北抜き、 15: ツモ宣言、 16-17: pass / ロン
    const handTiles: string[] = [];
    for (const s of ['m','p','s','z']) {
      const arr = sp._bingpai?.[s] ?? [];
      for (let n = 0; n < arr.length; n++) {
        for (let k = 0; k < (arr[n] ?? 0); k++) {
          handTiles.push(`${s}${n}`);
        }
      }
    }
    if (sp._zimo) handTiles.push(sp._zimo);
    const target = handTiles[Math.min(action, handTiles.length - 1)];
    const tryDapai = (pai: string | null): boolean => {
      if (pai == null) return false;
      try { this.game.dapai(pai, {}); return true; } catch (e) { return false; }
    };
    if (!tryDapai(target) && !tryDapai(sp._zimo as string)) {
      // 全 fallback 失敗 → 局を強制 next round で抜ける
      this.maybeAdvanceRound();
    }
    // 学習者番までまた CPU 進める
    this.advanceUntilLearnerTurn();
    const stepR = this.stepReward();
    const reward = this.done ? this.computeFinalReward() + stepR : stepR;
    const ob = this.observe();
    return { obs: ob.obs, legalActions: ob.legalActions, reward, done: this.done };
  }

  /** 学習信号: defen の前回からの delta [単位 10000 点でクリップ ±5]
   *  hule で 32000 点動いても reward は ±3.2 まで、 学習安定優先 */
  lastLearnerDefen: number = 35000;
  lastLearnerChip: number = 0;
  lastTingpaiSize: number = 0;
  stepReward(): number {
    const def = this.game.state.defen[LEARNER] ?? 35000;
    const chip = this.game.chipLedger[LEARNER] ?? 0;
    const dDef = (def - this.lastLearnerDefen) / 10000;
    const dChip = (chip - this.lastLearnerChip) * 0.5;
    this.lastLearnerDefen = def;
    this.lastLearnerChip = chip;
    let tingSize = 0;
    try {
      const ting = (this.game as any).getTingpaiList?.(LEARNER) ?? [];
      tingSize = Array.isArray(ting) ? ting.length : 0;
    } catch (e) {}
    const dTing = (tingSize - this.lastTingpaiSize) * 0.05;
    this.lastTingpaiSize = tingSize;
    const raw = dDef + dChip + dTing;
    // クリップ ±5
    return Math.max(-5, Math.min(5, raw));
  }
  computeFinalReward(): number {
    // 半荘 fully 終了したら uma + chip 込み total を / 30 でスケール [±2 程度]
    try {
      const fs = this.game.getFinalScore();
      const learner = fs.find(r => r.player === LEARNER);
      const raw = (learner?.total ?? 0) / 30;
      return Math.max(-5, Math.min(5, raw));
    } catch (e) {
      const def = this.game.state.defen[LEARNER] ?? 35000;
      return Math.max(-5, Math.min(5, (def - 35000) / 10000));
    }
  }

  /** expert action: pickBestDiscard が返す牌を 手牌 index に変換
   *  返り値: { obs, legalActions, action }
   *  action は obs と同じ handTiles 順 の index 0..13
   *  done のとき / 学習者番でないときは action=0 fallback */
  expertAction(): { obs: number[]; legalActions: number[]; action: number } {
    const ob = this.observe();
    if (this.done) return { obs: ob.obs, legalActions: ob.legalActions, action: 0 };
    const sp = this.game.shoupai.get(LEARNER);
    if (sp == null) return { obs: ob.obs, legalActions: ob.legalActions, action: 0 };
    // handTiles を step() と同じ順序で再構築
    const handTiles: string[] = [];
    for (const s of ['m','p','s','z']) {
      const arr = (sp as any)._bingpai?.[s] ?? [];
      for (let n = 0; n < arr.length; n++) {
        for (let k = 0; k < (arr[n] ?? 0); k++) {
          handTiles.push(`${s}${n}`);
        }
      }
    }
    if ((sp as any)._zimo) handTiles.push((sp as any)._zimo);
    // pickBestDiscard で expert pai 取得
    let pick: string | null = null;
    try {
      pick = (this.game as any).pickBestDiscard?.(LEARNER) ?? null;
    } catch (e) {}
    if (pick == null) {
      // fallback: legalActions の先頭
      const a = ob.legalActions.length > 0 ? ob.legalActions[0] : 0;
      return { obs: ob.obs, legalActions: ob.legalActions, action: a };
    }
    // pick の suffix [+=-_*] と 赤 0 → 5 を base 化、 同様に handTiles 側も base 比較
    const baseOf = (p: string): string => {
      const stripped = p.replace(/[\+\=\-_*]/g, '');
      const s = stripped[0];
      const n = stripped[1] === '0' ? '5' : stripped[1];
      return s + n;
    };
    const pickBase = baseOf(pick);
    // 手牌内で match する最初の index を返す [赤 / 同種優先せず単純一致]
    let idx = -1;
    for (let i = 0; i < handTiles.length; i++) {
      if (baseOf(handTiles[i]) === pickBase) { idx = i; break; }
    }
    if (idx < 0) {
      // 一致 ナシ → legalActions 先頭 fallback
      idx = ob.legalActions.length > 0 ? ob.legalActions[0] : 0;
    }
    // 上限 13 でクリップ [action space 0-13]
    if (idx > 13) idx = 13;
    return { obs: ob.obs, legalActions: ob.legalActions, action: idx };
  }

  /** tile multihot 37 dim 用 index:
   *  m1..m9=0..8, p0..p9=9..18, s0..s9=19..28, z1..z7=29..35, それ以外=36 */
  private static tileIdx(suit: string, n: number): number {
    if (suit === 'm') return Math.max(0, Math.min(8, n - 1));
    if (suit === 'p') return 9 + Math.max(0, Math.min(9, n));
    if (suit === 's') return 19 + Math.max(0, Math.min(9, n));
    if (suit === 'z') return 29 + Math.max(0, Math.min(6, n - 1));
    return 36;
  }

  /** tile 文字列 'm5' / 'p0' / 'z5' を 37 dim index に */
  private static paiToIdx(pai: string): number {
    if (!pai || pai.length < 2) return -1;
    const s = pai[0];
    if (s !== 'm' && s !== 'p' && s !== 's' && s !== 'z') return -1;
    const n = parseInt(pai[1], 10);
    if (isNaN(n)) return -1;
    return AnmikaEnv.tileIdx(s, n);
  }

  /** _fulou を multihot 37 へ */
  private fulouMultihot(p: PlayerId): number[] {
    const out = new Array<number>(37).fill(0);
    const sp = this.game.shoupai.get(p);
    if (!sp || !(sp as any)._fulou) return out;
    for (const m of (sp as any)._fulou as string[]) {
      const stripped = String(m).replace(/[\+\=\-_*]/g, '');
      const suit = stripped[0];
      const digits = stripped.slice(1);
      for (const d of digits) {
        const n = parseInt(d, 10);
        if (isNaN(n)) continue;
        const idx = AnmikaEnv.tileIdx(suit, n === 0 ? 5 : n);
        if (idx >= 0 && idx < 37) out[idx]++;
      }
    }
    return out;
  }

  /** he._pai を multihot 37 へ */
  private heMultihot(p: PlayerId): number[] {
    const out = new Array<number>(37).fill(0);
    const he = this.game.he.get(p);
    if (!he || !he._pai) return out;
    for (const raw of he._pai as string[]) {
      const cleaned = String(raw).replace(/[\+\=\-_*]/g, '');
      const idx = AnmikaEnv.paiToIdx(cleaned);
      if (idx >= 0) out[idx]++;
    }
    return out;
  }

  /** 副露牌合計枚数 */
  private fulouTileCount(p: PlayerId): number {
    const sp = this.game.shoupai.get(p);
    if (!sp || !(sp as any)._fulou) return 0;
    let c = 0;
    for (const m of (sp as any)._fulou as string[]) {
      const stripped = String(m).replace(/[\+\=\-_*]/g, '');
      c += stripped.slice(1).length;
    }
    return c;
  }

  observe(): { obs: number[]; legalActions: number[] } {
    const obs: number[] = [];
    const sp = this.game.shoupai.get(LEARNER);

    // [1] 学習者 手牌 multihot 37 dim (m1..m9, p0..p9, s0..s9, z1..z7)
    const handVec = new Array<number>(37).fill(0);
    if (sp?._bingpai) {
      const mbp = (sp as any)._bingpai.m ?? [];
      for (let n = 1; n <= 9; n++) handVec[AnmikaEnv.tileIdx('m', n)] += mbp[n] ?? 0;
      const pbp = (sp as any)._bingpai.p ?? [];
      for (let n = 0; n <= 9; n++) handVec[AnmikaEnv.tileIdx('p', n)] += pbp[n] ?? 0;
      const sbp = (sp as any)._bingpai.s ?? [];
      for (let n = 0; n <= 9; n++) handVec[AnmikaEnv.tileIdx('s', n)] += sbp[n] ?? 0;
      const zbp = (sp as any)._bingpai.z ?? [];
      for (let n = 1; n <= 7; n++) handVec[AnmikaEnv.tileIdx('z', n)] += zbp[n] ?? 0;
    }
    if ((sp as any)?._zimo) {
      const zi = AnmikaEnv.paiToIdx(String((sp as any)._zimo));
      if (zi >= 0) handVec[zi] += 1;
    }
    for (const v of handVec) obs.push(v);

    // [2] 学習者 副露 multihot 37 dim
    for (const v of this.fulouMultihot(LEARNER)) obs.push(v);

    // [3] 学習者 河 multihot 37 dim
    for (const v of this.heMultihot(LEARNER)) obs.push(v);

    // [4] 学習者 状態 flag 6 dim
    obs.push(this.game.lizhi.has(LEARNER) ? 1 : 0);
    obs.push(this.game.openLizhi.has(LEARNER) ? 1 : 0);
    obs.push(this.game.feverActive[LEARNER] ? 1 : 0);
    obs.push(this.game.shuvariActive[LEARNER] ? 1 : 0);
    obs.push(this.game.yifaActive[LEARNER] ? 1 : 0);
    obs.push(this.game.lingshangActive[LEARNER] ? 1 : 0);

    // [5] 学習者 ぽっち 4 dim [blue/red/green/yellow]
    const ph = this.game.pochiHand[LEARNER];
    obs.push(ph?.blue ?? 0);
    obs.push(ph?.red ?? 0);
    obs.push(ph?.green ?? 0);
    obs.push(ph?.yellow ?? 0);

    // [6] 学習者 金牌 3 dim [p/s/z]
    const gh = this.game.goldHand[LEARNER];
    obs.push(gh?.p ?? 0);
    obs.push(gh?.s ?? 0);
    obs.push(gh?.z ?? 0);

    // [7] 学習者 抜き北 + 華 6 dim [nukidora, nukidoraGold, f1/f2/f3/f4]
    obs.push(this.game.nukidora[LEARNER] ?? 0);
    obs.push(this.game.nukidoraGold[LEARNER] ?? 0);
    const hua = this.game.huapai[LEARNER] ?? [];
    const huaCounts = { f1: 0, f2: 0, f3: 0, f4: 0 };
    for (const h of hua) {
      if (h === 'f1') huaCounts.f1++;
      else if (h === 'f2') huaCounts.f2++;
      else if (h === 'f3') huaCounts.f3++;
      else if (h === 'f4') huaCounts.f4++;
    }
    obs.push(huaCounts.f1, huaCounts.f2, huaCounts.f3, huaCounts.f4);

    // [8] 学習者 kinpeiTarget one-hot 5 dim [haru/natsu/aki/fuyu/none]
    const kt = this.game.kinpeiTarget[LEARNER];
    obs.push(kt === 'haru' ? 1 : 0);
    obs.push(kt === 'natsu' ? 1 : 0);
    obs.push(kt === 'aki' ? 1 : 0);
    obs.push(kt === 'fuyu' ? 1 : 0);
    obs.push(kt === null ? 1 : 0);

    // [9] 学習者 シャンテン数 1 dim
    let xt = 8;
    try { xt = this.game.xiangting(LEARNER); } catch (e) {}
    obs.push(xt);

    // [10] 学習者 tingpai 数 1 dim
    let tingSize = 0;
    try {
      const ting = (this.game as any).getTingpaiList?.(LEARNER) ?? [];
      tingSize = Array.isArray(ting) ? ting.length : 0;
    } catch (e) {}
    obs.push(tingSize);

    // [11] 他家 [P1, P2] 公開情報 6 dim each = 12 dim
    for (const p of [1, 2] as PlayerId[]) {
      obs.push(((this.game.state.defen[p] ?? 35000) - 35000) / 35000);
      obs.push((this.game.chipLedger[p] ?? 0) / 10);
      obs.push(this.fulouTileCount(p) / 4);
      obs.push(this.game.lizhi.has(p) ? 1 : 0);
      obs.push(this.game.feverActive[p] ? 1 : 0);
      const heLen = (this.game.he.get(p)?._pai?.length ?? 0);
      obs.push(heLen / 18);
    }

    // [12] 場情報: paishu/70, dorahyou multihot 37, dora 数/4, lunban/3, jushu/4, changbang/4, benbang/8
    obs.push((this.game.shan?.paishu ?? 0) / 70);
    const doraVec = new Array<number>(37).fill(0);
    const baopai = ((this.game.shan as any)?.baopai ?? []) as string[];
    for (const bp of baopai) {
      if (typeof bp !== 'string') continue;
      if (bp.startsWith('f')) continue;
      const idx = AnmikaEnv.paiToIdx(bp);
      if (idx >= 0) doraVec[idx] = 1;
    }
    for (const v of doraVec) obs.push(v);
    const doraCount = baopai.filter((b) => typeof b === 'string' && !b.startsWith('f')).length;
    obs.push(doraCount / 4);
    obs.push((this.game.state.lunban ?? 0) / 3);
    obs.push((this.game.state.jushu ?? 0) / 4);
    obs.push((this.game.state.changbang ?? 0) / 4);
    obs.push((this.game.state.benbang ?? 0) / 8);

    // legalActions: 手牌の tile 数だけ index 有効
    const cand = sp?.get_dapai?.(false) ?? [];
    const legalActions: number[] = [];
    for (let i = 0; i < Math.min(14, cand.length); i++) legalActions.push(i);
    return { obs, legalActions };
  }
}

export function createGame(): AnmikaEnv {
  return new AnmikaEnv();
}

export function simpleRandomAgent(legalActions: number[]): number {
  if (legalActions.length === 0) return 0;
  return legalActions[Math.floor(Math.random() * legalActions.length)];
}
