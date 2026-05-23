
// AI v5 action decoder + legal_mask 構築
//
// action space [137]:
//  0..38   : 打牌 [tile index、 TILE_KEYS[i]]
//  39..47  : ポン × 9 [候補 0..8 番目]
//  48..56  : 大明槓 × 9
//  57..65  : 暗槓 × 9
//  66..74  : 加槓 × 9
//  75..83  : チー × 9 [3 麻なので使わないが空けとく]
//  84..91  : リーチ宣言 × 8 候補 [tile index of 宣言牌]
//  92      : ツモ宣言 [hule self]
//  93      : ロン宣言
//  94      : pass [何もしない、 副露見送り]
//  95      : 抜き北
//  96      : 抜き華 [auto skip 通常、 v5 では未使用]
//  97      : continueFever
//  98      : nextRound
//  99..136 : 予備 [将来拡張]
//
// 上記は scaffold、 v5 step body は 「打牌 + リーチ + ツモ + ロン + pass + 抜き北」 のみ実装。

import type { Game3 } from '../lib/game3';
import type { PlayerId } from '../lib/types';
import { TILE_KEYS, TILE_DIM, tileIdx } from './tiles';

export const ACTION_SPACE_SIZE = 137;
export const ACT_DAPAI_BASE = 0;          // 0..38
export const ACT_PON_BASE = 39;
export const ACT_DAMINGANG_BASE = 48;
export const ACT_ANKAN_BASE = 57;
export const ACT_KAKAN_BASE = 66;
export const ACT_CHI_BASE = 75;
export const ACT_LIZHI_BASE = 84;
export const ACT_TSUMO = 92;
export const ACT_RON = 93;
export const ACT_PASS = 94;
export const ACT_NUKI_BEI = 95;
export const ACT_NUKI_HUA = 96;
export const ACT_FEVER_CONTINUE = 97;
export const ACT_NEXT_ROUND = 98;

export interface ActionContext {
  /** 現家 = active player [discard/lizhi 系の判断者] */
  player: PlayerId;
  /** 副露候補 [pon/kan/ron] の player [自分以外なら そっちに切替] */
  decisionPlayer: PlayerId;
  /** phase: 'self' = 自分の turn / 'fulou' = 副露決定 / 'ron' = ロン決定 */
  phase: 'self' | 'fulou' | 'ron';
  /** R21 P2 fix: fulou/ron 判定で getPonCandidates / getDamingangCandidates / canRon に渡す
   *  最後の dapai source [from_player + pai]、 store の lastDapai と整合 */
  lastDapai?: { player: PlayerId; pai: string } | null;
}

/** 現状から legal_mask を構築。 illegal な action は false */
export function buildLegalMask(game: Game3, ctx: ActionContext): boolean[] {
  const mask = new Array(ACTION_SPACE_SIZE).fill(false);
  const sp = game.shoupai.get(ctx.decisionPlayer);
  if (!sp) return mask;

  if (ctx.phase === 'self') {
    // 打牌候補 [get_dapai] が出せる tile を mark
    try {
      const dapai = (sp as any).get_dapai?.(false) ?? [];
      for (const t of dapai) {
        const key = (typeof t === 'string') ? t.replace(/[_-]$/, '') : '';
        const idx = tileIdx(key);
        if (idx >= 0) mask[ACT_DAPAI_BASE + idx] = true;
      }
    } catch (e) {}
    // ツモ
    try {
      if ((game as any).canTsumo?.(ctx.decisionPlayer)) mask[ACT_TSUMO] = true;
    } catch (e) {}
    // リーチ宣言 [候補 tile が幾つかあるが v5 簡略で 単一 token]
    try {
      if ((game as any).canLizhi?.(ctx.decisionPlayer)) mask[ACT_LIZHI_BASE] = true;
    } catch (e) {}
    // 抜き北
    try {
      if ((game as any).canNukiBei?.(ctx.decisionPlayer)) mask[ACT_NUKI_BEI] = true;
    } catch (e) {}
    // pass は self phase では使わない [必ず discard]、 strict にしたいなら false 維持
  } else if (ctx.phase === 'fulou') {
    // R21 P2 fix: getPonCandidates / getDamingangCandidates の実 API は (player, from, pai) 必須、
    // 旧 code は from/pai なしで呼んで 候補ゼロ固定だった。 ctx.lastDapai から取る [呼び出し側 store]
    const lastDapai = ctx.lastDapai ?? (game as any).lastDapai ?? null;
    const fromP = (lastDapai?.player ?? null) as PlayerId | null;
    const lastPai = lastDapai?.pai ?? null;
    if (fromP !== null && lastPai !== null) {
      try {
        const pon = (game as any).getPonCandidates?.(ctx.decisionPlayer, fromP, lastPai) ?? [];
        for (let i = 0; i < Math.min(pon.length, 9); i++) mask[ACT_PON_BASE + i] = true;
      } catch {}
      try {
        const dgang = (game as any).getDamingangCandidates?.(ctx.decisionPlayer, fromP, lastPai) ?? [];
        for (let i = 0; i < Math.min(dgang.length, 9); i++) mask[ACT_DAMINGANG_BASE + i] = true;
      } catch {}
    }
    const kan = (game as any).getKanCandidates?.(ctx.decisionPlayer) ?? [];
    for (let i = 0; i < Math.min(kan.length, 9); i++) mask[ACT_ANKAN_BASE + i] = true;
    mask[ACT_PASS] = true;
  } else if (ctx.phase === 'ron') {
    // R22 P2 #7 fix: ron phase で 常に ACT_RON=true だった、 game.canRon() で実 判定
    const lastDapai = ctx.lastDapai ?? (game as any).lastDapai ?? null;
    if (lastDapai && typeof (game as any).canRon === 'function') {
      try {
        if ((game as any).canRon(ctx.decisionPlayer, lastDapai.pai, lastDapai.player)) {
          mask[ACT_RON] = true;
        }
      } catch {}
    }
    mask[ACT_PASS] = true;
  }

  return mask;
}

export function actionToString(action: number): string {
  if (action < ACT_PON_BASE) return `dapai[${TILE_KEYS[action] ?? '?'}]`;
  if (action < ACT_DAMINGANG_BASE) return `pon[${action - ACT_PON_BASE}]`;
  if (action < ACT_ANKAN_BASE) return `damingang[${action - ACT_DAMINGANG_BASE}]`;
  if (action < ACT_KAKAN_BASE) return `ankan[${action - ACT_ANKAN_BASE}]`;
  if (action < ACT_CHI_BASE) return `kakan[${action - ACT_KAKAN_BASE}]`;
  if (action < ACT_LIZHI_BASE) return `chi[${action - ACT_CHI_BASE}]`;
  if (action < ACT_TSUMO) return `lizhi[${action - ACT_LIZHI_BASE}]`;
  if (action === ACT_TSUMO) return 'tsumo';
  if (action === ACT_RON) return 'ron';
  if (action === ACT_PASS) return 'pass';
  if (action === ACT_NUKI_BEI) return 'nukibei';
  if (action === ACT_NUKI_HUA) return 'nukihua';
  if (action === ACT_FEVER_CONTINUE) return 'fever_continue';
  if (action === ACT_NEXT_ROUND) return 'next_round';
  return `unknown[${action}]`;
}
