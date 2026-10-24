/**
 * 画面の設定 [端末ごと]。localStorage に持つだけで、対局の中身には触らない。
 * [2026-09-14 リョー「UI とか他のいろんな改善も検討してよ」→「全部やっといて」]
 *
 * ここに置いてよいのは「見え方と手数」だけ。ルールや点数に効くものは入れない。
 */
import { writable, type Writable } from 'svelte/store';
import { soundUrl } from './soundPreload';

export interface Prefs {
  /** 効果音を鳴らさない。 */
  muted: boolean;
  /** 対局中も山構成を開けるようにする [牌譜検討用]。 */
  showWall: boolean;
  /** 色覚多様性向け: ぽっちの色と赤金に記号を重ねる。 */
  colorAssist: boolean;
  /** 自分の手番で抜ける華牌 / 北があれば自動で抜く。 */
  autoNuki: boolean;
  /** BGM (通常の 8bit 版とフィーバー中の原曲のアンミカーニバル) を流さない。卓の「BGM」で切り替える [2026-10-14 リョー「BGM音量操作トグルは付けて良いな、見える位置に」]。 */
  bgmOff: boolean;
  /** 通常時の 8bit 版も流す。既定は流さない (フィーバー中の原曲だけ)。卓の「BGM」は フィーバーだけ → 入 → 切 の順に替わる
   *  [2026-10-14 リョー「通常BGM切ってフィーバーだけONにする設定も用意したい」→「bgm、デフォはフィーバーだけにしておいて～」。
   *  最初は normalBgmOff (既定 false) で出したが、既定を変える時に保存済みの false が残るので名前ごと替えた]。 */
  normalBgmOn: boolean;
  /** 4 人回しの「部屋チップ」の帯を出さない。帯の × でも隠せる [2026-10-24 リョー「部屋チップって表示も消せるようにして」]。 */
  hideRoomChip: boolean;
}

export const DEFAULT_PREFS: Prefs = {
  muted: false,
  showWall: false,
  colorAssist: false,
  autoNuki: false,
  bgmOff: false,
  normalBgmOn: false,
  hideRoomChip: false,
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
    const audio = new Audio(soundUrl(src));
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

/** 卓の「BGM」ボタンの 3 段。フィーバーだけ (既定) → 入 (通常時も) → 切 → フィーバーだけ */
export type BgmMode = 'on' | 'fever' | 'off';
export function bgmMode(p: Pick<Prefs, 'bgmOff' | 'normalBgmOn'>): BgmMode {
  if (p.bgmOff) return 'off';
  return p.normalBgmOn ? 'on' : 'fever';
}
export function nextBgmPrefs(p: Prefs): Prefs {
  const m = bgmMode(p);
  if (m === 'fever') return { ...p, bgmOff: false, normalBgmOn: true };
  if (m === 'on') return { ...p, bgmOff: true, normalBgmOn: false };
  return { ...p, bgmOff: false, normalBgmOn: false };
}
