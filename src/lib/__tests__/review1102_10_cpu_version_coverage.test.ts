import { describe, it, expect } from 'vitest';
import { cpSync, mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { computeCpuVersion, cpuSourceFiles } from '../../../server/cpuVersion';

const LIB = fileURLToPath(new URL('../', import.meta.url));

describe('review 11-02 #10: cpu_version は CPU の判断を含むソースを全部覆う', () => {
  it('store.ts の下家 CPU 冬判定を変えると cpu_version が変わる', () => {
    const dir = mkdtempSync(join(tmpdir(), 'cpuver-review-'));
    try {
      cpSync(LIB, dir, { recursive: true });
      const before = computeCpuVersion(dir);
      const p = join(dir, 'store.ts');
      const src = readFileSync(p, 'utf8');
      const target = 'return { use: input.useNow > input.holdNow + continuation, pMore, continuation };';
      expect(src).toContain(target);
      // CPU の使う / 保留 の判断を反転
      writeFileSync(p, src.replace(target, 'return { use: !(input.useNow > input.holdNow + continuation), pMore, continuation };'));
      const after = computeCpuVersion(dir);
      expect(cpuSourceFiles(dir)).toContain('store.ts');
      expect(after).not.toBe(before);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
  it('online CPU の鳴き設定 (server/authority.ts feverSkip) も対象', () => {
    const files = cpuSourceFiles();
    const authority = readFileSync(fileURLToPath(new URL('../../../server/authority.ts', import.meta.url)), 'utf8');
    expect(authority).toContain('feverSkip: true');
    expect(files).toContain('server/authority.ts');
    expect(files).toContain('store.ts');
  });
});
