import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

// [2026-10-24 リョー「なんか俺の席だけisgになってるよ」] 4 人回しで抜け番が明けた試合、自分の席の札に
// 前の試合でその game seat にいた人の名前が残った。legacy の template は seatName(p) の中の
// onlineActiveMapping の読みを untrack で包むので、mapping が替わっても札が描き直されない。
// 札 ・ 華の板 ・ 次のツモの板は $: で作る seatDisplayNames を読む
describe('席の名前は mapping の切り替えで描き直す', () => {
  const src = readFileSync(new URL('../../App.svelte', import.meta.url), 'utf8');

  it('markup は seatName(...) を直に呼ばない', () => {
    const markup = src.replace(/<script[\s\S]*?<\/script>/g, '');
    expect(markup).not.toMatch(/seatName\(/);
  });

});
