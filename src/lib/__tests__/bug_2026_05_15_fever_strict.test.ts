import { describe, it, expect } from 'vitest';
// @ts-ignore - majiang-core 型定義なし
import Majiang from '@kobalab/majiang-core';
import { canFeverLizhi } from '../game3/feverLizhi';

// 2026-05-15 リョー指摘 [厳密版]:
// 「フィーバーの確定アンコ、 可能な限り厳密に」
// 旧簡易判定 [同 suit に 5/6/0 1 枚でもあれば reject] では false positive あり。
// 新版: majiang-core hule_mianzi で 全テンパイ和了解 を列挙、
// 全解で `${s}777` 暗刻が必ず存在する場合のみ OK。
//
// 注: 「p7×3 + p5 のみ + 他」 でも 待ちに p6 [カンチャン] が混ざれば
//     p6-win 解 で p7 が 順子に使われる → strict 不可 になり得る。
//     strict は wait 列挙 + 各 wait 全解 の 厳密 check で判定する。

function sp(paistr: string): any {
  return Majiang.Shoupai.fromString(paistr);
}

describe('canFeverLizhi - 厳密判定 [hule_mianzi 全解 check]', () => {
  it('救済 1: m999 s999 z11 p55777 [p5×2 + p7×3、 wait p5/z1、 両解 p777 kotsu] → 厳密 OK', () => {
    // 旧簡易は p5 が手にあれば reject していたが、
    // p55 雀頭 + p777 kotsu の構造で 全解 [p5-win も z1-win も] p7 暗刻維持。
    const r = canFeverLizhi(sp('m999s999z11p55777'));
    expect(r.ok).toBe(true);
    expect(r.tiles).toEqual(['p7']);
  });

  it('救済 2: m999 s999 z11 p66777 [p6×2 + p7×3、 wait p6/z1、 両解 p777 kotsu] → 厳密 OK', () => {
    const r = canFeverLizhi(sp('m999s999z11p66777'));
    expect(r.ok).toBe(true);
    expect(r.tiles).toEqual(['p7']);
  });

  it('救済 3: m999 s99 z11 p567777 [wait s9/z1、 両解で p567 + p777 構造、 p7 kotsu 維持] → 厳密 OK', () => {
    // 注: p5+p6+p7×4 と 4 枚あるが、 wait/構造上 p567 順子 + p777 kotsu が固定
    // 旧簡易は p5/p6 在で reject だったが、 strict は OK と判定
    const r = canFeverLizhi(sp('p567777m999s99z11'));
    expect(r.ok).toBe(true);
    expect(r.tiles).toEqual(['p7']);
  });

  it('reject 1: m777999 s999 p5777 [wait p5/p6、 p6-win で p567 順子余地] → 厳密 不可', () => {
    // p5 タンキ wait + p6 カンチャン wait の両方が立つ。
    // p6-win 解: m777, m999, s999, p77 [雀頭], p567 → p7 が 順子に使われる
    // → 全解で p7 kotsu とは言えず strict reject
    const r = canFeverLizhi(sp('m777999s999p5777'));
    // ただし m7×3 は m999 のみで m5/m6 不在 → m7 暗刻 確定
    expect(r.ok).toBe(true);
    expect(r.tiles).toContain('m7');
    expect(r.tiles).not.toContain('p7');
  });

  it('reject 2: m999 s999 z11 p77789 [wait p7/z1、 z1-win で p789 順子] → p7 strict 不可', () => {
    // z1-win 解: p77 雀頭 + p789 順子 + 3 melds → p7 kotsu なし
    // よって p7 strict reject。 m7 暗刻なし、 fever 不成立。
    const r = canFeverLizhi(sp('m999s999z11p77789'));
    expect(r.ok).toBe(false);
  });

  it('reject 3 改訂 [2026-05-15 bug B]: p7×4 + p4 + p5 + p6 → 4 枚保持で 確定 OK [567 余地あっても 1 順子分消費後 残 3 枚]', () => {
    // 旧仕様: hule_mianzi 解 0 + lenient で 5/6/0 在 → reject
    // 新仕様 [2026-05-15 リョー指示]: handCount + ankanCount >= 4 で 早期 ok=true、
    //   理由: 同 suit 7 が 計 4 枚あれば 順子 1 つで 1 枚消費しても残 3 枚は 必ず 暗刻。
    const r = canFeverLizhi(sp('p4567777m99s99z11'));
    expect(r.ok).toBe(true);
    expect(r.tiles).toContain('p7');
  });

  it('単純 OK: m777999 s999 p4777 [wait p4 のみ、 唯一解 p777 kotsu] → 厳密 OK', () => {
    // p4×1 は手にあるが 4 と 7 で 順子組めない、 strict 通る
    const r = canFeverLizhi(sp('m777999s999p4777'));
    expect(r.ok).toBe(true);
    expect(r.tiles).toContain('m7');
    expect(r.tiles).toContain('p7');
  });

  it('ankan 確定: 副露 p7777 + 手 m777999 s999 p5 [wait p5、 p7777 維持] → 厳密 OK', () => {
    const shoupai = sp('m777999s999p5,p7777');
    const r = canFeverLizhi(shoupai);
    expect(r.ok).toBe(true);
    expect(r.tiles).toContain('p7');
    expect(r.tiles).toContain('m7');
  });

  it('ankan 確定 [単独]: 副露 p7777 のみ + 手に同 suit 5/6 あっても OK', () => {
    // ankan は 確定暗刻、 手の 5/6 は無関係
    const shoupai = sp('m999s999z11p5,p7777');
    const r = canFeverLizhi(shoupai);
    expect(r.ok).toBe(true);
    expect(r.tiles).toContain('p7');
  });

  it('lenient fallback: clone なし mock + p5 在 → 旧 簡易判定 で reject', () => {
    const mock: any = {
      _bingpai: { m: [0], p: [0, 0, 0, 0, 0, 1, 0, 3], s: [0] },
      _fulou: [],
    };
    const r = canFeverLizhi(mock);
    expect(r.ok).toBe(false);
  });

  it('lenient fallback: clone なし mock + 5/6/0 不在 → 旧 簡易判定 で OK', () => {
    const mock: any = {
      _bingpai: { m: [0, 0, 0, 0, 0, 0, 0, 3], p: [0], s: [0] },
      _fulou: [],
    };
    const r = canFeverLizhi(mock);
    expect(r.ok).toBe(true);
    expect(r.tiles).toEqual(['m7']);
  });

  it('複合: m777 m999 s999 z111 + p7×0 → m7 暗刻 1 種、 tier 1', () => {
    // m=6, s=3, z=3, p=0 = 12 → 不足、 別構成
    // m777 p123 s123 z111 z2 = 3+3+3+3+1 = 13、 z2 タンキ
    const shoupai = sp('m777p123s123z1112');
    const r = canFeverLizhi(shoupai);
    expect(r.ok).toBe(true);
    expect(r.tiles).toEqual(['m7']);
    expect(r.tier).toBe(1);
  });

  it('複合: m7×3 + p7×3、 両方 strict OK → tier 2', () => {
    // m777 p777 s999 z111 z2 = 3+3+3+3+1 = 13、 z2 タンキ
    const shoupai = sp('m777p777s999z1112');
    const r = canFeverLizhi(shoupai);
    expect(r.ok).toBe(true);
    expect(r.tiles).toEqual(['m7', 'p7']);
    expect(r.tier).toBe(2);
  });
});
