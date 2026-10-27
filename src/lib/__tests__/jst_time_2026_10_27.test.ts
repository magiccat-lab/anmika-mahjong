import { describe, expect, it } from 'vitest';
import { utcToJst } from '../jstTime';

describe('utcToJst', () => {
  it('DB の UTC を JST にして日付も繰り上げる', () => {
    expect(utcToJst('2026-10-26 18:26:43')).toBe('2026-10-27 03:26');
    expect(utcToJst('2026-12-31 15:00:00')).toBe('2027-01-01 00:00');
    expect(utcToJst('2026-10-27 01:05:09')).toBe('2026-10-27 10:05');
  });
  it('空や形の違う値はそのまま', () => {
    expect(utcToJst('')).toBe('');
    expect(utcToJst(undefined)).toBe('');
    expect(utcToJst('all')).toBe('all');
  });
});
