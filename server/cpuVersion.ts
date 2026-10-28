// CPU の判断ロジックの版 [matches.cpu_version に焼く]。
//
// CPU が打った試合を後から「どの版の CPU か」で振り分けられるように、CPU の判断を
// 決めているソースの内容から短い印を作る。人が版数を手で上げる運用は忘れるので、
// ws server の起動時に sha256 を取る [server は src/ を直接 import して動くため、
// 起動中のコードとこのハッシュは必ず同じソースを指す]。ブラウザ側には出さない。
//
// 対象: src/lib/game3.ts と src/lib/game3/cpuValue.ts [テンパイの手の価値、10-28] と src/lib/store/cpu*.ts [cpuCall.ts を含む]。
// 並びはパス昇順、パス名も一緒にハッシュに入れる [ファイル名の入れ替えも版が変わる]。
import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

const LIB_DIR = fileURLToPath(new URL('../src/lib/', import.meta.url));

/** ハッシュ対象の src/lib からの相対パス [昇順] */
export function cpuSourceFiles(libDir: string = LIB_DIR): string[] {
  const store = readdirSync(join(libDir, 'store'))
    .filter((name) => /^cpu.*\.ts$/.test(name))
    .map((name) => `store/${name}`);
  const value = existsSync(join(libDir, 'game3/cpuValue.ts')) ? ['game3/cpuValue.ts'] : [];
  return ['game3.ts', ...value, ...store].sort();
}

/** sha256 の先頭 12 桁 [hex]。読めない時は null [記録を落とさないため呼び出し側は null を許す] */
export function computeCpuVersion(libDir: string = LIB_DIR): string | null {
  try {
    const hash = createHash('sha256');
    for (const rel of cpuSourceFiles(libDir)) {
      hash.update(`${rel}\n`);
      hash.update(readFileSync(join(libDir, rel)));
      hash.update('\n');
    }
    return hash.digest('hex').slice(0, 12);
  } catch {
    return null;
  }
}

let cached: string | null | undefined;

/** 起動中のプロセスで 1 回だけ計算する */
export function getCpuVersion(): string | null {
  if (cached === undefined) cached = computeCpuVersion();
  return cached;
}
