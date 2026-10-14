// [2026-10-14 リョー「通常BGM切ってフィーバーだけONにする設定も用意したい」→「bgm、デフォはフィーバーだけにしておいて～」]
// 卓の「BGM」は フィーバーだけ (既定) → 入 → 切 → フィーバーだけ
import { describe, it, expect } from 'vitest';
import { DEFAULT_PREFS, bgmMode, nextBgmPrefs } from '../prefs';

describe('BGM の 3 段', () => {
  it('既定はフィーバーだけ', () => {
    expect(bgmMode(DEFAULT_PREFS)).toBe('fever');
  });
  it('フィーバーだけ → 入 → 切 → フィーバーだけ と回る', () => {
    let p = { ...DEFAULT_PREFS };
    p = nextBgmPrefs(p); expect(bgmMode(p)).toBe('on'); expect(p).toMatchObject({ bgmOff: false, normalBgmOn: true });
    p = nextBgmPrefs(p); expect(bgmMode(p)).toBe('off'); expect(p.bgmOff).toBe(true);
    p = nextBgmPrefs(p); expect(bgmMode(p)).toBe('fever'); expect(p).toMatchObject({ bgmOff: false, normalBgmOn: false });
  });
  it('前からの「BGM 切」(bgmOff) は切のまま', () => {
    expect(bgmMode({ bgmOff: true, normalBgmOn: false })).toBe('off');
  });
  it('他の設定は変えない', () => {
    const p = { ...DEFAULT_PREFS, muted: true, autoNuki: true };
    expect(nextBgmPrefs(p)).toMatchObject({ muted: true, autoNuki: true });
  });
});
