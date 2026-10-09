// 配牌の直後に親がリーチを宣言できる山を探す [online の e2e 用の固定山を作る道具]。
//   npx tsx tools/find_lizhi_pool.mts > tests/fixtures/lizhi_pool.json
// 山は seed つきの乱数で混ぜるので、同じ seed なら同じ山になる。
import { createRoomAuthority } from '../server/authority.ts';
import { defaultSanmaRule, generateTilePool } from '../src/lib/shan3.ts';

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const base = generateTilePool(defaultSanmaRule()).map(String);
for (let seed = 1; seed < 200000; seed += 1) {
  const rand = mulberry32(seed);
  const pool = [...base];
  for (let i = pool.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rand() * (i + 1));
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }
  const a: any = createRoomAuthority({ preShuffledPool: pool, qijia: 0 });
  const seat = a.currentPlayer();
  if (seat !== 0) continue;
  if (!a.game.canLizhi(seat)) continue;
  const hand = a.game.shoupai.get(seat);
  // 副露・花牌・ぽっち等の特殊牌を含まない素直な手だけ [UI の操作を単純にする]
  const tiles: string[] = hand.toString().split(/[,_]/);
  if (/[a-z]\d?[*_]|[fg]/.test(hand.toString())) continue;
  console.error('seed', seed, 'hand', hand.toString(), 'lizhi candidates', a.game.getLizhiCandidates(seat));
  console.log(JSON.stringify(pool));
  process.exit(0);
}
console.error('not found');
process.exit(1);
