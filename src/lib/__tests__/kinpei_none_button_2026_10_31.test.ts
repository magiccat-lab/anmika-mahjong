import { describe, expect, it } from 'vitest';
import { render } from 'svelte/server';
import { readFileSync } from 'node:fs';
import KinpeiModal from '../KinpeiModal.svelte';

// [2026-10-31 先輩「金北の強化対象がない時の灰色のボタンが色的に押していいか分かりづらい」]
// 強化先が無い時は「強化なしで次へ」を押す物の金の板で 1 つだけ出す。保留は灰色の塗りをやめて金の枠。

const base = { preview: null, winnerName: null, winner: 0, onSelect: () => {} };

describe('金北の強化先が無い時のボタン', () => {
  it('強化先が無ければ金の板の「強化なしで次へ」だけ [フィーバーでも保留を重ねない]', () => {
    const { body } = render(KinpeiModal, { props: { ...base, huapai: [], allowHold: true } });
    expect(body).toContain('強化なしで次へ');
    expect(body).toContain('class="go');
    expect(body).not.toContain('保留 [今局のみ]');
  });
  it('保留不可 [通常の上がり] でも強化先が無ければボタンが出る [止まらない]', () => {
    const { body } = render(KinpeiModal, { props: { ...base, huapai: [], allowHold: false } });
    expect(body).toContain('data-kinpei-option="none"');
  });
  it('強化先があれば季節と保留が出て、強化なしは出ない', () => {
    const { body } = render(KinpeiModal, { props: { ...base, huapai: ['f2'], allowHold: true } });
    expect(body).toContain('data-kinpei-option="natsu"');
    expect(body).toContain('保留 [今局のみ]');
    expect(body).not.toContain('強化なしで次へ');
  });
  it('灰色の塗り [#888] のボタンが金北の板に残っていない', () => {
    const modal = readFileSync(new URL('../KinpeiModal.svelte', import.meta.url), 'utf8');
    expect(modal).not.toMatch(/\.hold \{ background: #888/);
    const app = readFileSync(new URL('../../App.svelte', import.meta.url), 'utf8');
    expect(app).not.toMatch(/kinpei-btn\.hold \{ background: #888/);
    expect(app).not.toContain('強化対象なし [次へ]');
  });
});
