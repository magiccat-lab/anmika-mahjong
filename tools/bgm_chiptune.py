"""アンミカーニバルの 8bit 版 (10-14、先輩「2で作って進めて」→「8bit版全然メロディーあってないよ」で作り直し)。
demucs で分けた 4 本から、歌 → 矩形波 (メロディ)、ベース → 三角波、ドラム → ノイズ、その他 → 和音のアルペジオに打ち直す。
2 版目で直した所:
 - 高さは pyin ではなく torchcrepe (CREPE) で取る。歌の揺れ (ビブラート) でぶれにくい
 - 音の区切りは 16 分の格子に寄せず、歌の頭 (onset) と高さの変わり目で切る。拍の取り違えでずれない
 - オクターブは 1 曲で 1 回だけずらす。1 版目は音ごとに折り返していて、フレーズの途中で音が飛んでいた (これが一番の原因)
 - 和音は chroma の上位 3 つではなく、長 ・ 短三和音の型に当てて 2 拍で均す
使い方: python bgm_chiptune.py <作業 dir> [--melody-only]   (<作業 dir>/song.mp3 と <作業 dir>/sep/htdemucs/song/*.wav)
"""
import sys, numpy as np, librosa, soundfile as sf, torch, torchcrepe
W = sys.argv[1]
MELODY_ONLY = '--melody-only' in sys.argv
SR = 22050
S = f'{W}/sep/htdemucs/song'
dev = 'cuda' if torch.cuda.is_available() else 'cpu'

def crepe_f0(path, fmin, fmax):
    y16, _ = librosa.load(path, sr=16000, mono=True)
    x = torch.tensor(y16)[None]
    f0, per = torchcrepe.predict(x, 16000, 160, fmin, fmax, 'full', batch_size=1024, device=dev, return_periodicity=True, decoder=torchcrepe.decode.viterbi)
    per = torchcrepe.filter.median(per, 3)
    f0 = torchcrepe.filter.mean(f0, 3)
    db = librosa.amplitude_to_db(np.maximum(1e-6, librosa.feature.rms(y=y16, frame_length=640, hop_length=160)[0]), ref=1.0)
    f0 = f0[0].cpu().numpy(); per = per[0].cpu().numpy()
    n = min(len(f0), len(db))
    voiced = (per[:n] > 0.45) & (db[:n] > -42)
    return np.arange(n) * 0.01, librosa.hz_to_midi(np.maximum(f0[:n], 1.0)), voiced

def segment(t, midi, voiced, onsets, min_len=0.05, jump=0.7):
    notes = []  # (start, end, midi)
    on_set = set(np.round(np.asarray(onsets) / 0.01).astype(int))
    i, n = 0, len(t)
    while i < n:
        if not voiced[i]:
            i += 1; continue
        j = i; vals = [midi[i]]; off = 0
        while j + 1 < n:
            k = j + 1
            if not voiced[k]:
                gap = 0
                while k < n and not voiced[k] and gap < 3: k += 1; gap += 1
                if gap >= 3 or k >= n: break
            med = float(np.median(vals[-8:]))
            if abs(midi[k] - med) > jump:
                off += 1
                if off >= 4: j = k - 4; break
            else:
                off = 0
            if k in on_set and len(vals) * 0.01 >= min_len: break
            vals.append(midi[k]); j = k
        if (j - i + 1) * 0.01 >= min_len:
            notes.append((t[i], t[j] + 0.01, int(round(float(np.median(vals))))))
        i = j + 1
    return notes

y_all, _ = librosa.load(f'{W}/song.mp3', sr=SR, mono=True)
N = len(y_all)
voc_on = librosa.onset.onset_detect(y=librosa.load(f'{S}/vocals.wav', sr=SR, mono=True)[0], sr=SR, hop_length=256, units='time', backtrack=True)
t, m, v = crepe_f0(f'{S}/vocals.wav', 90, 1100)
mel = segment(t, m, v, voc_on)
med = np.median([p for _, _, p in mel]) if mel else 70
mshift = 12 * int(np.round((74 - med) / 12))  # 1 曲で 1 回だけ
print('melody notes', len(mel), 'median', med, 'shift', mshift)

out = np.zeros(N + SR, dtype=np.float32)
hz = lambda p: 440.0 * 2 ** ((p - 69) / 12)
def pulse(freq, n, duty, vol):
    ph = (np.arange(n) * freq / SR) % 1.0
    w = np.where(ph < duty, 1.0, -1.0)
    env = np.ones(n); a = min(n, int(SR * 0.004)); r = min(n, int(SR * 0.025))
    env[:a] = np.linspace(0, 1, a); env[-r:] *= np.linspace(1, 0, r)
    return (w * env * vol).astype(np.float32)
