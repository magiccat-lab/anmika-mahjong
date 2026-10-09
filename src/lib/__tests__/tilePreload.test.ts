import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { TILE_FILES } from '../tilePreload';

const root = resolve(__dirname, '../../..');

describe('tilePreload', () => {
  it('先に読む牌の一覧が public/tiles の絵と合っている [Front / Blank は使っていない]', () => {
    const onDisk = readdirSync(resolve(root, 'public/tiles'))
      .filter((f) => f.endsWith('.svg') && f !== 'Front.svg' && f !== 'Blank.svg')
      .sort();
    expect([...TILE_FILES].sort()).toEqual(onDisk);
  });

  it('Tile.svelte が名指しする絵は全部一覧にある', () => {
    const src = readFileSync(resolve(root, 'src/lib/Tile.svelte'), 'utf8');
    const named = [...src.matchAll(/'([A-Za-z0-9-]+\.svg)'/g)].map((m) => m[1]);
    expect(named.length).toBeGreaterThan(10);
    for (const f of named) expect(TILE_FILES).toContain(f);
  });
});
