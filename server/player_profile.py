"""オンミカの人別の運と腕 [2026-10-27 osamu]。リョー「対人戦の人別分析…運指標と腕指標整理して並べたい」を
review ページで OK → 「これをオンミカのサイト上で見れるようにしてね」で /api/stats/profile に移した。
元は secretary repo の scripts/anmika_player_profile.py (同じ数を出す)。DB は全部読むだけ。

人ごとに 全部 ・ 対人戦 (3 席とも人) ・ CPU 戦 の 3 つに分けて数える。
  ・チップ収支 ・ 順位 ・ 和了 ・ 放銃 ・ リーチ: stats DB の matches.chip_delta_json と match_player_stats (DB の直しは chip_delta にだけ入る)
  ・サイコロ: ws の記録 (room_accepted_commands)。selectSaiKoroCombo から advanceSaiKoro までの command の
    _roomChipDelta を席ごとに足す。振った人の分だけでなく、他人のサイコロで払った ・ 貰った分も入る (3 人の和は 0)
  ・打牌: 部屋のまとめ (summaries/*/data.json) の discard_review.by_player (CPU と同じ打牌の率 ・ 降りの率)
"""
from __future__ import annotations

import collections
import glob
import json
import sqlite3
from pathlib import Path

KINDS = ('all', 'pvp', 'cpu')


def ro(path):
    c = sqlite3.connect(f'file:{path}?mode=ro', uri=True)
    c.row_factory = sqlite3.Row
    return c


def blank():
    return collections.Counter()


