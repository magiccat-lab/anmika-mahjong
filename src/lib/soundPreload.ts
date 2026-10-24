// 効果音を卓に入る前に読んでおく [2026-10-24 リョー「なんかたまに演出とか音が遅れることがあるね」]
// 前は鳴らすたびに new Audio(src) で取りに行っていた。cloudflare 越しの取りは 1 本 0.6〜1.0 秒かかり、
// ブラウザの控えが切れた時 (max-age 4 時間 ・ 入れ替えの後) と、Cache-Control の付かない wav は毎回、
// その分だけ音と、音に合わせた演出が遅れていた。
// 入口・ロビーにいる間に全部を落として blob の URL にし、鳴らす時はそこから出す (取りに行かない)。
// 鳴らすのは今まで通り <audio> (Web Audio にすると iPhone のマナーモードで鳴らなくなる)
// 音を足したら public/sounds と一緒にここへ [載せ忘れても、最初の 1 回の後は手元から鳴る]

const FX = ['don', 'gashan', 'gyuiin', 'hazure', 'heart', 'kira', 'kyuin', 'pikiin', 'push', 'roll'];

export const SOUND_FILES: readonly string[] = [
  ...FX.map((n) => `/sounds/fx/${n}.mp3`),
  '/sounds/se_a.mp3', '/sounds/se_b.mp3', '/sounds/cutin.mp3',
  // 声とプレミアのサビは git に入れない (無ければ読めないだけ)
  '/sounds/voice/anmika_aori.wav', '/sounds/voice/anmika_yakuman.wav', '/sounds/bgm/premium_sabi.mp3',
];

const local = new Map<string, string>();
const loading = new Set<string>();
let started = false;

function load(src: string): void {
  if (local.has(src) || loading.has(src)) return;
  loading.add(src);
  fetch(src)
    .then((r) => (r.ok ? r.blob() : Promise.reject(new Error(`${r.status}`))))
    .then((b) => { local.set(src, URL.createObjectURL(b)); })
    .catch(() => { /* 読めなければ鳴らす時に取りに行く (今まで通り) */ })
    .finally(() => { loading.delete(src); });
}

export function preloadSounds(): void {
  if (started || typeof fetch === 'undefined' || typeof URL === 'undefined' || !URL.createObjectURL) return;
  started = true;
  for (const f of SOUND_FILES) load(f);
}

/** 読めていれば手元の URL、まだなら元の URL (次からは手元で鳴るよう読み始める) */
export function soundUrl(src: string): string {
  const hit = local.get(src);
  if (hit) return hit;
  if (started) load(src);
  return src;
}
