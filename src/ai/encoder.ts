
// AI v5 obs encoder: Game3 state → Float32Array
// 設計: 39 種別 × [hand / river / fulou] + globals、 v5 は scope 縮小で active player 視点のみ
// 総 dim: hand 39 + river 3×30×39=3510 + fulou 3×4×39=468 + global ~32 = 4049

import { Game3 } from '../lib/game3';
import type { PlayerId } from '../lib/types';
import { TILE_DIM, tileIdx, normalizeTileForObs } from './tiles';

export const HAND_DIM = TILE_DIM;                   // 39
export const RIVER_PER_PLAYER_MAX = 30;
export const RIVER_DIM = 3 * RIVER_PER_PLAYER_MAX * TILE_DIM;  // 3510
export const FULOU_PER_PLAYER_MAX = 4;
export const FULOU_DIM = 3 * FULOU_PER_PLAYER_MAX * TILE_DIM;  // 468
export const GLOBAL_DIM = 32;
export const OBS_DIM = HAND_DIM + RIVER_DIM + FULOU_DIM + GLOBAL_DIM;  // 4049

const HAND_OFF = 0;
const RIVER_OFF = HAND_OFF + HAND_DIM;
const FULOU_OFF = RIVER_OFF + RIVER_DIM;
const GLOBAL_OFF = FULOU_OFF + FULOU_DIM;

