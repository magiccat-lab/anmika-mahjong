"""2L8R 試合 13 [match_id 804] 東 3 局 arupu_ の嵌八萬ツモ: 789 三色 [+4 翻] は付かない形 (p67899) だったので外す。
嵌八萬ツモは本役満で点数は同じ。13 翻超過の祝儀 ×6 → ×2 で 16 枚オールを arupu_ に返すだけ (isg -16 ・ noimi -16 ・ arupu +32)。
「嵌八萬+789 [追加]」のサイコロは 4 回とも外れ (0 枚) なので戻す物は無い。
(2026-11-15 リョー「カンパチツモってるから打点は変わらなくて、4ハンオーバー16枚オールが帰ってくるだけだろうね。そう修正してね」)

python3 chip_fix_2l8r_m13_kanpaman789_20261115.py <ws.sqlite3> <api anmika.db> [--apply]
"""
import json, sqlite3, sys
sys.path.insert(0, '/home/m-catlab/apps/anmika-mahjong/server')
import stats

ws_db, api_db = sys.argv[1], sys.argv[2]
apply = '--apply' in sys.argv
ISG, ARUPU, NOIMI = '590540156617097217', '464811848420556801', '410812617263808513'
FIX_BY_USER = {ISG: -16, ARUPU: 32, NOIMI: -16}
FIX_BY_SEAT = {'0': -16, '1': 32, '2': -16}  # 2L8R は回しでない 3 人部屋。席 0 isg ・ 1 arupu ・ 2 noimi
assert sum(FIX_BY_USER.values()) == 0

# --- ws: 部屋の通算 (snapshot.roomChipLedger) と試合 14 の開始チップ (nextMatch rev 2269 の _startChipLedger)
w = sqlite3.connect(ws_db)
rev, js = w.execute("select revision, snapshot_json from room_state_snapshots where room_id='2L8R'").fetchone()
snap = json.loads(js)
assert rev == 2272 and snap['matchId'] == 14 and snap.get('activeMapping') is None, (rev, snap['matchId'])
assert {str(m['seat']): m['user_id'] for m in snap['start']['members']} == {'0': ISG, '1': ARUPU, '2': NOIMI}
led = {k: int(v) for k, v in snap['roomChipLedger'].items()}
assert led == {'0': 47, '1': -1380, '2': 1333}, led
new_led = {k: led[k] + FIX_BY_SEAT[k] for k in led}
nm_js, = w.execute("select action_json from room_accepted_commands where room_id='2L8R' and revision=2269").fetchone()
nm = json.loads(nm_js)
assert nm['type'] == 'nextMatch' and nm['_startChipLedger'] == {'0': -136, '1': -1613, '2': 1749}, nm.get('_startChipLedger')
new_start = {k: nm['_startChipLedger'][k] + FIX_BY_SEAT[k] for k in nm['_startChipLedger']}
print('ws roomChipLedger', led, '->', new_led)
print('ws nextMatch 2269 _startChipLedger', nm['_startChipLedger'], '->', new_start)

# --- API: matches.paifu_json / chip_delta_json、match_player_stats、users.chip_total
c = sqlite3.connect(api_db); c.row_factory = sqlite3.Row
m = c.execute("select * from matches where match_id=804 and room_id='2L8R' and match_no=13").fetchone()
cd = json.loads(m['chip_delta_json'])
assert cd == {ISG: 516, ARUPU: -1144, NOIMI: 628}, cd
new_cd = {u: cd[u] + FIX_BY_USER[u] for u in cd}
paifu = json.loads(m['paifu_json'])
hi = max(i for i, e in enumerate(paifu) if e.get('type') == 'hule')
e = paifu[hi]
assert e['player'] == 1 and not e['isRon'] and e['jushu'] == 2 and hi == len(paifu) - 1
y789 = [h for h in e['hupai'] if h['name'] == '789 三色 [嵌八萬複合]']
assert len(y789) == 1 and any(h['name'] == '嵌八萬 [本役満ツモ]' for h in e['hupai'])
ct = e['chipTransfer']
assert ct['delta'] == {'0': 112, '1': -224, '2': 112}, ct
orig = {'hupai789': y789[0], 'chipTransfer': json.loads(json.dumps(ct))}
e['hupai'] = [h for h in e['hupai'] if h is not y789[0]]
ct['delta'] = {k: ct['delta'][k] + FIX_BY_SEAT[k] for k in ct['delta']}
ct['after'] = {k: ct['after'][k] + FIX_BY_SEAT[k] for k in ct['after']}
e['_kanpaman789Voided'] = {
    'at': '2026-11-15', 'by': 'owner',
    'reason': 'p67899 は p678 + p99 にしか割れず 789 三色は付かない (判定は commit 7de1dbf で直した)。嵌八萬ツモの本役満で点数は同じ、13 翻超過の祝儀 ×6 → ×2 で 16 枚オール戻し。789 由来のサイコロは外れで 0 枚',
    'original': orig,
}
seat_by_user = stats.seat_map_from_members(json.loads(m['members_json']))
rows = stats.build_stat_rows(paifu, seat_by_user, new_cd)
before = {r['user_id']: dict(r) for r in c.execute('select * from match_player_stats where match_id=804')}
for r in rows:
    b = before[r['user_id']]
    print('stats', r['user_id'], 'seat', r['seat'], {k: (b[k], r[k]) for k in r if k in b and b[k] != r[k]})
print('chip_delta', cd, '->', new_cd)
users_before = {r['user_id']: r['chip_total'] for r in c.execute('select user_id, chip_total from users where user_id in (?,?,?)', (ISG, ARUPU, NOIMI))}
print('users.chip_total before', users_before)

if apply:
    snap['roomChipLedger'] = new_led
    nm['_startChipLedger'] = new_start
    with w:
        n1 = w.execute("update room_state_snapshots set snapshot_json=? where room_id='2L8R' and revision=2272",
                       (json.dumps(snap, ensure_ascii=False, separators=(',', ':')),)).rowcount
        n2 = w.execute("update room_accepted_commands set action_json=? where room_id='2L8R' and revision=2269",
                       (json.dumps(nm, ensure_ascii=False, separators=(',', ':')),)).rowcount
        assert n1 == 1 and n2 == 1
    with c:
        c.execute('update matches set paifu_json=?, chip_delta_json=? where match_id=804', (json.dumps(paifu, ensure_ascii=False), json.dumps(new_cd)))
        for r in rows:
            stats.upsert_stat_row(c, 804, r)
        for uid, d in FIX_BY_USER.items():
            c.execute("update users set chip_total = chip_total + ?, updated_at=datetime('now') where user_id=?", (d, uid))
    print('applied', {r['user_id']: r['chip_total'] for r in c.execute('select user_id, chip_total from users where user_id in (?,?,?)', (ISG, ARUPU, NOIMI))})
