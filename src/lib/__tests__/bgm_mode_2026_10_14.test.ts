// [2026-10-14 リョー「通常BGM切ってフィーバーだけONにする設定も用意したい」] 卓の「BGM」は 入 → フィーバーだけ → 切 → 入
import { describe, it, expect } from 'vitest';
import { DEFAULT_PREFS, bgmMode, nextBgmPrefs } from '../prefs';

describe('BGM の 3 段', () => {
  it('入 → フィーバーだけ → 切 → 入 と回る', () => {
    let p = { ...DEFAULT_PREFS };
    expect(bgmMode(p)).toBe('on');
    p = nextBgmPrefs(p); expect(bgmMode(p)).toBe('fever'); expect(p).toMatchObject({ bgmOff: false, normalBgmOff: true });
    p = nextBgmPrefs(p); expect(bgmMode(p)).toBe('off'); expect(p.bgmOff).toBe(true);
    p = nextBgmPrefs(p); expect(bgmMode(p)).toBe('on'); expect(p).toMatchObject({ bgmOff: false, normalBgmOff: false });
  });
  it('前からの「BGM 切」(bgmOff だけ) は切のまま', () => {
    expect(bgmMode({ bgmOff: true, normalBgmOff: false })).toBe('off');
  });
  it('他の設定は変えない', () => {
    const p = { ...DEFAULT_PREFS, muted: true, autoNuki: true };
    expect(nextBgmPrefs(p)).toMatchObject({ muted: true, autoNuki: true });
  });
  it('既定は通常時も鳴らす', () => {
    expect(DEFAULT_PREFS.normalBgmOff).toBe(false);
  });
});