def tri(freq, n, vol):
    ph = (np.arange(n) * freq / SR) % 1.0
    w = np.round((4 * np.abs(ph - 0.5) - 1) * 7.5) / 7.5
    env = np.ones(n); r = min(n, int(SR * 0.02)); env[-r:] *= np.linspace(1, 0, r)
    return (w * env * vol).astype(np.float32)
def put(s, x):
    s = max(0, s); out[s:s + len(x)] += x[:max(0, len(out) - s)]
for s, e, p in mel:
    put(int(s * SR), pulse(hz(p + mshift), max(1, int((e - s) * SR)), 0.5, 0.22))
if not MELODY_ONLY:
    bas_on = librosa.onset.onset_detect(y=librosa.load(f'{S}/bass.wav', sr=SR, mono=True)[0], sr=SR, hop_length=256, units='time', backtrack=True)
    tb, mb, vb = crepe_f0(f'{S}/bass.wav', 32, 400)
    bline = segment(tb, mb, vb, bas_on, min_len=0.06, jump=0.8)
    bmed = np.median([p for _, _, p in bline]) if bline else 40
    bshift = 12 * int(np.round((40 - bmed) / 12))
    for s, e, p in bline:
        put(int(s * SR), tri(hz(p + bshift), max(1, int((e - s) * SR)), 0.13))  # ベースは控えめ (先輩「ベースの音量もっと下げよう」)
    # ドラム
    rng = np.random.default_rng(3)
    drm, _ = librosa.load(f'{S}/drums.wav', sr=SR, mono=True)
    dr_on = librosa.onset.onset_detect(y=drm, sr=SR, hop_length=256, units='samples')
    cent = librosa.feature.spectral_centroid(y=drm, sr=SR, hop_length=256)[0]
    for smp in dr_on:
        c = cent[min(len(cent) - 1, smp // 256 + 1)]
        if c < 1500:
            n = int(SR * 0.12); f = np.linspace(160, 45, n)
            put(smp, (np.sign(np.sin(2 * np.pi * np.cumsum(f) / SR)) * np.exp(-np.arange(n) / (SR * 0.04)) * 0.26).astype(np.float32))
        else:
            n = int(SR * (0.14 if c < 4000 else 0.05)); x = rng.choice([-1.0, 1.0], size=n)
            if c < 4000: x = np.repeat(x[::4], 4)[:n]
            put(smp, (x * np.exp(-np.arange(n) / (SR * (0.05 if c < 4000 else 0.012))) * (0.15 if c < 4000 else 0.06)).astype(np.float32))
    # 和音: 拍ごとに長 ・ 短三和音の型に当てて、2 拍で均す
    tempo, beats = librosa.beat.beat_track(y=y_all, sr=SR, units='time')
    oth, _ = librosa.load(f'{S}/other.wav', sr=SR, mono=True)
    chroma = librosa.feature.chroma_cqt(y=oth, sr=SR, hop_length=512); ct = librosa.times_like(chroma, sr=SR, hop_length=512)
    tmpl = []
    for r in range(12):
        for q, iv in (('M', (0, 4, 7)), ('m', (0, 3, 7))):
            v_ = np.zeros(12); v_[[(r + i) % 12 for i in iv]] = 1; tmpl.append(((r, q), v_ / np.linalg.norm(v_)))
    chords = []
    for a, b in zip(beats[:-1], beats[1:]):
        seg = chroma[:, (ct >= a) & (ct < b)]
        if seg.shape[1] == 0: chords.append(None); continue
        vv = seg.mean(1); vv = vv / (np.linalg.norm(vv) + 1e-9)
        sc = [float(vv @ tv) for _, tv in tmpl]; k = int(np.argmax(sc))
        chords.append(tmpl[k][0] if sc[k] > 0.6 else None)
    for i in range(1, len(chords) - 1):  # 1 拍だけ違う物は前後に合わせる
        if chords[i - 1] == chords[i + 1] and chords[i] != chords[i - 1]: chords[i] = chords[i - 1]
    for i, (a, b) in enumerate(zip(beats[:-1], beats[1:])):
        ch = chords[i]
        if not ch: continue
        r, q = ch; tones = [60 + r, 60 + r + (4 if q == 'M' else 3), 60 + r + 7]
        st = (b - a) / 4
        for k in range(4):
            put(int((a + k * st) * SR), pulse(hz(tones[k % 3] + 12), max(1, int(st * SR * 0.9)), 0.25, 0.05))
out = out[:N]
out = out / max(1e-6, np.max(np.abs(out))) * 0.9
out = np.round(out * 127) / 127
name = 'carnival_8bit_melody.wav' if MELODY_ONLY else 'carnival_8bit.wav'
sf.write(f'{W}/{name}', out, SR)
print('ok', name, round(len(out) / SR, 1))
