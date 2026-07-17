import { describe, expect, it } from 'vitest';
import { countDisplayDora } from '../doraDisplay';
import { fulouPhysicalFlatTiles } from '../fulouDisplay';

describe('countDisplayDora', () => {
  it('金・虹の物理名をcoreへ変換して表示ドラ一致を数える', () => {
    expect(countDisplayDora(
      ['gp', 'gs', 'gN', 'np3', 'ns3', 'nz3'],
      ['p5', 's5', 'z4', 'p3', 's3', 'z3'],
    )).toBe(6);
  });

  it('赤加算は物理赤だけに行い、金5を赤として二重加算しない', () => {
    expect(countDisplayDora(['p0', 'p5', 'gp'], ['p5'])).toBe(4);
  });

  it('同じドラ表示が複数あれば各表示枠ぶん重ねて数える', () => {
    expect(countDisplayDora(['gp', 'p0'], ['p5', 'p5'])).toBe(5);
  });

  it('華牌の表示枠は華として扱い、ドラ牌を指定しない', () => {
    expect(countDisplayDora(['f1', 'p1'], ['f1'])).toBe(0);
  });

  it('副露した金5をcore赤牌へ戻さず、赤ドラとして二重加算しない', () => {
    const tiles = fulouPhysicalFlatTiles(
      ['p055+'],
      [{ mianzi: 'p055+', taken: 'gp' }],
      [],
    );
    expect(tiles).toContain('gp');
    expect(countDisplayDora(tiles, ['p5'])).toBe(3);
  });
});
