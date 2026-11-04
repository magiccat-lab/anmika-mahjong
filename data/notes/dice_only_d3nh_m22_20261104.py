"""D3NH 試合 22 [match_id 696]: 和了 14000 は戻し、ポチゼロのサイコロ [+140 / -70 / -70] だけ取り消す (2026-11-04 リョー「点数が正確だったならそこは使っていいよ」)"""
import json, sqlite3, sys
sys.path.insert(0, '/home/m-catlab/apps/anmika-mahjong/server')
import stats
db, orig_db = sys.argv[1], sys.argv[2]
apply = '--apply' in sys.argv
c = sqlite3.connect(db); c.row_factory = sqlite3.Row
o = sqlite3.connect(orig_db); o.row_factory = sqlite3.Row
ISG, ASUME, ARUPU = '590540156617097217', '514403167165743104', '464811848420556801'
m = c.execute("select * from matches where match_id=696 and room_id='D3NH' and match_no=22").fetchone()
cd = json.loads(m['chip_delta_json'])
assert cd == {ISG: -204, ASUME: 167, ARUPU: 37}, cd
om = o.execute("select * from matches where match_id=696").fetchone()
assert json.loads(om['chip_delta_json']) == {ISG: -274, ASUME: 47, ARUPU: 227}
paifu = json.loads(om['paifu_json'])
idx = [i for i, e in enumerate(paifu) if e.get('type') == 'hule']
e = paifu[idx[1]]
assert e['player'] == 2 and e['defen'] == 14000 and e['jushu'] == 1 and not e.get('_voided'), e
e['_diceVoided'] = {'at': '2026-11-04', 'by': 'owner', 'reason': '鳴きの黄ぽっちツモにポチゼロのサイコロが出た通報 [20261104 arupu_]。和了 14000 は正しいので残し、サイコロ (+140 / -70 / -70) だけ取り消し',
                    'diceRoomChipDelta': {'0': -70, '1': -70, '2': 140}}
assert paifu[idx[-1]]['defenAfter'] == {'0': -35000, '1': 70000, '2': 70000}
# 着順は元のまま (arupu 1 着 ・ asume 2 着、ウマ 50/0/-50)。サイコロの分だけ戻す
new_cd = {ISG: -274 + 70, ASUME: 47 + 70, ARUPU: 227 - 140}
assert sum(new_cd.values()) == 0
seat_by_user = stats.seat_map_from_members(json.loads(m['members_json']))
rows = stats.build_stat_rows(paifu, seat_by_user, new_cd)
before = {r['user_id']: dict(r) for r in c.execute('select * from match_player_stats where match_id=696')}
for r in rows:
    b = before[r['user_id']]
    print(r['user_id'], 'seat', r['seat'], {k: (b[k], r[k]) for k in r if k in b and b[k] != r[k]})
print('chip_delta', cd, '->', new_cd)
print('users.chip_total before', {r['user_id']: r['chip_total'] for r in c.execute('select user_id, chip_total from users where user_id in (?,?,?)', (ISG, ASUME, ARUPU))})
if apply:
    with c:
        c.execute('update matches set paifu_json=?, chip_delta_json=? where match_id=696', (json.dumps(paifu, ensure_ascii=False), json.dumps(new_cd)))
        for r in rows:
            stats.upsert_stat_row(c, 696, r)
        for uid in new_cd:
            c.execute("update users set chip_total = chip_total + ?, updated_at=datetime('now') where user_id=?", (new_cd[uid] - cd[uid], uid))
    print('applied', {r['user_id']: r['chip_total'] for r in c.execute('select user_id, chip_total from users where user_id in (?,?,?)', (ISG, ASUME, ARUPU))})
