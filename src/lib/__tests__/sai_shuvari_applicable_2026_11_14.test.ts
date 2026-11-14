// [2026-11-14 isg. 通報 SB9Z rev 1588-1604]「サイコロを 2 回振る時にシュバサイだと、片方の表示が非シュバサイになる」
// シュバリーチ中の白ぽっち即ツモ本役満で、1 回目「本役満アガリ」は shuvariApplicable=false のため
// 画面が「シュバ非適用」、ゾロ目連続特典も付かなかった。2 回目「白ぽっち即ツモ」はシュバサイ。
// ルール §4-3/§4-4: ゾロ目連続特典はシュバリー時のサイコロ全部、別枠 (常時シュバサイ) は天地人和 ・ 流し役満だけ。
// §6-2 の「四華四北 ・ 八華の 100 枚、八華四北の 300 枚はシュバ非適用」は直接祝儀の話で、八華のサイコロは元から適用
import { describe, expect, it } from 'vitest';
import { Game3, buildShoupai } from '../game3';
import { defaultSanmaRule, generateTilePool } from '../shan3';
import type { PlayerId } from '../types';

function postProcess(result: any): any[] {
  const game = new Game3({ preShuffledPool: generateTilePool(defaultSanmaRule()) });
  game.qipai();
  game.applyAnmikaYakuPostProcess(result, 0, false, 'p1', null);
  return result.saiKoroChances ?? [];
}

function buildRawGame(hand: string[]): Game3 {
  const g = new Game3({ qijia: 0, changshu: 1 });
  for (const p of [0, 1, 2] as PlayerId[]) g.shoupai.set(p, buildShoupai(p === 0 ? hand : []));
  const dummy = new Game3();
  dummy.qipai();
  const HeCtor = dummy.he.get(0).constructor as any;
  for (const p of [0, 1, 2] as PlayerId[]) g.he.set(p, new HeCtor());
  const shanAny = g.shan as any;
  shanAny._pai = [];
  shanAny._baopai = ['z2'];
  return g;
}

describe('シュバ宣言中なら本役満 ・ 四華四北 ・ 八華四北のサイコロもシュバサイ [2026-11-14]', () => {
  it('本役満アガリのサイコロはシュバ適用 (常時シュバサイではない)', () => {
    const chances = postProcess({ hupai: [{ name: '大三元', fanshu: '*' }], damanguan: 1 });
    const generic = chances.filter((c) => c.name === '本役満アガリ');
    expect(generic).toEqual([expect.objectContaining({ shuvariApplicable: true, alwaysShuvari: false })]);
  });

  it('天和は今まで通り常時シュバサイ', () => {
    const chances = postProcess({ hupai: [{ name: '天和 [ダブル役満]', fanshu: '**' }], damanguan: 2 });
    expect(chances.find((c) => c.awardKey === 'yakuman:天和')).toEqual(expect.objectContaining({ alwaysShuvari: true }));
  });

  it('四華四北の 2 回はどちらもシュバ適用', () => {
    const g = buildRawGame(['p2', 'p3', 'p4', 's2', 's3', 's4', 's6', 's7', 's8', 'z7', 'z7', 'z7', 'z1']);
    g.lizhi.add(0);
    g.huapai[0] = ['f1', 'f2', 'f3', 'f4'];
    g.nukidora[0] = 4;
    const result = g.hule(0 as PlayerId, 'z1', 1 as PlayerId);
    expect(result).not.toBeNull();
    const sai = (result?.saiKoroChances ?? []).filter((c: any) => String(c.awardKey).startsWith('四華四北'));
    expect(sai.map((c: any) => [c.awardKey, c.shuvariApplicable])).toEqual([
      ['四華四北:1', true],
      ['四華四北:2', true],
    ]);
  });
});
