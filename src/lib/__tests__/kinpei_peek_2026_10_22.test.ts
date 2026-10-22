import { describe, expect, it } from 'vitest';
import { render } from 'svelte/server';
import { readFileSync } from 'node:fs';
import KinpeiModal from '../KinpeiModal.svelte';
import KinpeiPeekBar from '../KinpeiPeekBar.svelte';

// [2026-10-22 リョー「金北選択時に盤面に戻って情報見れるようにする」]
// 金北の選択の板に「盤面を見る」を置き、たたんだ間は「選択に戻る」の帯だけを残す。
// 選択 [pendingKinpei] と制限時間は触らない [見た目だけ]。押した後の動きは Playwright の画面確認で見る。

const props = { preview: null, winnerName: null, winner: 0, huapai: ['f1', 'f1', 'f4'], onSelect: () => {}, allowHold: false };

describe('金北の選択の板の「盤面を見る」', () => {
  it('KinpeiModal の初期表示に「盤面を見る」と選択肢が両方ある [選択は塞がない]', () => {
    const { body } = render(KinpeiModal, { props });
    expect(body).toContain('盤面を見る');
    expect(body).toContain('data-kinpei-option="haru"');
    expect(body).toContain('data-kinpei-option="fuyu"');
    // たたんだ帯は初期表示には出ない
    expect(body).not.toContain('kinpei-peek-bar');
    expect(body).not.toContain('選択に戻る');
  });
  it('たたんだ間の帯は「選択に戻る」を持ち、選択肢は持たない [選択は pending のまま]', () => {
    const { body } = render(KinpeiPeekBar, { props: { onBack: () => {} } });
    expect(body).toContain('kinpei-peek-bar');
    expect(body).toContain('選択に戻る');
    expect(body).not.toContain('data-kinpei-option');
  });
  it('たたむのは見た目だけ: App と KinpeiModal の peek は state / 選択 / 制限時間の呼び出しを持たない', () => {
    const modal = readFileSync(new URL('../KinpeiModal.svelte', import.meta.url), 'utf8');
    const bar = readFileSync(new URL('../KinpeiPeekBar.svelte', import.meta.url), 'utf8');
    for (const src of [modal, bar]) {
      expect(src).not.toMatch(/selectKinpei|clearKinpeiChoice|setKinpeiChoice|deadline|timeout/i);
    }
    const app = readFileSync(new URL('../../App.svelte', import.meta.url), 'utf8');
    // kinpeiPeek は pendingKinpei が消えたら戻る [選択後に帯だけ残らない]
    expect(app).toMatch(/\$: if \(!\$game\.pendingKinpei\) kinpeiPeek = false;/);
    // 板をたたむ class は CSS で隠すだけ [DOM を壊さない = 入力途中の物を失わない]
    expect(app).toContain('class:kinpei-peek-hidden={kinpeiPeek && !!$game.pendingKinpei}');
  });
});
