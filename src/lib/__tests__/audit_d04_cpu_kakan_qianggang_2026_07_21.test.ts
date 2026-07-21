import { describe, expect, it } from 'vitest';
import { get } from 'svelte/store';
import { game } from '../store';
import { cpuStepImpl } from '../store/cpuActions';
import { buildShoupai } from '../game3';
import type { PlayerId } from '../types';

// 2026-07-21 監査 D-04: CPU の自動加槓 [三元牌] が game.declareKan 直呼びで
// 槍槓の反応窓 [pendingQianggang / awaitingRonDecision] を作らず、他家が
// 槍槓できないまま嶺上まで取得していた。human と同じ
// processKakanQianggangWindow を通し、人間候補がいれば判断待ちで停止する。

describe('D-04: CPU 加槓の槍槓反応窓', () => {
  it('人間が槍槓できる CPU 加槓は反応窓を開いて停止する', () => {
    game.reset();
    const s: any = get(game);
    const g = s.game;
    s.cpu = { 0: false, 1: true, 2: true };

    // CPU p1: 發 [z6] ポン済み + 4 枚目ツモで加槓候補が立つ
    const sp1 = buildShoupai(['m1', 'm2', 'm3', 'p1', 'p2', 'p3', 's1', 's2', 's3', 'm9']);
    sp1._fulou.push('z666=');
    sp1.zimo('z6');
    g.shoupai.set(1 as PlayerId, sp1);

    // 人間 p0: z6 単騎リーチ [槍槓候補]
    const sp0 = buildShoupai(['m1', 'm2', 'm3', 'p4', 'p5', 'p6', 's4', 's5', 's6', 'm4', 'm5', 'm6', 'z6']);
    g.shoupai.set(0 as PlayerId, sp0);
    g.lizhi.add(0 as PlayerId);

    // p1 の手番にする
    for (const lb of [0, 1, 2]) {
      if (g.lunbanToPlayerId(lb) === 1) { g.state.lunban = lb; break; }
    }
    s.lastZimo = 'z6';
    s.lastDapai = null;
    const baopaiLenBefore = g.shan.baopai.length;

    const after = cpuStepImpl(s);

    // 反応窓が開いて CPU 手番はここで停止 [旧実装は即カンで嶺上まで進んだ]
    expect(after.pendingQianggang).not.toBeNull();
    expect(after.pendingQianggang?.kakanPai).toBe('z6');
    expect(after.awaitingRonDecision).toBe(true);
    // カン未確定: 新ドラは開いていない
    expect(after.game.shan.baopai.length).toBe(baopaiLenBefore);
  });

  it('槍槓候補がいなければ従来どおり即カンして進む', () => {
    game.reset();
    const s: any = get(game);
    const g = s.game;
    s.cpu = { 0: false, 1: true, 2: true };

    const sp1 = buildShoupai(['m1', 'm2', 'm3', 'p1', 'p2', 'p3', 's1', 's2', 's3', 'm9']);
    sp1._fulou.push('z666=');
    sp1.zimo('z6');
    g.shoupai.set(1 as PlayerId, sp1);

    for (const lb of [0, 1, 2]) {
      if (g.lunbanToPlayerId(lb) === 1) { g.state.lunban = lb; break; }
    }
    s.lastZimo = 'z6';
    s.lastDapai = null;
    const baopaiLenBefore = g.shan.baopai.length;

    const after = cpuStepImpl(s);

    expect(after.pendingQianggang).toBeNull();
    // 加槓確定で新ドラが 1 枚開く
    expect(after.game.shan.baopai.length).toBe(baopaiLenBefore + 1);
  });
});
