"""アンミカーニバルの全曲 8bit (通常時の BGM)。サビ 3 版目 (先輩「音はあってる」) と同じ作り方を全曲に広げ、少しアレンジを足す。
- 旋律: GAME (歌専用の採譜、日本語) を 16 小節ずつ。16 分の格子に寄せ、各音のオクターブを倍音で確かめる
- 低音: 2 版目と同じ CREPE の音符 (低音の stem)。ドラム: ドラムの stem の打点
- アレンジ: 旋律のこだま (12.5% の矩形波を付点 8 分遅れで小さく)、伸ばす音のビブラート、
  半小節ごとの和音の 16 分のアルペジオ (50% の矩形波、小さく)
- 0 小節目の頭から 117 小節ちょうどで切り、頭に戻ってつながる長さにする
使い方: python make_full.py   (stt の venv、pylib と chip2 を sys.path に足す)"""
import json, os, sys
S = '/tmp/claude-1000/-home-m-catlab-secretary-v2-prod/61738d81-d23a-4cf2-9ae0-7d3e1a4e86c6/scratchpad'
sys.path.insert(0, f'{S}/pylib'); sys.path.insert(0, f'{S}/chip2')
import numpy as np, librosa
import make_chorus as mc

OUT = f'{S}/chip4'
BPM = 128.0; BEAT = 60 / BPM; SL = BEAT / 4; BAR = 4 * BEAT
T0 = 22.045844930980664 - 11 * BAR          # 0 小節目の頭 (サビの小節線から 11 小節前)
NBARS = 117
k_lo, k_hi = 0, NBARS * 16
total_s = NBARS * BAR
STEM = f'{S}/chip/sep/htdemucs/song'
log = lambda *a: print(*a, flush=True)

# ---- 旋律 (GAME の 8 区切りをつなぐ) ----
lead = []
for c in range(8):
    core0, core1 = c * 16 * 16, (c + 1) * 16 * 16
    for n in json.load(open(f'{OUT}/game_chunk_{c}.json'))['notes']:
        k0 = int(round((n['start'] - T0) / SL)); k1 = int(round((n['start'] + n['dur'] - T0) / SL))
        if not (core0 <= k0 < core1) or k0 < k_lo or k0 >= k_hi: continue
        lead.append(dict(k0=k0, k1=min(max(k1, k0 + 1), k_hi), pitch=int(round(n['pitch'])), vel=100, f=n['pitch']))
lead.sort(key=lambda n: n['k0'])
# 同じ枠に 2 つ来たら長い方、重なりは前の音を切る、2 枠以下の切れ目は詰める
clean = []
for n in lead:
    if clean and n['k0'] == clean[-1]['k0']:
        if n['k1'] - n['k0'] > clean[-1]['k1'] - clean[-1]['k0']: clean[-1] = n
        continue
    if clean and clean[-1]['k1'] > n['k0']: clean[-1]['k1'] = n['k0']
    if clean and 0 < n['k0'] - clean[-1]['k1'] <= 2: clean[-1]['k1'] = n['k0']
    clean.append(n)
lead = [n for n in clean if n['k1'] > n['k0']]
# 16 分 1 つだけの音階の外の音は声の滑りなので、前の音を伸ばして消す (E メジャー)
E_MAJOR = {4, 6, 8, 9, 11, 1, 3}
kept = []
for n in lead:
    if n['k1'] - n['k0'] == 1 and n['pitch'] % 12 not in E_MAJOR:
        if kept and kept[-1]['k1'] >= n['k0'] - 1: kept[-1]['k1'] = n['k1']
        continue
    kept.append(n)
n_scoop = len(lead) - len(kept); lead = kept
# 3 回のサビは、先輩が OK を出したサビ 3 版目の 19 音にそろえる (0 小節目から 11 ・ 44 ・ 108 小節目)
V3 = mc.read_midi_notes(f'{S}/chip3/chorus_lead_v3.mid', -4, SL)
SABI = [11, 44, 108]
for sb in SABI:
    a, b = sb * 16 - 4, (sb + 8) * 16
    lead = [n for n in lead if not (a <= n['k0'] < b)] + [dict(n, k0=n['k0'] + sb * 16, k1=n['k1'] + sb * 16) for n in V3]
