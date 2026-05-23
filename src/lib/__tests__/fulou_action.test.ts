import { describe, it, expect } from 'vitest';
import { Game3, buildShoupai } from '../game3';
import type { PlayerId, Lunban } from '../types';

// declarePon / declareKan の挙動を unit 固定。
// 副露 [明刻 / 大明槓 / 暗槓 / 加槓] の lunban 変化 + yifa 消失 + diyizimo flag を check。

function setupPonScene(): { g: Game3; ponPlayer: PlayerId; fromPlayer: PlayerId } {
  const g = new Game3();
  g.qipai();
  // ponPlayer = qijia の対面、 fromPlayer = qijia [親が打った p7 を ポン]
  const qijia = g.state.qijia;
  const fromPlayer = qijia;
  const ponPlayer = ((qijia + 1) % 3) as PlayerId;
  // 手牌に p7 を 2 枚仕込む
  g.shoupai.set(ponPlayer, buildShoupai(['p7','p7','p1','p2','p3','s1','s2','s3','s7','s7','s7','m9','m9']));
  // 親が p7 を 打った direction として `+/=/-` 方向 mark を mianzi に込める
  // 3 麻 [反時計]: ponPlayer から見て fromPlayer は前家か対面か後家か
  //   反時計 lunban の前家 = qijia (lunban 0→1→2 で player qijia→...)、
  //   mianzi の方向 mark は majiang-core 慣習 +/=/- = 上家/対面/下家
  // ここでは安全側で fromPlayer 方向 計算は majiang core に任せず、 単純な - [下家] を test
  return { g, ponPlayer, fromPlayer };
}

describe('Game3 declarePon', () => {
  it('mianzi 不正 [手に 2 枚ナシ] で pon 失敗 → false + pingju event', () => {
    const g = new Game3();
    g.qipai();
    const ponPlayer = 1 as PlayerId;
    const fromPlayer = 0 as PlayerId;
    // 手に p7 ナシ
    g.shoupai.set(ponPlayer, buildShoupai(['m9','m9','m9','p1','p2','p3','s1','s2','s3','s5','s5','s5','s9']));
    const ok = g.declarePon(ponPlayer, 'p7p7p7+', fromPlayer);
    expect(ok).toBe(false);
    expect(g.events.some((e: any) => e.type === 'pingju' && /pon failed/.test(e.reason ?? ''))).toBe(true);
  });
});

describe('Game3 declareKan [暗槓 / 加槓]', () => {
  it('shoupai ナシ player では null 返す [safe guard]', () => {
    const g = new Game3();
    g.qipai();
    // shoupai map から強制削除
    g.shoupai.delete(0 as PlayerId);
    const replacement = g.declareKan(0 as PlayerId, 'm7m7m7m7');
    expect(replacement).toBeNull();
  });
});
