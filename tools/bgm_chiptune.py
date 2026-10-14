"""アンミカーニバルの 8bit 版 (10-14、先輩「2で作って進めて」)。demucs で分けた 4 本から、
歌 → 矩形波 (メロディ)、ベース → 三角波、ドラム → ノイズ、その他 → 和音のアルペジオ (矩形波 25%) に打ち直す"""
import sys, numpy as np, librosa, soundfile as sf
W = sys.argv[1]
SR = 22050
S = f'{W}/sep/htdemucs/song'
y_all, _ = librosa.load(f'{W}/song.mp3', sr=SR, mono=True)
voc, _ = librosa.load(f'{S}/vocals.wav', sr=SR, mono=True)
bas, _ = librosa.load(f'{S}/bass.wav', sr=SR, mono=True)
drm, _ = librosa.load(f'{S}/drums.wav', sr=SR, mono=True)
oth, _ = librosa.load(f'{S}/other.wav', sr=SR, mono=True)
N = len(y_all)
tempo, beats = librosa.beat.beat_track(y=y_all, sr=SR, units='time')
tempo = float(np.atleast_1d(tempo)[0])
beats = np.asarray(beats)
print('tempo', round(tempo, 1), 'beats', len(beats))
# 16 分の格子: 拍の間を 4 等分 (拍の揺れに合わせる)
grid = []
for a, b in zip(beats[:-1], beats[1:]):
    grid += list(np.linspace(a, b, 5)[:-1])
grid = np.array(grid + [beats[-1]])
step = float(np.median(np.diff(grid)))
HOP = 256
def track(y, fmin, fmax, thr):
    f0, vf, vp = librosa.pyin(y, fmin=fmin, fmax=fmax, sr=SR, hop_length=HOP, frame_length=2048)
    t = librosa.times_like(f0, sr=SR, hop_length=HOP)
    midi = np.where(vf & (vp > thr), librosa.hz_to_midi(np.nan_to_num(f0, nan=1.0)), np.nan)
    return t, midi
def quantize(t, midi, onset_t, min_frac=0.5):
    notes = []  # (start_idx, midi)
    on_idx = set(np.searchsorted(grid, onset_t) - 0)
    for i in range(len(grid) - 1):
        m = midi[(t >= grid[i]) & (t < grid[i + 1])]
        v = m[~np.isnan(m)]
        if len(m) and len(v) / len(m) >= min_frac:
            notes.append(int(round(float(np.median(v)))))
        else:
            notes.append(None)
    # 同じ高さが続いて、その間に頭 (onset) が無ければ伸ばす
    events = []  # (start, length, midi)
    i = 0
    while i < len(notes):
        if notes[i] is None:
            i += 1; continue
        j = i + 1
        while j < len(notes) and notes[j] == notes[i] and j not in on_idx:
            j += 1
        events.append((i, j - i, notes[i])); i = j
    return events
