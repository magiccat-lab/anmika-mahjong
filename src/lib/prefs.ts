/**
 * 画面の設定 [端末ごと]。localStorage に持つだけで、対局の中身には触らない。
 * [2026-09-14 リョー「UI とか他のいろんな改善も検討してよ」→「全部やっといて」]
 *
 * ここに置いてよいのは「見え方と手数」だけ。ルールや点数に効くものは入れない。
 */
import { writable, type Writable } from 'svelte/store';

export interface Prefs {
  /** 効果音を鳴らさない。 */
  muted: boolean;
  /** 対局中も山構成を開けるようにする [牌譜検討用]。 */
  showWall: boolean;
  /** 色覚多様性向け: ぽっちの色と赤金に記号を重ねる。 */
  colorAssist: boolean;
  /** 自分の手番で抜ける華牌 / 北があれば自動で抜く。 */
  autoNuki: boolean;
}

export const DEFAULT_PREFS: Prefs = {
  muted: false,
  showWall: false,
  colorAssist: false,
  autoNuki: false,
};

const KEY = 'anmika.prefs.v1';

function load(): Prefs {
  if (typeof localStorage === 'undefined') return { ...DEFAULT_PREFS };
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return { ...DEFAULT_PREFS };
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return { ...DEFAULT_PREFS };
    // 知らないキーは捨てる。既定値に無いものを持ち込ませない。
    const out = { ...DEFAULT_PREFS };
    for (const k of Object.keys(DEFAULT_PREFS) as Array<keyof Prefs>) {
      if (typeof parsed[k] === 'boolean') out[k] = parsed[k];
    }
    return out;
  } catch {
    return { ...DEFAULT_PREFS };
  }
}

function persist(value: Prefs): void {
  if (typeof localStorage === 'undefined') return;
  try { localStorage.setItem(KEY, JSON.stringify(value)); } catch { /* 保存できなくても動く */ }
}

function createPrefs(): Writable<Prefs> & { toggle: (key: keyof Prefs) => void } {
  const store = writable<Prefs>(load());
  const { subscribe, set, update } = store;
  return {
    subscribe,
    set: (v: Prefs) => { persist(v); set(v); },
    update: (fn: (v: Prefs) => Prefs) => update((v) => { const next = fn(v); persist(next); return next; }),
    toggle: (key: keyof Prefs) => update((v) => { const next = { ...v, [key]: !v[key] }; persist(next); return next; }),
  };
}

export const prefs = createPrefs();

/** 効果音の入口。ミュート中は何もしない。再生できない環境でも落とさない。 */
export function playSound(src: string, volume = 1): HTMLAudioElement | null {
  let muted = false;
  const unsub = prefs.subscribe((v) => { muted = v.muted; });
  unsub();
  if (muted) return null;
  try {
    const audio = new Audio(src);
    audio.volume = volume;
    void audio.play().catch(() => { /* 自動再生が拒否されることがある */ });
    return audio;
  } catch {
    return null;
  }
}

/**
 * ルールの版数。**裁定を変えたら必ず上げる。**
 * 牌譜に焼き込んで、あとからルールを変えた時に「どのルールで打たれた牌譜か」を
 * 見失わないようにする [2026-09-14。公開リンクを配るようになったので必要になった]。
 *
 * 履歴:
 * - anmika-1.0.0 … 2026-09-14 時点。7萬の符を么九扱いにした / 超過ハン祝儀を数え役満にも /
 *   嵌八萬を超過ハンの母数で 8 翻 / 神ぽっちのドラを表裏で分ける、までを含む
 */
export { ANMIKA_RULE_VERSION } from './ruleVersion';
