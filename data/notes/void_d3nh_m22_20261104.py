"""D3NH 試合 22 [match_id 696]: arupu_ の 鳴き黄ぽっちツモ 14000 と ポチゼロのサイコロ [+140] を取り消す (2026-11-04 リョー)"""
import json, sqlite3, sys
sys.path.insert(0, '/home/m-catlab/apps/anmika-mahjong/server')
import stats
db = sys.argv[1]
apply = '--apply' in sys.argv
c = sqlite3.connect(db); c.row_factory = sqlite3.Row
ISG, ASUME, ARUPU = '590540156617097217', '514403167165743104', '464811848420556801'
m = c.execute("select * from matches where match_id=696 and room_id='D3NH' and match_no=22").fetchone()
paifu = json.loads(m['paifu_json']); cd = json.loads(m['chip_delta_json'])
assert cd == {ISG: -274, ASUME: 47, ARUPU: 227}, cd
idx = [i for i, e in enumerate(paifu) if e.get('type') == 'hule']
tgt = idx[1]; e = paifu[tgt]
assert e['player'] == 2 and e['defen'] == 14000 and e['jushu'] == 1 and e['benbang'] == 0 and not e.get('_voided'), e
e['_voided'] = {'at': '2026-11-04', 'by': 'owner', 'reason': '鳴きの黄ぽっちツモにポチゼロのサイコロが出た通報 [20261104 arupu_]。和了 (14000) とサイコロ (+140 / -70 / -70) を取り消し',
                'diceRoomChipDelta': {'0': -70, '1': -70, '2': 140}}
shift = {'0': 7000, '1': 7000, '2': -14000}
for i in idx:
    if i <= tgt: continue
    for k in ('defenBefore', 'defenAfter'):
        paifu[i][k] = {s: paifu[i][k][s] + shift[s] for s in ('0', '1', '2')}
last = paifu[idx[-1]]['defenAfter']
assert last == {'0': -28000, '1': 77000, '2': 56000}, last
# ウマ: 2着 56000 >= 40000 → 50/0/-50。元は arupu 1着 (同点 70000 の上家側) ・ asume 2着 → asume 1着 ・ arupu 2着
# チップ: サイコロ戻し (isg +70, asume +70, arupu -140) + ウマ入れ替え (asume +50, arupu -50)
new_cd = {ISG: -274 + 70, ASUME: 47 + 70 + 50, ARUPU: 227 - 140 - 50}
assert sum(new_cd.values()) == 0
members = json.loads(m['members_json'])
seat_by_user = stats.seat_map_from_members(members)
rows = stats.build_stat_rows(paifu, seat_by_user, new_cd)
before = {r['user_id']: dict(r) for r in c.execute('select * from match_player_stats where match_id=696')}
for r in rows:
    b = before[r['user_id']]
    diff = {k: (b[k], r[k]) for k in r if k in b and b[k] != r[k]}
    print(r['user_id'], 'seat', r['seat'], diff)
users_before = {r['user_id']: r['chip_total'] for r in c.execute('select user_id, chip_total from users where user_id in (?,?,?)', (ISG, ASUME, ARUPU))}
print('chip_delta', cd, '->', new_cd)
print('users.chip_total', users_before)
if apply:
    with c:
        c.execute('update matches set paifu_json=?, chip_delta_json=? where match_id=696', (json.dumps(paifu, ensure_ascii=False), json.dumps(new_cd)))
        for r in rows:
            stats.upsert_stat_row(c, 696, r)
        for uid in new_cd:
            c.execute("update users set chip_total = chip_total + ?, updated_at=datetime('now') where user_id=?", (new_cd[uid] - cd[uid], uid))
    print('applied')
    print({r['user_id']: r['chip_total'] for r in c.execute('select user_id, chip_total from users where user_id in (?,?,?)', (ISG, ASUME, ARUPU))})
