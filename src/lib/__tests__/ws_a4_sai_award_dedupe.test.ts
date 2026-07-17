import { describe, expect, it } from 'vitest';
import { Game3 } from '../game3';
import { defaultSanmaRule, generateTilePool } from '../shan3';

function postProcess(result: any, isRon = false): any[] {
  const game = new Game3({ preShuffledPool: generateTilePool(defaultSanmaRule()) });
  game.qipai();
  game.applyAnmikaYakuPostProcess(result, 0, isRon, 'p1', isRon ? 1 : null);
  return result.saiKoroChances ?? [];
}

describe('WSA-A4 sai-koro yakuman award registration', () => {
  it('registers karasu once at base 140', () => {
    const chances = postProcess({
      hupai: [{ name: 'カラス [リーのみ役満]', fanshu: '*' }],
      damanguan: 1,
    }, true);

    expect(chances.filter((chance) => chance.name.includes('カラス') || chance.name === '本役満アガリ')).toEqual([
      expect.objectContaining({
        awardKey: 'yakuman:カラス',
        name: 'カラス [出目当て効果 ×2]',
        baseChip: 140,
        count: 1,
      }),
    ]);
  });

  it('registers hachiren once at base 140', () => {
    const chances = postProcess({
      hupai: [{ name: '八連荘 [ツモ]', fanshu: '*' }],
      damanguan: 1,
    });

    expect(chances.filter((chance) => chance.name === '八連荘' || chance.name === '本役満アガリ')).toEqual([
      expect.objectContaining({ awardKey: 'yakuman:八連荘', baseChip: 140, count: 1 }),
    ]);
  });

  it('registers double-yakuman tenhou as two inherent-Shuba sessions at base 140', () => {
    const chances = postProcess({
      hupai: [{ name: '天和 [ダブル役満]', fanshu: '**' }],
      damanguan: 2,
    });

    expect(chances.filter((chance) => chance.name === '天和' || chance.name === '本役満アガリ')).toEqual([
      expect.objectContaining({ awardKey: 'yakuman:天和', baseChip: 140, count: 2, alwaysShuvari: true }),
    ]);
  });

  it('keeps only the non-dedicated remainder in the generic yakuman award', () => {
    const chances = postProcess({
      hupai: [
        { name: '八連荘 [ツモ]', fanshu: '*' },
        { name: '大三元', fanshu: '*' },
      ],
      damanguan: 2,
    });

    expect(chances.filter((chance) => chance.name === '八連荘' || chance.name === '本役満アガリ')).toEqual([
      expect.objectContaining({ awardKey: 'yakuman:八連荘', baseChip: 140, count: 1 }),
      expect.objectContaining({ awardKey: 'yakuman:その他本役満', baseChip: 70, count: 1 }),
    ]);
  });

  it('keeps ordinary multiple yakuman at base 70 times the yakuman count', () => {
    const chances = postProcess({
      hupai: [
        { name: '大三元', fanshu: '*' },
        { name: '字一色', fanshu: '*' },
      ],
      damanguan: 2,
    });

    expect(chances.filter((chance) => chance.name === '本役満アガリ')).toEqual([
      expect.objectContaining({ awardKey: 'yakuman:その他本役満', baseChip: 70, count: 2 }),
    ]);
  });
});
