"""サビ 8 小節の 8bit 3 版目。旋律だけ GAME (歌専用の採譜、日本語) の音符に差し替え、各音のオクターブを倍音で確かめる。
低音 ・ ドラム ・ 音色は 2 版目 (chip2/make_chorus.py) のまま。
使い方: PYTHONPATH=<pylib>:<chip2> python make_v3.py"""
import json, os, subprocess, sys
import numpy as np, librosa
S = '/tmp/claude-1000/-home-m-catlab-secretary-v2-prod/61738d81-d23a-4cf2-9ae0-7d3e1a4e86c6/scratchpad'
sys.path.insert(0, f'{S}/chip2')
import make_chorus as mc

OUT = f'{S}/chip3'
MODEL = f'{S}/game_models/large/GAME-1.0.3-large-onnx'
PY = '/home/m-catlab/secretary-v2-homes/shun/stt/venv/bin/python'
R1 = json.load(open(f'{S}/chip2/result.json'))
BPM = R1['bpm']; BEAT = 60 / BPM; SL = BEAT / 4
T0 = R1['bar1_start_s']; k_lo, k_hi = -4, 128
w0, w1 = T0 + k_lo * SL, T0 + k_hi * SL
total_s = w1 - w0
VOC = f'{S}/chip/sep/htdemucs/song/vocals.wav'

def game_take(lag):
    t0 = T0 + lag * BEAT
    a0 = t0 + k_lo * SL - 0.3
    out = f'{OUT}/game_take_{lag}.json'
    if not os.path.exists(out):
        subprocess.run([PY, '-I', f'{OUT}/game_onnx.py', MODEL, VOC, f'{a0:.3f}', f'{(k_hi - k_lo) * SL + 0.6:.3f}', out, 'ja'], check=True)
    notes = []
    for n in json.load(open(out))['notes']:
        k0 = int(round((n['start'] - t0) / SL)); k1 = int(round((n['start'] + n['dur'] - t0) / SL))
        if k1 <= k0 or k1 <= k_lo or k0 >= k_hi: continue
        notes.append(dict(k0=max(k0, k_lo), k1=min(k1, k_hi), pitch=int(round(n['pitch'])), fpitch=n['pitch'], vel=100, t=n['start'], d=n['dur']))
    return notes

def octave_check(n, take_t0):
    """偶数倍 (高いままの高さ) と、1 オクターブ下の奇数倍を比べる。下の奇数倍が偶数倍に近ければ、本当は 1 つ下"""
    y, sr = librosa.load(VOC, sr=44100, offset=take_t0 + (n['k0'] - 0) * SL + 0.03, duration=max(0.12, (n['k1'] - n['k0']) * SL - 0.06))
    Y = np.abs(np.fft.rfft(y * np.hanning(len(y)))); f = np.fft.rfftfreq(len(y), 1 / sr)
    db = lambda fr: 20 * np.log10(Y[(f > fr * 0.985) & (f < fr * 1.015)].max() + 1e-9)
    f0 = librosa.midi_to_hz(n['pitch'])
    even = np.mean([db(f0 * k) for k in (1, 2, 3)])          # 今の高さの倍音
    odd_low = np.mean([db(f0 / 2 * k) for k in (1, 3, 5)])    # 1 オクターブ下なら出る音
    return round(float(even - odd_low), 1)

takes = {lag: game_take(lag) for lag in R1['take_lags']}
base = takes[0]
# 3 回歌われている所で高さを多数決 (頭が 1 枠以内で同じ所)
lead = []
for n in base:
    votes = [n['pitch']]
    for lag, tn in takes.items():
        if lag == 0: continue
        m = [x for x in tn if abs(x['k0'] - n['k0']) <= 1]
        if m: votes.append(m[0]['pitch'])
    p = int(np.median(votes))
    lead.append(dict(n, pitch=p, votes=votes))
# 音の終わりは次の音の頭まで (2 枠より短い切れ目は詰める)、最短 2 枠
for i, n in enumerate(lead):
    nxt = lead[i + 1] if i + 1 < len(lead) else None
    if nxt and 0 < nxt['k0'] - n['k1'] <= 2: n['k1'] = nxt['k0']
    if n['k1'] - n['k0'] < 2: n['k1'] = n['k0'] + 2
checks = [octave_check(n, T0) for n in lead]
v1 = mc.read_midi_notes(f'{S}/chip2/chorus_lead.mid', k_lo, SL)
print('slot  bar    v3    votes        octave(even-oddlow dB)   v1 at same slot')
for n, c in zip(lead, checks):
    m = [x for x in v1 if abs(x['k0'] - n['k0']) <= 1]
    v1s = mc.note_name(m[0]['pitch']) if m else '-'
    flag = '' if v1s == mc.note_name(n['pitch']) else '  <- 違う'
    print(f"{n['k0']:4d}-{n['k1']:<4d} {n['k0'] // 16 + 1}.{(n['k0'] % 16) // 4 + 1}  {mc.note_name(n['pitch']):>4}  {str([mc.note_name(v) for v in n['votes']]):24s} {c:6.1f}   {v1s}{flag}")
mc.write_midi(f'{OUT}/chorus_lead_v3.mid', lead, k_lo, SL, BPM, 80, 'lead v3 (GAME)')
bass = mc.read_midi_notes(f'{S}/chip2/chorus_bass.mid', k_lo, SL)
drm = librosa.load(f'{S}/chip/sep/htdemucs/song/drums.wav', sr=mc.SR, mono=True)[0]
hits, _ = mc.drum_pattern(drm[int(w0 * mc.SR):int(w1 * mc.SR)], w0, T0, SL, k_lo, k_hi)
x_lead = mc.render_notes(lead, k_lo, SL, total_s, 'pulse', shift=12, duty=0.25)
x_bass = mc.render_notes(bass, k_lo, SL, total_s, 'tri', shift=0, bits=4, attack=0.002, release=0.015, gate_gap=0.025)
x_drum = mc.render_drums(hits, k_lo, SL, total_s)
n_out = int(total_s * mc.SR_OUT)
pad = lambda x: x[:n_out] if len(x) >= n_out else np.pad(x, (0, n_out - len(x)))
x_lead, x_bass, x_drum = map(pad, (x_lead, x_bass, x_drum))
y_lead = mc.normalise(x_lead)[0]
mc.write_mp3(f'{OUT}/chorus_8bit_lead_v3.mp3', y_lead)
y_full = mc.normalise(0.55 * x_lead + 0.50 * x_bass + 0.62 * x_drum)[0]
mc.write_mp3(f'{OUT}/chorus_8bit_full_v3.mp3', y_full)
json.dump(dict(lead=[{k: n[k] for k in ('k0', 'k1', 'pitch', 'votes')} for n in lead], octave_checks=checks), open(f'{OUT}/result_v3.json', 'w'), indent=1)
print('notes', len(lead), 'written')