/** active player 視点で Game3 state を Float32Array に encode */
export function encodeObs(game: Game3, player: PlayerId): Float32Array {
  const obs = new Float32Array(OBS_DIM);

  // === hand: 自分の bingpai 内訳 [count] === [HAND_OFF, RIVER_OFF)
  const sp = game.shoupai.get(player);
  if (sp) {
    const bp = (sp as any)._bingpai;
    if (bp) {
      // _bingpai 構造: { m: [_, n1, n2, ..., n9], p: [...], s: [...], z: [...] }、 [0] は赤数
      const writeSuit = (s: 'm'|'p'|'s'|'z', maxN: number) => {
        const arr = bp[s];
        if (!arr) return;
        const red = arr[0] ?? 0;  // p0 / s0 [赤 5]
        for (let n = 1; n <= maxN; n++) {
          const cnt = arr[n] ?? 0;
          if (cnt <= 0) continue;
          const key = `${s}${n}`;
          const idx = tileIdx(key);
          if (idx >= 0) obs[HAND_OFF + idx] = cnt;
        }
        if (red > 0 && (s === 'p' || s === 's')) {
          const idx = tileIdx(`${s}0`);
          if (idx >= 0) obs[HAND_OFF + idx] = red;
        }
      };
      writeSuit('m', 9);
      writeSuit('p', 9);
      writeSuit('s', 9);
      writeSuit('z', 7);
    }
    // pochiHand: z5b/r/g/y 色別
    const pH = (game as any).pochiHand?.[player];
    if (pH) {
      for (const [color, cnt] of Object.entries(pH) as Array<[string, number]>) {
        const k = color === 'b' ? 'z5b' : color === 'r' ? 'z5r' : color === 'g' ? 'z5g' : color === 'y' ? 'z5y' : null;
        if (k) {
          const idx = tileIdx(k);
          if (idx >= 0) obs[HAND_OFF + idx] = cnt;
        }
      }
    }
    // goldHand: gp / gs / gN
    const gH = (game as any).goldHand?.[player];
    if (gH) {
      const gpIdx = tileIdx('gp'), gsIdx = tileIdx('gs'), gNIdx = tileIdx('gN');
      if (gpIdx >= 0 && gH.p > 0) obs[HAND_OFF + gpIdx] = gH.p;
      if (gsIdx >= 0 && gH.s > 0) obs[HAND_OFF + gsIdx] = gH.s;
      if (gNIdx >= 0 && gH.z > 0) obs[HAND_OFF + gNIdx] = gH.z;
    }
    // huapai
    const hp = (game as any).huapai?.[player] ?? [];
    for (const f of hp) {
      const idx = tileIdx(f);
      if (idx >= 0) obs[HAND_OFF + idx] = (obs[HAND_OFF + idx] ?? 0) + 1;
    }
  }

  // === river: 各 seat の捨牌 直近 30 枚 を 1-hot per slot === [RIVER_OFF, FULOU_OFF)
  for (let seat = 0; seat < 3; seat++) {
    const he = (game as any).he?.get?.(seat as PlayerId);
    if (!Array.isArray(he)) continue;
    const start = Math.max(0, he.length - RIVER_PER_PLAYER_MAX);
    for (let i = start; i < he.length; i++) {
      const slot = i - start;
      const tile = normalizeTileForObs(typeof he[i] === 'string' ? he[i] : (he[i]?.pai ?? ''));
      const idx = tileIdx(tile);
      if (idx < 0) continue;
      const off = RIVER_OFF + (seat * RIVER_PER_PLAYER_MAX + slot) * TILE_DIM + idx;
      obs[off] = 1;
    }
  }

  // === fulou: 各 seat の 副露 mianzi の 代表 tile を 1-hot === [FULOU_OFF, GLOBAL_OFF)
  for (let seat = 0; seat < 3; seat++) {
    const ssp = game.shoupai.get(seat as PlayerId);
    const fl = (ssp as any)?._fulou ?? [];
    for (let i = 0; i < Math.min(fl.length, FULOU_PER_PLAYER_MAX); i++) {
      const m = fl[i];
      if (typeof m !== 'string') continue;
      // mianzi format e.g. "p123-" / "z5z5z5" — 先頭 2 文字を tile key として拾う
      const tile = m.slice(0, 2);
      const idx = tileIdx(tile);
      if (idx < 0) continue;
      const off = FULOU_OFF + (seat * FULOU_PER_PLAYER_MAX + i) * TILE_DIM + idx;
      obs[off] = 1;
    }
  }

  // === globals === [GLOBAL_OFF, OBS_DIM)
  let g = GLOBAL_OFF;
  const s = game.state;
  obs[g++] = s.qijia ?? 0;                 // 親 seat
  obs[g++] = s.lunban ?? 0;                // 順番 [0..2]
  obs[g++] = (s.changbang ?? 0);           // 場
  obs[g++] = (s.jushu ?? 0);               // 局
  obs[g++] = (s.benbang ?? 0);             // 本場
  obs[g++] = (s.lizhibang ?? 0);           // 供託リーチ
  obs[g++] = ((s as any).paishu ?? 0) / 70; // 残山 normalize
  // 各 seat の点数 [自分基準 normalize]
  const def = (s.defen ?? {}) as Record<PlayerId, number>;
  const myDefen = ((def[player] ?? 0) / 1000);
  obs[g++] = myDefen;
  for (let seat = 0; seat < 3; seat++) {
    obs[g++] = ((def[seat as PlayerId] ?? 0) / 1000);
  }
  // リーチ flag × 3
  for (let seat = 0; seat < 3; seat++) {
    obs[g++] = (game as any).lizhi?.has?.(seat) ? 1 : 0;
  }
  // フィーバー flag × 3
  for (let seat = 0; seat < 3; seat++) {
    obs[g++] = (game as any).feverActive?.[seat] ? 1 : 0;
  }
  // 一発 flag × 3
  for (let seat = 0; seat < 3; seat++) {
    obs[g++] = (game as any).yifaActive?.has?.(seat) ? 1 : 0;
  }
  // ぽっち倍率 × 3
  for (let seat = 0; seat < 3; seat++) {
    const pm = (game as any).pochiMultiplier?.[seat];
    obs[g++] = typeof pm === 'number' ? pm : (pm?.chip ?? 1);
  }
  // 抜き北 / 金北 × 3
  for (let seat = 0; seat < 3; seat++) {
    obs[g++] = (game as any).nukidora?.[seat] ?? 0;
    obs[g++] = (game as any).nukidoraGold?.[seat] ?? 0;
  }
  // pad to GLOBAL_DIM
  return obs;
}
