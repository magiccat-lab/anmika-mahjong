#!/usr/bin/env python3
"""norosh1 牌譜: 勝者の華・北・金北・リーチ種別と rankName / チップの相関を出す (エンジン不要)。
使い方: python3 tools/norosh_flowers.py [--rows] > data/norosh/flowers.txt
"""
import json, glob, sys, sys, re
from collections import Counter, defaultdict

files = sorted(glob.glob('data/norosh/games/*.json'))
SANMA_ONLY = '--all' not in sys.argv   # 既定は三麻卓だけ (うちのエンジンは三麻)
def _is_sanma(path):
    try:
        return json.load(open(path))['rule']['options']['ruleSet'].get('variant') == 'sanma'
    except Exception:
        return False
if SANMA_ONLY:
    files = [f for f in files if _is_sanma(f)]
rows = []
for f in files:
    g = json.load(open(f))
    rounds = g['rounds']
    for i, r in enumerate(rounds):
        sr = r.get('scoreResults') or {}
        if not sr: continue
        gs = r['initialState']['gameState']
        acts = r['actions']
        fl = defaultdict(Counter); north = Counter(); gold_t = defaultdict(list); riichi = {}; opened = set(); win_type = {}
        kan = Counter()
        for a in acts:
            t = a['type']; p = a.get('playerId')
            if t == 'DRAW_FLOWER': fl[p][a['flower']['type']] += 1; fl[p]['fromDora'] += int(bool(a['flower'].get('isFromDora')))
            elif t == 'DRAW_NORTH': north[p] += 1
            elif t == 'GOLD_NORTH': gold_t[p].extend(x.get('effect') for x in a.get('targets', []))
            elif t == 'RIICHI': riichi[p] = ('shuba' if a.get('isShuba') else '') + ('open' if a.get('isOpen') else '') + ('fever' if a.get('isFever') else '') or 'plain'
            elif t in ('PON', 'KAN_ADDED', 'KAN_OPEN'): opened.add(p)
            elif t in ('KAN_CLOSED', 'KAN_ADDED', 'KAN_OPEN'): kan[p] += 1
            elif t in ('TSUMO', 'RON'): win_type[p] = t
        winter_act = any(a['type'] == 'WINTER_ACTIVATE' for a in acts)
        nxt = rounds[i + 1]['initialState']['gameState'] if i + 1 < len(rounds) else None
        for pid, res in sr.items():
            p = int(pid)
            delta = None
            if nxt:
                delta = {q: (nxt['players'][q]['score'] - gs['players'][q]['score'], nxt['players'][q].get('chips', 0) - gs['players'][q].get('chips', 0)) for q in ('1', '2', '3')}
            rows.append({
                'game': g['gameId'], 'round': r['round'], 'honba': r['honba'], 'winner': p, 'win': win_type.get(p), 'open': p in opened,
                'riichi': riichi.get(p), 'flowers': dict(fl[p]), 'north': north[p], 'gold': gold_t.get(p, []), 'winterAct': winter_act,
                'autumnCountStart': gs.get('autumnCount'), 'fever': (gs.get('fever') or {}).get('phase'),
                'han': res['totalHan'], 'fu': res['fu'], 'rank': res['rankName'], 'rankLevel': res['rankLevel'], 'base': res['baseScore'],
                'kinpei': res.get('natsuNatsuKinpei'),
                'basic': [(b['reason'], b['chips'], b['payment']) for b in res.get('basicChips', [])],
                'bonus': [(b['reason'], b['chips'], b['payment']) for b in res.get('bonusChips', [])],
                'dice': [(d['reason'], d['baseChips'], d['count']) for d in res.get('diceChances', [])],
                'delta': delta, 'nDice': len(r.get('diceResults') or []),
            })

if '--rows' in sys.argv:
    for x in rows: print(json.dumps(x, ensure_ascii=False))
    sys.exit()

print('wins', len(rows))
# 1. ランク: (han, fu) ごとに rankName と 秋の枚数 (勝者の秋 + extra_autumn)
def autumn(x): return x['flowers'].get('autumn', 0) + x['gold'].count('extra_autumn')
def summer(x): return x['flowers'].get('summer', 0) + x['gold'].count('double_rank_to_4x')
print('\n== rank vs (han, fu, autumn, summer, kinpei) ==')
tab = defaultdict(Counter)
for x in rows: tab[(x['han'], x['fu'], autumn(x), summer(x), bool(x['kinpei']))][(x['rank'], x['rankLevel'], x['base'])] += 1
for k in sorted(tab): print(k, dict(tab[k]))
# 2. 春チップ: 勝者の春枚数 + extra_spring と bonus 理由
print('\n== spring: (spring count, extra_spring, all flowers) -> bonus reasons with 春 ==')
tab = defaultdict(Counter)
for x in rows:
    sp = x['flowers'].get('spring', 0); ex = x['gold'].count('extra_spring'); allf = sum(v for k, v in x['flowers'].items() if k != 'fromDora')
    reasons = tuple(sorted((re.sub(r'\d+', 'N', b[0]), b[1]) for b in x['bonus'] if '春' in b[0]))
    tab[(sp, ex, allf, x['flowers'].get('fromDora', 0))][reasons] += 1
for k in sorted(tab): print(k, dict(tab[k]))
# 3. 冬チップ: 冬枚数, upper_lower, winterAct, 門前/鳴き, 順位?
print('\n== winter: (winter count, upper_lower, winterAct, open) -> 冬 chips ==')
tab = defaultdict(Counter)
for x in rows:
    w = x['flowers'].get('winter', 0); ul = x['gold'].count('upper_lower')
    ch = tuple(b[1] for b in x['bonus'] if b[0].startswith('冬'))
    tab[(w, ul, x['winterAct'], x['open'])][ch] += 1
for k in sorted(tab): print(k, dict(tab[k]))
# 4. 北チップと kitadora: 北枚数 -> (kitadora han, 北 chips)
print('\n== north: north count -> 北 chips / kitadora han ==')
tab = defaultdict(Counter)
for x in rows:
    ch = sum(b[1] for b in x['bonus'] if b[0].startswith('北'))
    tab[x['north']][ch] += 1
for k in sorted(tab): print(k, dict(tab[k]))
# 5. basic chips vs rank
print('\n== basic chips by rank / win type / open ==')
tab = defaultdict(Counter)
for x in rows: tab[(x['rank'].split('（')[0], x['win'], x['open'])][tuple((b[0].split('（')[0], b[1], b[2]) for b in x['basic'])] += 1
for k in sorted(tab): print(k, dict(tab[k]))
# 6. score delta vs base points (tsumo/ron, dealer?) 
print('\n== delta samples: (win, rank, honba, base) -> score deltas (winner, others) ==')
tab = defaultdict(Counter)
for x in rows:
    if not x['delta']: continue
    d = x['delta']; w = str(x['winner'])
    others = tuple(sorted(d[q][0] for q in d if q != w))
    tab[(x['win'], x['base'], x['honba'], x['nDice'] > 0)][(d[w][0], others)] += 1
for k in sorted(tab, key=str)[:60]: print(k, dict(tab[k]))
