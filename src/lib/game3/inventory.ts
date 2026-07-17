
// 全 116 枚 inventory 計算 [pure helper、 App.svelte L70-176 から抽出 2026-05-12]
// 山 + 王牌 + 手牌 + 副露 + 河 + 抜き華 + 抜きドラ を合算、
// 期待値 [赤/金/4 色ぽっち 別 key] と diff を返す。 z5g → z5 等の normalize 漏れ検出に使う。

import { toCorePai } from '../helpers';
import { matchesFulouMianzi } from '../fulouDisplay';
import { goldPaiFromCorePai } from './gold';
import { pochiPaiFromColor } from './pochi';

const PLAYERS = [0, 1, 2] as const;

export function computeTileInventory(g: any): Record<string, number> {
  const counts: Record<string, number> = {};
  const inc = (p: string) => { if (!p) return; counts[p] = (counts[p] ?? 0) + 1; };
  const decLocal = (local: Record<string, number>, p: string) => {
    if ((local[p] ?? 0) <= 0) return false;
    local[p] -= 1;
    return true;
  };
  const physicalFromLog = (meta: any, stripped: string): string | null => {
    const logged = meta?.pai;
    if ((logged === 'gp' || logged === 'gs' || logged === 'gN') && meta?.gold !== false) return logged;
    if (logged === 'z5b' || logged === 'z5r' || logged === 'z5g' || logged === 'z5y') return logged;
    if (logged === 'np3' || logged === 'ns3' || logged === 'nz3') return logged;
    if (meta?.gold) {
      const goldPai = goldPaiFromCorePai(stripped);
      if (goldPai) return goldPai;
    }
    if (meta?.pochi && toCorePai(stripped) === 'z5') {
      return pochiPaiFromColor(meta.pochi) ?? 'z5';
    }
    return null;
  };

  // shan._pai [live wall 専用、 R24 P2 #5/#12 fix 後]
  for (const p of ((g.shan as any)._pai ?? [])) inc(p);
  // R24 P2 #5/#12 fix: _rinshan が物理分離されたので individually count
  for (const p of ((g.shan as any)._rinshan ?? [])) inc(p);
  // _baopai / _fubaopai は 全 entry count [初期 2 枚も _pai から物理切出された ので count 必要]
  const _baopai = ((g.shan as any)._baopai ?? []) as string[];
  for (let i = 0; i < _baopai.length; i++) inc(_baopai[i]);
  const _fubaopai = ((g.shan as any)._fubaopai ?? []) as string[];
  for (let i = 0; i < _fubaopai.length; i++) inc(_fubaopai[i]);
  const _fuyuRevealed = ((g.shan as any)._fuyuRevealed ?? []) as string[];
  for (const p of _fuyuRevealed) inc(p);

  for (const pl of PLAYERS) {
    const sp = g.shoupai.get(pl);
    if (sp) {
      const x = sp._bingpai?.__anmika ?? null;
      for (const s of ['m', 'p', 's', 'z']) {
        const len = s === 'z' ? 8 : 10;
        for (let n = 0; n < len; n++) {
          let cnt = sp._bingpai[s][n] ?? 0;
          if (n === 0 && s === 'p') cnt -= x ? (x.gp ?? 0) : (g.goldHand[pl]?.p ?? 0);
          if (n === 0 && s === 's') cnt -= x ? (x.gs ?? 0) : (g.goldHand[pl]?.s ?? 0);
          if (n === 5 && s !== 'z') {
            cnt -= sp._bingpai[s][0] ?? 0;
          }
          if (n === 4 && s === 'z') cnt -= x ? (x.gN ?? 0) : (g.goldHand[pl]?.z ?? 0);
          if (s === 'z' && n === 5) continue;
          for (let k = 0; k < cnt; k++) inc(`${s}${n}`);
        }
      }
      if (x) {
        for (let k = 0; k < (x.gp ?? 0); k++) inc('gp');
        for (let k = 0; k < (x.gs ?? 0); k++) inc('gs');
        for (let k = 0; k < (x.gN ?? 0); k++) inc('gN');
        for (let k = 0; k < (x.z5b ?? 0); k++) inc('z5b');
        for (let k = 0; k < (x.z5r ?? 0); k++) inc('z5r');
        for (let k = 0; k < (x.z5g ?? 0); k++) inc('z5g');
        for (let k = 0; k < (x.z5y ?? 0); k++) inc('z5y');
        for (const nk of ['np3', 'ns3', 'nz3'] as const) {
          const nc = x[nk] ?? 0;
          if (nc > 0) {
            for (let k = 0; k < nc; k++) inc(nk);
            const coreKey = nk[1] + nk[2];
            counts[coreKey] = (counts[coreKey] ?? 0) - nc;
          }
        }
      } else {
        for (let k = 0; k < (g.goldHand[pl]?.p ?? 0); k++) inc('gp');
        for (let k = 0; k < (g.goldHand[pl]?.s ?? 0); k++) inc('gs');
        for (let k = 0; k < (g.goldHand[pl]?.z ?? 0); k++) inc('gN');
        const ph = g.pochiHand[pl] ?? { blue: 0, red: 0, green: 0, yellow: 0 };
        for (let k = 0; k < ph.blue; k++) inc('z5b');
        for (let k = 0; k < ph.red; k++) inc('z5r');
        for (let k = 0; k < ph.green; k++) inc('z5g');
        for (let k = 0; k < ph.yellow; k++) inc('z5y');
      }
      const openMeta = ((sp as any)._anmikaFulou ?? []) as Array<{ mianzi?: string; taken?: string }>;
      const physicalMeta = ((sp as any)._anmikaFulouPhysical ?? []) as Array<{ mianzi?: string; consumed?: string[] }>;
      const usedOpenMeta = new Set<number>();
      const usedPhysicalMeta = new Set<number>();
      for (const m of (sp._fulou ?? [])) {
        // majiang-core 表記: suite prefix 1 回 + 続く digit が各牌 [chi/pon/kan 共通]
        // 例: "m1-23" → m1, m2, m3 / "p444-" → p4, p4, p4 / "z5555_" → z5×4
        // marks [+=-_*] 除去後、 先頭が suite 文字、 残りが digit 列
        const stripped = (m as string).replace(/[\+=\-_*]/g, '');
        if (stripped.length < 2) continue;
        const suite = stripped[0];
        if (!'mpsz'.includes(suite)) continue;
        const local: Record<string, number> = {};
        for (let i = 1; i < stripped.length; i++) {
          const digit = stripped[i];
          const key = suite + digit;
          local[key] = (local[key] ?? 0) + 1;
        }
        const physicalMatches = physicalMeta
          .map((f, idx) => ({ f, idx }))
          .filter(({ f, idx }) => !usedPhysicalMeta.has(idx) && matchesFulouMianzi(f, String(m)));
        for (const { f, idx } of physicalMatches) {
          usedPhysicalMeta.add(idx);
          for (const p of f.consumed ?? []) {
            const core = toCorePai(p);
            if (decLocal(local, core)) inc(p);
          }
        }
        const openMatches = openMeta
          .map((f, idx) => ({ f, idx }))
          .filter(({ f, idx }) => !usedOpenMeta.has(idx) && matchesFulouMianzi(f, String(m)));
        for (const { f, idx } of openMatches) {
          usedOpenMeta.add(idx);
          const taken = f.taken;
          if (taken && taken !== toCorePai(taken)) {
            const core = toCorePai(taken);
            if (decLocal(local, core)) inc(taken);
          }
        }
        for (const [key, cnt] of Object.entries(local)) {
          // z5 の色が復元できない旧データは plain z5 として漏らさず、hard fuzz で metadata 欠落を拾う。
          if (key === 'z5') continue;
          for (let k = 0; k < cnt; k++) inc(key);
        }
      }
    }
    const dlog = g.discardLog[pl] ?? [];
    const he = g.he.get(pl);
    if (he?._pai) {
      const hePai = he._pai as string[];
      for (let i = 0; i < hePai.length; i++) {
        const raw = hePai[i];
        const isFulou = /[+=\-]/.test(raw);
        const stripped = raw.replace(/[+=\-_*]/g, '');
        const meta = dlog[i];
        // R15 P1 #4 fix: 鳴かれた牌 [mark あり] は 鳴いた player の _fulou で count 済 →
        // 通常牌は skip。特殊牌も _anmikaFulou / _anmikaFulouPhysical で復元済。
        if (isFulou) {
          continue;
        }
        inc(physicalFromLog(meta, stripped) ?? stripped);
      }
    }
    for (const hp of (g.huapai[pl] ?? [])) inc(hp);
    const nuki = g.nukidora[pl] ?? 0;
    const nukiG = (g as any).nukidoraGold?.[pl] ?? 0;
    for (let k = 0; k < nuki; k++) inc('z4');
    for (let k = 0; k < nukiG; k++) inc('gN');
  }
  return counts;
}