voc_on = librosa.onset.onset_detect(y=voc, sr=SR, hop_length=HOP, units='time', backtrack=True)
t, vm = track(voc, 110, 1100, 0.3)
mel = quantize(t, vm, voc_on)
bas_on = librosa.onset.onset_detect(y=bas, sr=SR, hop_length=HOP, units='time', backtrack=True)
t2, bm = track(bas, 35, 330, 0.2)
bline = quantize(t2, bm, bas_on, 0.4)
print('melody notes', len(mel), 'bass notes', len(bline))
# ドラム: 頭を拾い、音の高さ (重心) でキック ・ スネア ・ ハイハット
dr_on = librosa.onset.onset_detect(y=drm, sr=SR, hop_length=HOP, units='samples', backtrack=False)
cent = librosa.feature.spectral_centroid(y=drm, sr=SR, hop_length=HOP)[0]
drum_ev = []
for s in dr_on:
    c = cent[min(len(cent) - 1, s // HOP + 1)]
    kind = 'k' if c < 1500 else ('s' if c < 4000 else 'h')
    gi = int(np.argmin(np.abs(grid - s / SR)))
    drum_ev.append((gi, kind))
# 和音: 拍ごとに other の chroma の上 3 つ
chroma = librosa.feature.chroma_cqt(y=oth, sr=SR, hop_length=512)
ct = librosa.times_like(chroma, sr=SR, hop_length=512)
chords = []
for i in range(0, len(grid) - 1, 4):
    seg = chroma[:, (ct >= grid[i]) & (ct < grid[min(i + 4, len(grid) - 1)])]
    if seg.shape[1] == 0:
        chords.append(None); continue
    v = seg.mean(axis=1)
    if v.max() < 0.25:
        chords.append(None); continue
    top = sorted(np.argsort(v)[-3:])
    chords.append([60 + int(p) for p in top])
# ---- 音を作る ----
out = np.zeros(N + SR, dtype=np.float32)
def at(i):
    return int(grid[min(i, len(grid) - 1)] * SR)
def pulse(freq, n, duty, vol):
    ph = (np.arange(n) * freq / SR) % 1.0
    w = np.where(ph < duty, 1.0, -1.0)
    env = np.ones(n); a = min(n, int(SR * 0.004)); r = min(n, int(SR * 0.03))
    env[:a] = np.linspace(0, 1, a); env[-r:] *= np.linspace(1, 0, r)
    return (w * env * vol).astype(np.float32)
def tri(freq, n, vol):
    ph = (np.arange(n) * freq / SR) % 1.0
    w = 4 * np.abs(ph - 0.5) - 1
    w = np.round(w * 7.5) / 7.5  # 4 bit の段
    env = np.ones(n); r = min(n, int(SR * 0.02)); env[-r:] *= np.linspace(1, 0, r)
    return (w * env * vol).astype(np.float32)
rng = np.random.default_rng(3)
def noise(n, decay, vol, lp=False):
    x = rng.choice([-1.0, 1.0], size=n)
    if lp:
        x = np.repeat(x[::4], 4)[:n]
    return (x * np.exp(-np.arange(n) / (SR * decay)) * vol).astype(np.float32)
def put(s, x):
    out[s:s + len(x)] += x[:max(0, len(out) - s)]
hz = lambda m: 440.0 * 2 ** ((m - 69) / 12)
for i, ln, m in mel:
    s, e = at(i), at(i + ln)
    m2 = m
    while m2 < 64: m2 += 12  # 矩形波が埋もれない高さへ
    while m2 > 88: m2 -= 12
    put(s, pulse(hz(m2), max(1, e - s - int(SR * 0.01)), 0.5, 0.20))
for i, ln, m in bline:
    s, e = at(i), at(i + ln)
    m2 = m
    while m2 < 33: m2 += 12
    while m2 > 52: m2 -= 12
    put(s, tri(hz(m2), max(1, e - s), 0.14))  # ベースは控えめ (10-14 先輩「ベースの音量もっと下げよう」、0.30 から)
for gi, kind in drum_ev:
    s = at(gi)
    if kind == 'k':
        n = int(SR * 0.12); f = np.linspace(160, 45, n)
        x = (np.sign(np.sin(2 * np.pi * np.cumsum(f) / SR)) * np.exp(-np.arange(n) / (SR * 0.04)) * 0.32).astype(np.float32)
        put(s, x)
    elif kind == 's':
        put(s, noise(int(SR * 0.15), 0.05, 0.18, lp=True))
    else:
        put(s, noise(int(SR * 0.05), 0.012, 0.07))
for ci, ch in enumerate(chords):
    if not ch: continue
    for k in range(4):  # 1 拍に 16 分で 4 つ
        for sub in range(4):
            gi = ci * 4 + k
            if gi >= len(grid) - 1: break
            s = at(gi) + int(sub * step / 4 * SR) if False else at(gi)
        m = ch[k % 3] + 12
        s, e = at(ci * 4 + k), at(ci * 4 + k + 1)
        put(s, pulse(hz(m), max(1, e - s - int(SR * 0.01)), 0.25, 0.07))
out = out[:N]
out = out / max(1e-6, np.max(np.abs(out))) * 0.9
out = np.round(out * 127) / 127  # 8 bit の粗さ
sf.write(f'{W}/carnival_8bit.wav', out, SR)
print('ok', len(out) / SR)
