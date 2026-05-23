import { describe, it, expect } from 'vitest';
import { parseMianzi, parseFulouList, fulouFlatTiles, isNakiHePai } from '../fulouDisplay';

describe('fulouDisplay.parseMianzi', () => {
  describe('F2: pon (3 牌副露) の 方向 mark → rotateIdx', () => {
    it('上家 [+] からのポン → 左端 [rotateIdx=0]', () => {
      const r = parseMianzi('m111+');
      expect(r.tiles).toEqual(['m1', 'm1', 'm1']);
      expect(r.rotateIdx).toBe(0);
      expect(r.kakanTile).toBeNull();
    });

    it('下家 [-] からのポン → 右端 [rotateIdx=2]', () => {
      const r = parseMianzi('m111-');
      expect(r.tiles).toEqual(['m1', 'm1', 'm1']);
      expect(r.rotateIdx).toBe(2);
      expect(r.kakanTile).toBeNull();
    });

    it('対面 [=] [3麻なし、 logic 健全性] → 中央 [rotateIdx=1]', () => {
      const r = parseMianzi('p333=');
      expect(r.tiles).toEqual(['p3', 'p3', 'p3']);
      expect(r.rotateIdx).toBe(1);
    });

    it('赤 5 を含むポン [上家] も tiles に正しく展開', () => {
      const r = parseMianzi('p005+');
      expect(r.tiles).toEqual(['p0', 'p0', 'p5']);
      expect(r.rotateIdx).toBe(0);
    });
  });

  describe('F2: minkan / ankan / kakan', () => {
    it('明槓 [+] 4 枚 + mark 末尾 → 全 4 枚 + rotateIdx', () => {
      const r = parseMianzi('s2222-');
      expect(r.tiles).toEqual(['s2', 's2', 's2', 's2']);
      expect(r.rotateIdx).toBe(2);
      expect(r.kakanTile).toBeNull();
    });

    it('暗槓 [mark なし] → rotateIdx=null [全縦]', () => {
      const r = parseMianzi('z1111');
      expect(r.tiles).toEqual(['z1', 'z1', 'z1', 'z1']);
      expect(r.rotateIdx).toBeNull();
      expect(r.kakanTile).toBeNull();
    });

    it('加槓 [上家ポン → カン] m111+1 → 元 pon 3 枚 + kakanTile', () => {
      const r = parseMianzi('m111+1');
      expect(r.tiles).toEqual(['m1', 'm1', 'm1']);
      expect(r.rotateIdx).toBe(0);
      expect(r.kakanTile).toBe('m1');
    });

    it('加槓 [下家ポン → カン] m111-1 → rotateIdx=2 + kakanTile', () => {
      const r = parseMianzi('p555-5');
      expect(r.tiles).toEqual(['p5', 'p5', 'p5']);
      expect(r.rotateIdx).toBe(2);
      expect(r.kakanTile).toBe('p5');
    });
  });

  describe('parseFulouList / fulouFlatTiles', () => {
    it('複数 mianzi を一括 parse', () => {
      const r = parseFulouList(['m111+', 'p333-', 's5555']);
      expect(r).toHaveLength(3);
      expect(r[0].rotateIdx).toBe(0);
      expect(r[1].rotateIdx).toBe(2);
      expect(r[2].rotateIdx).toBeNull();
    });

    it('null / undefined 安全', () => {
      expect(parseFulouList(null)).toEqual([]);
      expect(parseFulouList(undefined)).toEqual([]);
      expect(fulouFlatTiles(null)).toEqual([]);
    });

    it('fulouFlatTiles は 加槓 tile も含めて flat 化 [countDora 用]', () => {
      const flat = fulouFlatTiles(['m111+1', 'p333-']);
      expect(flat).toEqual(['m1', 'm1', 'm1', 'm1', 'p3', 'p3', 'p3']);
    });
  });

  describe('F1: isNakiHePai 副露 marker 検出', () => {
    it('plain な tile は false', () => {
      expect(isNakiHePai('m1')).toBe(false);
      expect(isNakiHePai('p5')).toBe(false);
      expect(isNakiHePai('z3_')).toBe(false); // ツモ切り marker は naki ではない
    });

    it('+ / = / - のいずれかが含まれれば true [鳴かれた tile]', () => {
      expect(isNakiHePai('m1+')).toBe(true);
      expect(isNakiHePai('p5=')).toBe(true);
      expect(isNakiHePai('s7-')).toBe(true);
    });

    it('リーチ宣言牌 [__] でも 副露 marker があれば true', () => {
      expect(isNakiHePai('z1+__')).toBe(true);
    });
  });
});