def compute(stats_db, ws_db, summaries):
    """人ごとの {all, pvp, cpu} の生カウント。率は client で出す"""
    s = ro(stats_db)
    names = {r['user_id']: r['n'] for r in s.execute("select user_id, coalesce(nullif(display_name, ''), username) as n from users")}
    # 部屋の途中で座る人が替わる事がある (ZOGE は 4 人が入れ替わり) ので、席と人 ・ 対人戦かは試合ごとに持つ
    room_kind, match_seats = {}, {}
    P = collections.defaultdict(lambda: {k: blank() for k in KINDS})
    for m in s.execute('select match_id, room_id, match_no, members_json, chip_delta_json from matches'):
        members = json.loads(m['members_json'])
        kind = 'cpu' if any(str(x['user_id']).startswith('CPU') for x in members) else 'pvp'
        room_kind[m['room_id']] = kind
        # NH49 (1 試合) だけ members に seat が無い。その時は ws の部屋の開始時の席で埋める (下)
        seats = {int(x['seat']): str(x['user_id']) for x in members} if all('seat' in x for x in members) else None
        match_seats[(m['room_id'], m['match_no'])] = (seats, kind)
        chips = json.loads(m['chip_delta_json'])
        # チップは抜け番の人 (4 人部屋で座っていない 1 人) にも付く。抜け番の試合は sitout に数える
        played = set()
        for st in s.execute('select * from match_player_stats where match_id=?', (m['match_id'],)):
            u = st['user_id']
            played.add(u)
            if u.startswith('CPU'):
                continue
            for k in ('all', kind):
                c = P[u][k]
                c['matches'] += 1
                for f in ('rounds', 'riichi', 'fever_riichi', 'furo_rounds', 'nuki', 'wins', 'tsumo_wins', 'ron_wins',
                          'deal_ins', 'points_won', 'points_dealt_in', 'hule_chips'):
                    c[f] += st[f] or 0
                if st['placement']:
                    c['place_sum'] += st['placement']
                    c['placed'] += 1
                    c[f'place{st["placement"]}'] += 1
        for u, v in chips.items():
            if u.startswith('CPU'):
                continue
            for k in ('all', kind):
                P[u][k]['chip'] += int(v)
                if u not in played:
                    P[u][k]['sitout'] += 1
    s.close()

    # サイコロ: 席ごとの収支と、振った人の回数 ・ 当たり ・ ゾロ目。試合は nextMatch で区切った通し番号 (= match_no)
    # _roomChipDelta の鍵は部屋の席 (4 人部屋は 0-3)、actor_seat は試合の席 (0-2)。試合の席 → 部屋の席は
    # 最初が start.initialMapping、nextMatch ごとに _nextMapping の gameToRoom。抜け番の人もサイコロで払う ・ 貰う
    w = ro(ws_db)
    init_map = {}
    for r in w.execute('select room_id, snapshot_json from room_state_snapshots'):
        start = json.loads(r['snapshot_json']).get('start') or {}
        init_map[r['room_id']] = (start.get('initialMapping') or {}).get('gameToRoom') or [0, 1, 2]
        for key, (seats, kind) in list(match_seats.items()):
            if key[0] == r['room_id'] and seats is None:
                match_seats[key] = ({int(x['seat']): str(x.get('user_id') or '') for x in start.get('members') or []}, kind)
    seen_rooms, unmatched, sessions, mapping = set(), collections.Counter(), [], {}
    cur_room, cur, match_no, g2r = None, None, 1, None
    for r in w.execute('select room_id, revision, actor_seat, action_json from room_accepted_commands order by room_id, revision'):
        room = r['room_id']
        if room not in room_kind:
            continue
        seen_rooms.add(room)
        if room != cur_room:
            cur_room, cur, match_no, g2r = room, None, 1, init_map.get(room, [0, 1, 2])
            mapping[(room, 1)] = g2r
        a = json.loads(r['action_json'])
        t = a.get('type')
        if t == 'nextMatch':
            match_no += 1
            g2r = (a.get('_nextMapping') or {}).get('gameToRoom') or g2r
            mapping[(room, match_no)] = g2r
        if t == 'selectSaiKoroCombo':
            if cur is None:
                cur = {'room': room, 'match_no': match_no, 'seat': r['actor_seat'], 'delta': collections.Counter(), 'rolls': 0, 'hits': 0, 'zoros': 0}
            cur['combo'] = (min(a['small'], a['large']), max(a['small'], a['large']))
        if cur is not None:
            for seat, v in (a.get('_roomChipDelta') or {}).items():
                cur['delta'][int(seat)] += int(v or 0)
            o = a.get('override')
            if t == 'rollSaiKoroDice' and isinstance(o, list) and len(o) == 2:
                cur['rolls'] += 1
                if o[0] == o[1]:
                    cur['zoros'] += 1
                elif (min(o), max(o)) == cur.get('combo'):
                    cur['hits'] += 1
            if t == 'advanceSaiKoro':
                sessions.append(cur)
                cur = None
    w.close()
    # 部屋の席 → 人 は部屋の中で変わらないので、全試合の (試合の席 → 人) と gameToRoom から組む
    room_seat_user = collections.defaultdict(dict)
    for (room, no), (users, _kind) in match_seats.items():
        g = mapping.get((room, no))
        if users and g:
            for gs, u in users.items():
                room_seat_user[room][g[gs]] = u
    for ses in sessions:
        key = (ses['room'], ses['match_no'])
        if key not in match_seats:
            unmatched[ses['room']] += 1
            continue
        users, kind = match_seats[key]
        seat_user = room_seat_user[ses['room']]
        roller = users.get(ses['seat'], '')
        for seat, v in ses['delta'].items():
            u = seat_user.get(seat, '')
            if not u or u.startswith('CPU'):
                continue
            for k in ('all', kind):
                P[u][k]['dice_chip'] += v
                P[u][k]['dice_own' if u == roller else 'dice_others'] += v
        if roller and not roller.startswith('CPU'):
            for k in ('all', kind):
                c = P[roller][k]
                c['dice_n'] += 1
                c['dice_rolls'] += ses['rolls']
                c['dice_hits'] += ses['hits']
                c['dice_zoros'] += ses['zoros']

    # 打牌: 部屋ごとに一番多くの試合を含むまとめを 1 つだけ使う
    best = {}
    for f in glob.glob(str(Path(summaries) / '*' / 'data.json')):
        d = json.load(open(f, encoding='utf-8'))
        n = len(d.get('match_records') or [])
        if n > best.get(d['room'], (0, None))[0]:
            best[d['room']] = (n, d)
    by_name = {v: k for k, v in names.items() if not k.startswith('CPU')}
    for room, (_n, d) in best.items():
        kind = room_kind.get(room)
        if not kind:
            continue
        for name, v in ((d.get('discard_review') or {}).get('by_player') or {}).items():
            u = by_name.get(name)
            if not u:
                continue
            for k in ('all', kind):
                c = P[u][k]
                for f in ('evaluated', 'cpu_match', 'fold_spots', 'folded'):
                    c['dr_' + f] += v.get(f) or 0

    out = {'no_ws_rooms': sorted(set(room_kind) - seen_rooms), 'dice_outside_matches': dict(unmatched), 'players': {}}
    for u, kinds in P.items():
        out['players'][names.get(u, u)] = {k: dict(v) for k, v in kinds.items()}
    return out
