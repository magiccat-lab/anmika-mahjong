"""D3NH の部屋の通算 (roomChipLedger) からポチゼロのサイコロ分を戻す (11-04 リョー D2 a)。isg +70 ・ asume +70 ・ arupu -140"""
import json, sqlite3, sys
DB = '/home/m-catlab/apps/anmika-mahjong/data/anmika.sqlite3'
apply = '--apply' in sys.argv
c = sqlite3.connect(DB)
rev, js = c.execute("select revision, snapshot_json from room_state_snapshots where room_id='D3NH'").fetchone()
s = json.loads(js)
seat = {m['user_id']: str(m['seat']) for m in s['start']['members']}
fix = {'590540156617097217': 70, '514403167165743104': 70, '464811848420556801': -140}
led = dict(s['roomChipLedger'])
new = dict(led)
for uid, d in fix.items():
    new[seat[uid]] = new[seat[uid]] + d
assert sum(new.values()) == sum(led.values())
print('rev', rev, 'mapping', s.get('activeMapping'), 'ledger', led, '->', new)
if apply:
    s['roomChipLedger'] = new
    with c:
        n = c.execute("update room_state_snapshots set snapshot_json=? where room_id='D3NH' and revision=?", (json.dumps(s, ensure_ascii=False, separators=(',', ':')), rev)).rowcount
    assert n == 1
    print('applied')
