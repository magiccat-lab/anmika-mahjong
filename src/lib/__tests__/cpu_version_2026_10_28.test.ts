// 2026-10-28 matches.cpu_version: CPU 判断ソースの sha256 先頭 12 桁
import { describe, it, expect } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { computeCpuVersion, cpuSourceFiles, getCpuVersion } from '../../../server/cpuVersion';

function fakeLib(files: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), 'cpuver-'));
  mkdirSync(join(dir, 'store'));
  for (const [rel, body] of Object.entries(files)) writeFileSync(join(dir, rel), body);
  return dir;
}

describe('cpuVersion', () => {
  it('実ソースでは game3.ts / cpu*.ts [cpuCall.ts を含む] を昇順に拾う', () => {
    const files = cpuSourceFiles();
    expect(files[0]).toBe('game3.ts');
    expect(files).toContain('store/cpuCall.ts');
    expect(files).toContain('store/cpuFever.ts');
    expect([...files].sort()).toEqual(files);
    expect(getCpuVersion()).toMatch(/^[0-9a-f]{12}$/);
    expect(getCpuVersion()).toBe(computeCpuVersion());
  });

  it('中身が変わると版が変わり、同じなら同じ', () => {
    const a = fakeLib({ 'game3.ts': 'a', 'store/cpuX.ts': 'b', 'store/other.ts': 'zzz' });
    const b = fakeLib({ 'game3.ts': 'a', 'store/cpuX.ts': 'b', 'store/other.ts': 'different' });
    const c = fakeLib({ 'game3.ts': 'a', 'store/cpuX.ts': 'B', 'store/other.ts': 'zzz' });
    try {
      expect(computeCpuVersion(a)).toMatch(/^[0-9a-f]{12}$/);
      // cpu*.ts 以外は版に影響しない
      expect(computeCpuVersion(b)).toBe(computeCpuVersion(a));
      expect(computeCpuVersion(c)).not.toBe(computeCpuVersion(a));
    } finally {
      for (const d of [a, b, c]) rmSync(d, { recursive: true, force: true });
    }
  });

  it('読めない時は null [記録を落とさない]', () => {
    expect(computeCpuVersion('/nonexistent-dir-for-cpuver')).toBeNull();
  });
});
