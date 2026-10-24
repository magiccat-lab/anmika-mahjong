import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { SOUND_FILES, soundUrl } from '../soundPreload';

const root = resolve(__dirname, '../../..');

describe('soundPreload', () => {
  it('先に読む音の一覧に public/sounds/fx の効果音が全部ある', () => {
    const fx = readdirSync(resolve(root, 'public/sounds/fx')).filter((f) => f.endsWith('.mp3'));
    expect(fx.length).toBeGreaterThan(5);
    for (const f of fx) expect(SOUND_FILES).toContain(`/sounds/fx/${f}`);
  });

  it('画面が名指しする効果音 (fx 以外) は全部一覧にある [BGM の曲は除く]', () => {
    const files = ['App.svelte', 'lib/PochiSqueeze.svelte', 'lib/PochiRevealModal.svelte', 'lib/SaiKoroModal.svelte', 'lib/FreezeFx.svelte'];
    const named = files.flatMap((f) => [...readFileSync(resolve(root, 'src', f), 'utf8').matchAll(/'(\/sounds\/[^'?]+\.(?:mp3|wav))'/g)].map((m) => m[1]))
      .filter((p) => !p.startsWith('/sounds/bgm/anmika_carnival'));
    expect(named.length).toBeGreaterThan(4);
    for (const p of named) expect(SOUND_FILES).toContain(p);
  });

  it('読む前は元の URL を返す [鳴らせないより遅れて鳴る方がよい]', () => {
    expect(soundUrl('/sounds/fx/don.mp3')).toBe('/sounds/fx/don.mp3');
  });
});
