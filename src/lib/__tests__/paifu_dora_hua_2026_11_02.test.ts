// 2026-11-02 牌譜にドラ表と華を残す [cpu-lab: 牌譜から局面を再生した時に、ドラと華が無くて手の価値が測れなかった]
//   - qipai: 局の始めのドラ表 [表示分] と配牌で抜いた華
//   - zimo: このツモの前に抜いた華 [抜いた時だけ]
//   - gang / hule: その時点のドラ表 [カンドラ ・ 秋で増えた分を含む]
// 裏ドラはどこにも入れない。他の席への配り方 [publicEventForSeat] は qipai / zimo を伏せたまま
import { describe, it, expect } from 'vitest';
import { Game3 } from '../game3';
import { publicEventForSeat } from '../../../server/ws_server';
import type { PlayerId } from '../types';

describe('牌譜のドラ表と華', () => {
  it('qipai に局の始めのドラ表と配牌の華が入る [裏ドラは入らない]', () => {
    const g = new Game3({ qijia: 0 });
    g.qipai();
    const qipai = g.events.filter((e: any) => e.type === 'qipai') as any[];
    expect(qipai).toHaveLength(3);
    for (const e of qipai) {
      expect(e.baopai).toEqual([...g.shan.displayBaopai]);
      expect(e.hua).toEqual(g.huapai[e.player as PlayerId]);
      expect(JSON.stringify(e)).not.toContain('fubaopai');
    }
  });

  it('華を抜いた後のツモには hua が付き、抜かないツモには付かない', () => {
    const g = new Game3({ qijia: 0 });
    g.qipai();
    const shan = g.shan as any;
    // 次のツモ [_pai の末尾から引く] を 春 → 補充 の順にする
    shan._pai.push('f1');
    g.zimo();
    const withHua = g.events.at(-1) as any;
    expect(withHua.type).toBe('zimo');
    expect(withHua.hua).toEqual(['f1']);
    expect(g.huapai[withHua.player as PlayerId]).toContain('f1');
  });

  it('他の席へは qipai は枚数だけ、zimo は牌も華も伏せる', () => {
    const qipai = { type: 'qipai', player: 1, tiles: Array(13).fill('p1'), baopai: ['s3', 'z1'], hua: ['f2'] };
    expect(publicEventForSeat(qipai, 0)).toEqual({ type: 'qipai', player: 1, count: 13 });
    const zimo = { type: 'zimo', player: 1, pai: 'p2', hua: ['f1'] };
    expect(publicEventForSeat(zimo, 0)).toEqual({ type: 'zimo', player: 1, pai: null });
  });
});
