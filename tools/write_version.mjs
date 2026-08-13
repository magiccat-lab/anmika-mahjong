#!/usr/bin/env node
// build 後に dist/version.json を吐く [SPA 長寿タブ対策。src/lib/versionWatch.ts が定期照合する]。
//
//   { "v": "1784823831160", "commit": "e920321", "builtAt": "2026-08-13T10:46:00.000Z" }
//
// client が比較するのは `v` だけ [= build ごとに必ず変わる ms timestamp]。
// commit / builtAt は devtools で「今どのバンドルを踏んでいるか」を人が読むための情報。
// git が無い環境でも build を落とさない [commit は 'unknown' になるだけ]。
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const distDir = path.join(root, 'dist');

function gitShortHash() {
  try {
    return execFileSync('git', ['rev-parse', '--short', 'HEAD'], {
      cwd: root,
      stdio: ['ignore', 'pipe', 'ignore'],
    })
      .toString()
      .trim();
  } catch {
    return 'unknown';
  }
}

const now = Date.now();
const payload = {
  v: String(now),
  commit: gitShortHash(),
  builtAt: new Date(now).toISOString(),
};

mkdirSync(distDir, { recursive: true });
const out = path.join(distDir, 'version.json');
writeFileSync(out, `${JSON.stringify(payload)}\n`);
console.log(`wrote ${path.relative(root, out)} ${JSON.stringify(payload)}`);