export function expectedInventory(): Record<string, number> {
  const exp: Record<string, number> = {};
  for (const n of [7, 9]) exp[`m${n}`] = 4;
  for (const s of ['p', 's']) for (let n = 1; n <= 9; n++) {
    if (n === 5) exp[`${s}${n}`] = 2;
    else if (n === 3) exp[`${s}${n}`] = 3;
    else exp[`${s}${n}`] = 4;
  }
  exp['np3'] = 1; exp['ns3'] = 1;
  exp['p0'] = 1; exp['gp'] = 1;
  exp['s0'] = 1; exp['gs'] = 1;
  for (let n = 1; n <= 7; n++) {
    if (n === 5) exp[`z${n}`] = 0;
    else if (n === 4) exp[`z${n}`] = 3;
    else if (n === 3) exp[`z${n}`] = 3;
    else exp[`z${n}`] = 4;
  }
  exp['gN'] = 1;
  exp['nz3'] = 1;
  for (const c of ['z5b', 'z5r', 'z5g', 'z5y']) exp[c] = 1;
  for (let n = 1; n <= 4; n++) exp[`f${n}`] = 2;
  return exp;
}

export type TileDiff = { pai: string; got: number; exp: number };

export function diffInventory(g: any): TileDiff[] {
  const got = computeTileInventory(g);
  const exp = expectedInventory();
  const diff: TileDiff[] = [];
  const allKeys = new Set([...Object.keys(got), ...Object.keys(exp)]);
  for (const k of Array.from(allKeys).sort()) {
    const a = got[k] ?? 0;
    const b = exp[k] ?? 0;
    if (a !== b) diff.push({ pai: k, got: a, exp: b });
  }
  return diff;
}