lead.sort(key=lambda n: n['k0'])
for i in range(len(lead) - 1):
    if lead[i]['k1'] > lead[i + 1]['k0']: lead[i]['k1'] = lead[i + 1]['k0']
lead = [n for n in lead if n['k1'] > n['k0']]
log(f'[lead] scoops removed {n_scoop}; choruses set to the approved 19 notes at bars {SABI}')
voc44 = librosa.load(f'{STEM}/vocals.wav', sr=44100, mono=True)[0]

def octave_margin(n):
    a = int((T0 + n['k0'] * SL + 0.02) * 44100); b = int((T0 + n['k1'] * SL - 0.02) * 44100)
    y = voc44[a:max(b, a + 4096)]
    nfft = max(len(y), 16384)  # 短い音は 0 を足して周波数の目を細かくする
    Y = np.abs(np.fft.rfft(y * np.hanning(len(y)), n=nfft)); f = np.fft.rfftfreq(nfft, 1 / 44100)
    bw = f[1] - f[0]
    db = lambda fr: 20 * np.log10(Y[np.abs(f - fr) <= max(fr * 0.015, 2 * bw)].max() + 1e-9)
    f0 = librosa.midi_to_hz(n['pitch'])
    return float(np.mean([db(f0 * k) for k in (1, 2, 3)]) - np.mean([db(f0 / 2 * k) for k in (1, 3, 5)]))
