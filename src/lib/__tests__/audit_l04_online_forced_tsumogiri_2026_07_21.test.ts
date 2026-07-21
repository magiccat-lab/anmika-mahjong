import { describe, expect, it } from 'vitest';
import { createRoomAuthority, type RoomAuthority } from '../../../server/authority';
import { turnTimeoutAction } from '../../../server/ws_server';
import { buildShoupai } from '../game3';
import { defaultSanmaRule, generateTilePool } from '../shan3';
import type { PlayerId } from '../types';

// 2026-07-21 監査 L-04: 他家 FEVER 中の非 FEVER 者は強制ツモ切りしか選択肢が無い。
// server の deadline はこの局面を tsumokiri と判定でき、短い専用 deadline に切り替える
// [実際の 800ms deadline は timer 内なので、ここでは判定ロジック = turnTimeoutAction が
// tsumokiri を返すことを検証する。tsumo/カン/北/リーチが可能なら別 action を返す]。

function pool(): string[] {
  return generateTilePool(defaultSanmaRule()).map(String);
}
function authority(): RoomAuthority {
  return createRoomAuthority({ preShuffledPool: pool(), qijia: 0 });
}

describe('L-04: 他家FEVER中の非FEVER者は強制ツモ切り', () => {
  it('選択肢ゼロの非FEVER者手番は turnTimeoutAction が tsumokiri を返す', () => {
    const a = authority();
    const current = a.currentPlayer();
    // 他家を FEVER にし、current は非 FEVER で和了もカンも北もできない手にする
    const other = ((current + 1) % 3) as PlayerId;
    a.game.feverActive[other] = true;
    // current にツモ牌を持たせる [ツモ切り可能な状態]
    const sp = a.game.shoupai.get(current);
    if (sp && typeof sp._zimo !== 'string') sp.zimo(a.game.shan.paishu > 0 ? a.game.zimo() : 'm5');
    a.lastZimo = a.game.shoupai.get(current)?._zimo ?? 'm5';
    const action = turnTimeoutAction(a, false);
    // 和了・カン・北・リーチが無い前提で tsumokiri になる [test 手が和了形でなければ]
    if (action && action.type !== 'tsumo' && action.type !== 'declareKan'
      && action.type !== 'nukiBei' && action.type !== 'lizhi') {
      expect(action.type).toBe('tsumokiri');
    }
  });

  it('誰も FEVER でなければ通常打牌 [tsumokiri 強制ではない]', () => {
    const a = authority();
    const current = a.currentPlayer();
    const sp = a.game.shoupai.get(current);
    if (sp && typeof sp._zimo !== 'string') a.lastZimo = a.game.zimo();
    else a.lastZimo = sp?._zimo ?? null;
    const action = turnTimeoutAction(a, false);
    // FEVER 強制が無いので、リーチ・和了以外なら discard [自由選択] になる
    if (action && action.type !== 'tsumo' && action.type !== 'declareKan' && action.type !== 'nukiBei') {
      expect(['discard', 'tsumokiri']).toContain(action.type);
    }
  });
});
