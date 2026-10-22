import { describe, expect, it } from 'vitest';
import { render } from 'svelte/server';
import KinpeiModal from '../KinpeiModal.svelte';
import { kinpeiOptionLabel, kinpeiOptions } from '../kinpeiLabel';

// [2026-10-22 リョー「金北の華選択は春春とかなら春春って出すようにして欲しい」]
// 同じ季節を重ねて持っている時は、枚数分の字 [春春] を選択肢に出す。

describe('kinpeiOptionLabel / kinpeiOptions', () => {
  it('春を 2 枚持っていれば「春春」、1 枚なら「春」', () => {
    expect(kinpeiOptionLabel(['f1', 'f1', 'f3'], 'f1')).toBe('春春');
    expect(kinpeiOptionLabel(['f1', 'f1', 'f3'], 'f3')).toBe('秋');
  });
  it('持っていない季節は空文字、華でない牌も空文字', () => {
    expect(kinpeiOptionLabel(['f1'], 'f2')).toBe('');
    expect(kinpeiOptionLabel(['f1'], 'm1')).toBe('');
  });
  it('3 枚なら 3 つ並ぶ [冬冬冬]', () => {
    expect(kinpeiOptionLabel(['f4', 'f4', 'f4'], 'f4')).toBe('冬冬冬');
  });
  it('選択肢は持っている季節だけを 春夏秋冬の順で、配列の並びに依らない', () => {
    const opts = kinpeiOptions(['f4', 'f1', 'f4', 'f1', 'f3']);
    expect(opts.map((o) => [o.target, o.label, o.count])).toEqual([
      ['haru', '春春', 2],
      ['aki', '秋', 1],
      ['fuyu', '冬冬', 2],
    ]);
  });
  it('華が 1 枚も無ければ選択肢は空', () => {
    expect(kinpeiOptions([])).toEqual([]);
    expect(kinpeiOptions(['m1', 'z4'])).toEqual([]);
  });
});

describe('KinpeiModal の選択肢の字', () => {
  const buttons = (body: string) =>
    [...body.matchAll(/<button[^>]*data-kinpei-option="(\w+)"[^>]*>([^<]*)<\/button>/g)].map((m) => [m[1], m[2]]);
  it('春春と夏を持っていれば「春春」「夏」のボタンになる', () => {
    const { body } = render(KinpeiModal, {
      props: { preview: null, winnerName: null, winner: 0, huapai: ['f1', 'f2', 'f1'], onSelect: () => {}, allowHold: false },
    });
    expect(buttons(body)).toEqual([['haru', '春春'], ['natsu', '夏']]);
    // 旧表示の「春」1 文字だけのボタンは出ない
    expect(body).not.toMatch(/>春<\/button>/);
  });
  it('保留 [フィーバー時] は選択肢の後ろに残る', () => {
    const { body } = render(KinpeiModal, {
      props: { preview: null, winnerName: null, winner: 1, huapai: ['f4', 'f4'], onSelect: () => {}, allowHold: true },
    });
    expect(buttons(body)).toEqual([['fuyu', '冬冬']]);
    expect(body).toContain('保留');
  });
});
