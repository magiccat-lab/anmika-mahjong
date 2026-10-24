// [2026-10-24 先輩「冬冬金北とか選ぶか考える時に山の残り枚数とか川とか見れるように」]
import { describe, expect, it } from 'vitest';
import { render } from 'svelte/server';
import FuyuModal from '../FuyuModal.svelte';
import KinpeiModal from '../KinpeiModal.svelte';

describe('冬 ・ 金北の選択中に盤面と山の残りを見る', () => {
  it('冬を使うかの板に「盤面を見る」と残り山が出る', () => {
    const { body } = render(FuyuModal, {
      props: { winner: 0, waitRemain: 3, shanRemain: 27, onSelect: () => {} },
    });
    expect(body).toContain('盤面を見る');
    expect(body).toContain('27');
  });

  it('金北の強化先の板に残り山が出る', () => {
    const { body } = render(KinpeiModal, {
      props: { winner: 1, huapai: ['f4', 'f4'], onSelect: () => {}, shanRemain: 19 },
    });
    expect(body).toContain('残り山');
    expect(body).toContain('19');
    expect(body).toContain('盤面を見る');
  });

  it('残り山を渡さない呼び方では出さない', () => {
    const { body } = render(KinpeiModal, {
      props: { winner: 1, huapai: ['f4'], onSelect: () => {} },
    });
    expect(body).not.toContain('残り山');
  });
});
