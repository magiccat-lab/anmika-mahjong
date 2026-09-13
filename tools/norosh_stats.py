#!/usr/bin/env python3
"""norosh1 牌譜の統計 (エンジン不要の静的突き合わせ用)。

出力: 役ごとの翻の分布、符、ランク、チップ理由と枚数、サイコロ対象、
      流局時の点数移動、ゲーム終了時の順位チップ、ruleSet の分布。
使い方: python3 tools/norosh_stats.py [--limit N] > data/norosh/stats.txt
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
try:
    INDEX = json.load(open('data/norosh/index.json'))
except Exception:
    INDEX = {}
lim = None
if '--limit' in sys.argv:
    lim = int(sys.argv[sys.argv.index('--limit') + 1]); files = files[:lim]

rulesets = Counter()
yaku_han = defaultdict(Counter)          # yaku -> han counter (menzen/open 別)
fu_by = Counter()
rank_by = defaultdict(Counter)                       # (totalHan, fu) -> rankName/baseScore
chip_amount = defaultdict(Counter)        # reason (数字除去) -> chips counter
chip_payment = defaultdict(Counter)
dice_by = defaultdict(Counter)            # reason -> (baseChips, count)
ryukyoku_delta = Counter()                # tuple of score deltas
ryukyoku_chip_delta = Counter()
end_rank = Counter()                      # (sorted scores tuple class, rankChips tuple)
over = Counter(); consec = Counter(); dealerb = Counter()
tobi = Counter()
n_rounds = n_wins = 0
winner_open = Counter()
end_reason = Counter()
kinpei = Counter()

def canon(reason):
    return re.sub(r'[0-9０-９]+', 'N', reason)

for f in files:
    g = json.load(open(f))
    rs = g['rule']['options']['ruleSet']
    rulesets[json.dumps(rs, ensure_ascii=False, sort_keys=True)] += 1
    rounds = g['rounds']
    for i, r in enumerate(rounds):
        n_rounds += 1
        gs = r['initialState']['gameState']
        sr = r.get('scoreResults') or {}
        # 誰が鳴いたか (副露 = PON / KAN_ADDED / KAN_OPEN。KAN_CLOSED は門前扱い)
        opened = set()
        for a in r['actions']:
            if a['type'] in ('PON', 'KAN_ADDED', 'KAN_OPEN', 'CHI'):
                opened.add(a['playerId'])
        nxt = rounds[i + 1]['initialState']['gameState'] if i + 1 < len(rounds) else None
        if sr:
            for pid, res in sr.items():
                n_wins += 1
                is_open = int(pid) in opened
                winner_open[is_open] += 1
                for y in res['yaku']:
                    yaku_han[(y['name'], 'open' if is_open else 'menzen')][(y['han'], y.get('isYakuman'), y.get('yakumanCount'))] += 1
                fu_by[res['fu']] += 1
                rank_by[(res['totalHan'], res['fu'], res['isYakuman'], res['yakumanCount'])][(res['rankName'], res['baseScore'])] += 1
                if res.get('natsuNatsuKinpei'): kinpei[res['rankName']] += 1
                for b in res.get('basicChips', []):
                    chip_amount['basic:' + canon(b['reason'])][b['chips']] += 1
                    chip_payment['basic:' + canon(b['reason'])][b.get('payment')] += 1
                for b in res.get('bonusChips', []):
                    chip_amount['bonus:' + canon(b['reason'])][b['chips']] += 1
                    chip_payment['bonus:' + canon(b['reason'])][(b.get('payment'), b.get('isShubaExempt'))] += 1
                for d in res.get('diceChances', []):
                    dice_by[d['reason']][(d['baseChips'], d['count'], d.get('isShuba'))] += 1
        else:
            end_reason['no_score'] += 1
            if nxt:
                ds = tuple(nxt['players'][p]['score'] - gs['players'][p]['score'] for p in ('1', '2', '3'))
                dc = tuple(nxt['players'][p].get('chips', 0) - gs['players'][p].get('chips', 0) for p in ('1', '2', '3'))
                ryukyoku_delta[(ds, nxt['honba'] - gs['honba'], nxt.get('kyotaku', 0) - gs.get('kyotaku', 0), nxt.get('haruNashiCount'))] += 1
                ryukyoku_chip_delta[dc] += 1
    # ゲーム終了 (最終点は一覧 API の players[] にしか無い。index.json から引く)
    ps = (INDEX.get(g['gameId']) or {}).get('players') or []
    if not ps or not all(isinstance(p, dict) and 'score' in p for p in ps):
        continue
    scores = tuple(sorted((p['score'] for p in ps), reverse=True))
    ge = None
    # 最終局の次の gameState は無いので、ゲームの players[] と initialAllGameState.gameEndChipResult は前ゲームの物。ここでは順位ウマの推定だけ
    top_over = sum(1 for s in scores if s >= 40000)
    end_rank[(top_over, scores[0] >= 40000, scores[1] >= 40000)] += 1
    if min(scores) < 0: tobi[True] += 1
    else: tobi[False] += 1

print('files', len(files), 'rounds', n_rounds, 'wins', n_wins, 'winner open/menzen', dict(winner_open))
print('\n== ruleSets (count) ==')
for k, v in rulesets.most_common(): print(v, k[:400])
print('\n== yaku han (name, menzen/open) -> {(han,isYakuman,yakumanCount): n} ==')
for k in sorted(yaku_han): print(k, dict(yaku_han[k]))
print('\n== fu ==', dict(sorted(fu_by.items())))
print('\n== rank by (totalHan, fu, isYakuman, yakumanCount) ==')
for k in sorted(rank_by, key=lambda x: (x[2], x[3], x[0], x[1])): print(k, dict(rank_by[k]))
print('\n== natsuNatsuKinpei ranks ==', dict(kinpei))
print('\n== chips: reason -> {chips: n} / payment ==')
for k in sorted(chip_amount): print(k, dict(chip_amount[k]), dict(chip_payment[k]))
print('\n== dice chances: reason -> {(baseChips,count,isShuba): n} ==')
for k in sorted(dice_by): print(k, dict(dice_by[k]))
print('\n== ryukyoku: (score deltas p1..p3, honba delta, kyotaku delta, haruNashiCount) -> n ==')
for k, v in ryukyoku_delta.most_common(30): print(v, k)
print('ryukyoku chip deltas', ryukyoku_chip_delta.most_common(10))
print('\n== game end: (n >=40000, top>=40000, 2nd>=40000) ==', dict(end_rank), 'tobi', dict(tobi))
