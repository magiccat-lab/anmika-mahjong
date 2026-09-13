#!/usr/bin/env python3
"""norosh1 牌譜: 対局終了時のチップ (順位ウマ・8万超・連勝・親ボーナス) を、同セッションの次対局の
initialAllGameState.gameEndChipResult と突き合わせて式を推定する (エンジン不要)。
使い方: python3 tools/norosh_gameend.py
"""
import json, glob, sys
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
idx = json.load(open('data/norosh/index.json'))
games = {}
for f in files:
    g = json.load(open(f))
    games[g['gameId']] = g
# セッション鎖: 同じ名前集合 + gameCount 連番 + recordedAt 順
by_names = defaultdict(list)
for gid, g in games.items():
    names = tuple(sorted(v for v in g['players'].values() if v))
    by_names[names].append((g['recordedAt'], g['gameCount'], gid))
pairs = []
for names, lst in by_names.items():
    lst.sort()
    for a, b in zip(lst, lst[1:]):
        if b[1] == a[1] + 1:
            pairs.append((a[2], b[2]))
print('games', len(games), 'session pairs', len(pairs))

uma = Counter(); over = Counter(); consec = Counter(); dealer = Counter(); changes_ok = Counter()
rows = []
for gid, nid in pairs:
    g, n = games[gid], games[nid]
    ge = n['initialAllGameState'].get('gameEndChipResult') or {}
    ps = (idx.get(gid) or {}).get('players') or []
    if not ps or not ge: continue
    seat_score = {str(p['seatId']): p['score'] for p in ps}
    seat_rank = {str(p['seatId']): p['rank'] for p in ps}
    scores_sorted = sorted(seat_score.values(), reverse=True)
    top, second = scores_sorted[0], scores_sorted[1]
    rc = ge.get('rankChips', {})
    by_rank = tuple(rc.get(s, 0) for s in sorted(seat_rank, key=lambda s: seat_rank[s]))
    uma[(top >= 40000, second >= 40000, by_rank)] += 1
    oc = ge.get('overScoreChips', {})
    over[(top, tuple(oc.get(s, 0) for s in sorted(seat_rank, key=lambda s: seat_rank[s])))] += 1
    cw = n['initialAllGameState'].get('consecutiveWins') or {}
    cc = ge.get('consecutiveChips', {})
    top_seat = min(seat_rank, key=lambda s: seat_rank[s]); top_name = g['players'][top_seat]
    consec[(cw.get(top_name), tuple(cc.get(s, 0) for s in sorted(seat_rank, key=lambda s: seat_rank[s])))] += 1
    db = ge.get('dealerBonusChips', {})
    dealer[tuple(db.get(s, 0) for s in sorted(seat_rank, key=lambda s: seat_rank[s]))] += 1
    ch = ge.get('changes', {})
    changes_ok[all(ch.get(s, 0) == rc.get(s, 0) + oc.get(s, 0) + cc.get(s, 0) + db.get(s, 0) for s in ('1', '2', '3'))] += 1
print('\n== rankChips by (top>=40000, 2nd>=40000) -> chips (1st,2nd,3rd) ==')
for k, v in sorted(uma.items(), key=lambda x: -x[1]): print(v, k)
print('\n== overScoreChips by top score -> (1st,2nd,3rd) ==')
for k, v in sorted(over.items()): print(v, k)
print('\n== consecutiveChips by (top player consecutiveWins after game) -> (1st,2nd,3rd) ==')
for k, v in sorted(consec.items(), key=lambda x: (str(x[0][0]), x[0][1])): print(v, k)
print('\n== dealerBonusChips (1st,2nd,3rd) ==', dict(dealer))
print('changes == sum of parts:', dict(changes_ok))
