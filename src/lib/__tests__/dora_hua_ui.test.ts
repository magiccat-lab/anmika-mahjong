import { describe, expect, it } from 'vitest';
import { render } from 'svelte/server';
import HeaderInfo from '../HeaderInfo.svelte';
import RoundEndPanel from '../RoundEndPanel.svelte';
import WallPanel from '../WallPanel.svelte';

describe('flower dora indicator UI', () => {
  it('局中ヘッダーで華のドラ表示牌現物を隠さない', () => {
    const { body } = render(HeaderInfo, {
      props: {
        changbang: 0,
        jushu: 0,
        benbang: 0,
        lizhibang: 0,
        paishu: 50,
        baopai: ['f1', 'p1'],
        dora: ['f1', 'p2'],
        currentPlayer: 0,
        lastZimo: null,
      },
    });
    expect(body).toContain('/tiles/spring.svg');
    expect(body).toContain('/tiles/Pin1.svg');
  });

  it('局結果で表・裏どちらの表示華も現物として表示する', () => {
    const { body } = render(RoundEndPanel, {
      props: {
        lastWinner: 0,
        huleResult: { hupai: [], fu: 30, fanshu: 1, defen: 1000 },
        baopai: ['f3'],
        fubaopai: ['f4'],
        winnerLizhi: true,
      },
    });
    expect(body).toContain('/tiles/autumn.svg');
    expect(body).toContain('/tiles/winter.svg');
  });

  it('山デバッグ表示でlive wallを王牌と取り違えない', () => {
    const { body } = render(WallPanel, {
      props: {
        wall: ['p1', 'p2'],
        rinshan: ['s1'],
        baopai: ['z1', 'z2'],
        fubaopai: ['z3'],
      },
    });
    expect(body).toContain('生牌 2 枚 / 王牌 4 枚');
    expect(body).toContain('/tiles/Pin1.svg');
    expect(body).toContain('/tiles/Pin2.svg');
    expect(body).toContain('嶺上牌 [1 枚]');
  });
});