margins = [octave_margin(n) for n in lead]
# 1 つ下の奇数倍が今の高さの倍音より 4 dB 以上強い音は、本当は 1 オクターブ下 (サビの G# で確かめた測り方)
fixed = []
for n, m in zip(lead, margins):
    if m < -4 and n['k0'] // 16 not in range(0, 0):
        n['pitch'] -= 12; fixed.append((n['k0'] // 16, mc.note_name(n['pitch']), round(m, 1)))
log(f'[lead] octave lowered: {fixed}')
margins = [octave_margin(n) for n in lead]
low = [i for i, m in enumerate(margins) if m < 0]
log(f'[lead] {len(lead)} notes, octave margin < 0 dB (1 つ下の疑い): {len(low)}')
for i in low[:20]:
    n = lead[i]; log(f'   bar {n["k0"] // 16} slot {n["k0"] % 16:2d} {mc.note_name(n["pitch"])} margin {margins[i]:.1f}')
per_bar = np.bincount([n['k0'] // 16 for n in lead], minlength=NBARS)
log('[lead] notes per bar: ' + ' '.join(f'{b}:{c}' for b, c in enumerate(per_bar)))

# ---- 低音 ・ ドラム ・ 和音 ----
bas = librosa.load(f'{STEM}/bass.wav', sr=mc.SR, mono=True)[0]
drm = librosa.load(f'{STEM}/drums.wav', sr=mc.SR, mono=True)[0]
oth = librosa.load(f'{STEM}/other.wav', sr=mc.SR, mono=True)[0]
bcfg = dict(clean=dict(tiny_ms=50, glide_ms=100, d1_ms=110, weak_per=0.4, weak_ms=200, fill_rest_ms=60), rest_ms=80, dip_db=99)
bass, _ = mc.extract_part(bas, 0.0, T0, SL, k_lo, k_hi, 33, 500, 26, 62, f'{OUT}/bass_crepe_full.npz', cfg=bcfg, vit=dict(db_floor=-30))
log(f'[bass] {len(bass)} notes')
w0 = T0; w1 = T0 + total_s
# ドラムは 8 小節ずつ測る (曲全体の 99% 点で閾値を決めると、静かな所でスネアが拾われすぎた: 全曲一度で 1000 打)
hits = {'kick': [], 'snare': [], 'hat': []}
for b0 in range(0, NBARS, 8):
    ka, kb = b0 * 16, min(NBARS, b0 + 8) * 16
    wa, wb = T0 + ka * SL, T0 + kb * SL
    h, _ = mc.drum_pattern(drm[int(wa * mc.SR):int(wb * mc.SR)], wa, T0, SL, ka, kb)
    seg = drm[int(wa * mc.SR):int(wb * mc.SR)]
    if 20 * np.log10(np.sqrt(np.mean(seg ** 2)) + 1e-9) < -40:   # ドラムが鳴っていない所 (92〜98 小節)
        continue
    for name in hits: hits[name] += h[name]
log(f"[drums] kick {len(hits['kick'])} snare {len(hits['snare'])} hat {len(hits['hat'])}")
chords = mc.chord_track(oth[int(w0 * mc.SR):int(w1 * mc.SR)], bas[int(w0 * mc.SR):int(w1 * mc.SR)], w0, T0, SL, k_lo, k_hi, span_slots=8)
# 和音が弱い所は、その半小節の頭の低音から 5 度の和音 (根音 ・ 5 度 ・ オクターブ)
def bass_root(k):
    on = [b for b in bass if b['k0'] <= k < b['k1']] or [b for b in bass if k <= b['k0'] < k + 8]
    return on[0]['pitch'] % 12 if on else None
arp_notes = []
n_triad = n_power = 0
for k0, k1, root, q, sc in chords:
    if sc >= 0.75:
        iv = (0, 4, 7, 12) if q == 'M' else (0, 3, 7, 12); n_triad += 1
    else:
        r = bass_root(k0)
        if r is None: continue
        root, iv = r, (0, 7, 12, 7); n_power += 1
    base = 72 + ((root - 72) % 12)          # C5〜B5 に根音
    if base > 78: base -= 12                 # 高すぎない所 (F#4〜F5) に寄せる
    pat = [iv[i % len(iv)] for i in range(k1 - k0)]
    for j, k in enumerate(range(k0, k1)):
        arp_notes.append(dict(k0=k, k1=k + 1, pitch=base + pat[j], vel=100))
log(f'[arp] half-bars: triad {n_triad}, power {n_power}, none {len(chords) - n_triad - n_power}')

# ---- MIDI と音 ----
mc.write_midi(f'{OUT}/full_lead.mid', lead, k_lo, SL, BPM, 80, 'lead (vocal register)')
mc.write_midi(f'{OUT}/full_bass.mid', bass, k_lo, SL, BPM, 38, 'bass')
mc.write_midi(f'{OUT}/full_arp.mid', arp_notes, k_lo, SL, BPM, 81, 'arp')
echo = [dict(n, k0=n['k0'] + 3, k1=min(n['k1'] + 3, k_hi)) for n in lead if n['k0'] + 3 < k_hi]
x_lead = mc.render_notes(lead, k_lo, SL, total_s, 'pulse', shift=12, duty=0.25, vibrato=0.18)
x_echo = mc.render_notes(echo, k_lo, SL, total_s, 'pulse', shift=12, duty=0.125, gate_gap=0.03)
x_bass = mc.render_notes(bass, k_lo, SL, total_s, 'tri', shift=0, bits=4, attack=0.002, release=0.015, gate_gap=0.025)
x_drum = mc.render_drums(hits, k_lo, SL, total_s)
x_arp = mc.render_notes(arp_notes, k_lo, SL, total_s, 'pulse', shift=0, duty=0.5, gate_gap=0.035, attack=0.002, release=0.03)
n_out = int(round(total_s * mc.SR_OUT))
pad = lambda x: x[:n_out] if len(x) >= n_out else np.pad(x, (0, n_out - len(x)))
x_lead, x_echo, x_bass, x_drum, x_arp = map(pad, (x_lead, x_echo, x_bass, x_drum, x_arp))
mix = 0.55 * x_lead + 0.17 * x_echo + 0.50 * x_bass + 0.60 * x_drum + 0.10 * x_arp
y, l0, l1, pk, lim = mc.normalise(mix)
mc.write_mp3(f'{OUT}/anmika_carnival_8bit.mp3', y, kbps=160)
# 確かめ用にサビ 8 小節を切り出し (サビ 3 版目と同じ所)
a = int((22.045844930980664 - BEAT - T0) * mc.SR_OUT); b = int((37.045844930980664 - T0) * mc.SR_OUT)
mc.write_mp3(f'{OUT}/check_sabi.mp3', y[a:b], kbps=160)
json.dump(dict(n_lead=len(lead), n_bass=len(bass), octave_low=len(low), per_bar=per_bar.tolist(), triad=n_triad, power=n_power,
               lufs=round(l1, 1), peak_db=round(20 * np.log10(pk), 1), seconds=round(total_s, 3)), open(f'{OUT}/result_full.json', 'w'), indent=1)
log(f'[render] {total_s:.2f}s  LUFS {l1:.1f}  peak {20 * np.log10(pk):.1f} dB')
