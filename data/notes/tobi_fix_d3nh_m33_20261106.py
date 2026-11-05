"""D3NH 試合 33 [match_id 707]: フィーバー逆ロンで isg が自分で飛んだ時のトビ賞の不足 15 枚を戻す (2026-11-06 リョー「直していい」)
旧実装は受取側の倍率 [×1] で 5 枚。正しくは和了者の倍率 [×4] で 20 枚 (fix d316c76)。isg -15 ・ asume +15。
使い方: python3 data/notes/tobi_fix_d3nh_m33_20261106.py [--apply]"""
import json, sqlite3, sys
sys.path.insert(0, '/home/m-catlab/apps/anmika-mahjong/server')
import stats
STATS_DB = '/home/m-catlab/apps/anmika-mahjong/server/data/anmika.db'
ROOM_DB = '/home/m-catlab/apps/anmika-mahjong/data/anmika.sqlite3'
apply = '--apply' in sys.argv
ISG, ASUME, ARUPU = '590540156617097217', '514403167165743104', '464811848420556801'
FIX = {ISG: -15, ASUME: 15, ARUPU: 0}
c = sqlite3.connect(STATS_DB); c.row_factory = sqlite3.Row
m = c.execute("select * from matches where match_id=707 and room_id='D3NH' and match_no=33").fetchone()
paifu = json.loads(m['paifu_json']); cd = json.loads(m['chip_delta_json'])
assert cd == {ISG: -439, ASUME: 247, ARUPU: 192}, cd
last = [e for e in paifu if e.get('type') == 'hule'][-1]
assert last['player'] == 0 and last['loser'] == 1 and last.get('pochiReverse') and last['defenAfter']['0'] < 0 and not last.get('_tobiFix'), last
last['_tobiFix'] = {'at': '2026-11-06', 'by': 'owner', 'reason': 'フィーバー逆ロンの自分飛びのトビ賞が受取側の倍率 [×1] で 5 枚だった。和了者の倍率 [×4] の 20 枚に直す (通報 20261104_2、fix d316c76)',
                    'chipDelta': {'0': -15, '1': 15, '2': 0}}
new_cd = {u: cd[u] + FIX[u] for u in cd}
assert sum(new_cd.values()) == 0
seat_by_user = stats.seat_map_from_members(json.loads(m['members_json']))
rows = stats.build_stat_rows(paifu, seat_by_user, new_cd)
before = {r['user_id']: dict(r) for r in c.execute('select * from match_player_stats where match_id=707')}
for r in rows:
    b = before[r['user_id']]
    print(r['user_id'], 'seat', r['seat'], {k: (b[k], r[k]) for k in r if k in b and b[k] != r[k]})
users = lambda: {r['user_id']: r['chip_total'] for r in c.execute('select user_id, chip_total from users where user_id in (?,?,?)', (ISG, ASUME, ARUPU))}
print('chip_delta', cd, '->', new_cd)
print('users.chip_total', users())
rc = sqlite3.connect(ROOM_DB)
rev, js = rc.execute("select revision, snapshot_json from room_state_snapshots where room_id='D3NH'").fetchone()
s = json.loads(js)
seat = {mm['user_id']: str(mm['seat']) for mm in s['start']['members']}
led = dict(s['roomChipLedger']); new_led = dict(led)
for uid, d in FIX.items():
    new_led[seat[uid]] += d
print('room rev', rev, 'updatedAt', s.get('updatedAt'), 'ledger', led, '->', new_led)
if apply:
    with c:
        c.execute('update matches set paifu_json=?, chip_delta_json=? where match_id=707', (json.dumps(paifu, ensure_ascii=False), json.dumps(new_cd)))
        for r in rows:
            stats.upsert_stat_row(c, 707, r)
        for uid, d in FIX.items():
            if d:
                c.execute("update users set chip_total = chip_total + ?, updated_at=datetime('now') where user_id=?", (d, uid))
    s['roomChipLedger'] = new_led
    with rc:
        n = rc.execute("update room_state_snapshots set snapshot_json=? where room_id='D3NH' and revision=?", (json.dumps(s, ensure_ascii=False, separators=(',', ':')), rev)).rowcount
    assert n == 1
    print('applied', users())
