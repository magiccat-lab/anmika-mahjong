#!/usr/bin/env python3
"""Chorus 8 bars -> beat-aligned lead / bass MIDI -> 8-bit (NES style) renders.

Reproduces everything in this directory from the demucs stems of song.mp3:

  PYTHONPATH=<pylib> python make_chorus.py [--chip-dir DIR] [--out DIR] [--bar-beat N] [--vibrato SEMITONES]
                                           [--no-arp] [--skip-checks]

  --chip-dir  folder with song.mp3 and sep/htdemucs/song/{vocals,bass,drums,other}.wav (default: scratchpad/chip)
  --out       output folder (default: the folder of this script); CREPE results are cached in <out>/work

Pipeline
  1. grid     : BPM / phase of the beat grid fitted to the drums stem (a DAW song is rigid, so one linear grid is
                fitted by folding the onset envelope modulo the beat period)            -> 128.00 BPM
  2. chorus   : longest loud run of vocal chroma that repeats later (lag L beats); the bar line is the beat with the
                strongest crash on the drums stem (summed over the copies). 8 bars + 1 beat pickup. Also returns the
                other copies of the chorus (lags) = independent takes of the same melody
  3. lead     : torchcrepe f0 -> Viterbi over {rest, semitones} -> absorb glides / scoops / unreliable fragments ->
                onset = start of the stable pitch rounded to the 16th grid; energy dips (> 7 dB, > 120 ms) between equal
                pitches re-articulate; end = next onset (legato) -> key-aware removal of short out-of-key scoops
                -> median over the 3 copies of the chorus -> MIDI (vocal register)
  4. bass     : same pipeline on the bass stem (monophonic, torchcrepe 33-500 Hz)
  5. drums    : kick / snare / hat per 16th slot from band-limited onset flux of the drums stem
  6. chords   : triad per half bar from the other + bass chroma; the quiet 50 % arpeggio is only written for confident
                triads (score >= 0.80). For this song none are confident, so it is omitted
  7. render   : 44.1 kHz. lead = polyBLEP band-limited 25 % pulse (+12 semitones from the vocal register), 3 ms attack,
                20 ms release, 22 ms gap before a note that starts right after; bass = 4-bit triangle; drums = noise /
                swept-triangle hits on the detected slots. Both files normalised to -16 LUFS, peak ceiling -1 dBFS
  8. checks   : result.json -> a) re-transcription of chorus_8bit_lead (Basic Pitch + CREPE pipeline) vs the MIDI,
                b) coverage of the vocal-stem pitch track, c) note-length histogram, d) onset alignment vs the original
                drums / beat grid; roll.png = piano roll over the vocal f0
"""
import os, sys, json, argparse, subprocess, warnings
import numpy as np

warnings.filterwarnings('ignore')
import logging
logging.disable(logging.WARNING)
import librosa
import soundfile as sf
from scipy.ndimage import uniform_filter1d

HERE = os.path.dirname(os.path.abspath(__file__))
SCRATCH = '/tmp/claude-1000/-home-m-catlab-secretary-v2-prod/61738d81-d23a-4cf2-9ae0-7d3e1a4e86c6/scratchpad'
SR = 22050          # analysis rate
SR_OUT = 44100      # render rate
NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B']


def note_name(p):
    return f'{NAMES[int(p) % 12]}{int(p) // 12 - 1}'


def log(*a):
    print(*a, flush=True)


# ----------------------------------------------------------------------------------------------
# 1. grid
# ----------------------------------------------------------------------------------------------
def detect_grid(drums):
    hop = 128
    env = librosa.onset.onset_strength(y=drums, sr=SR, hop_length=hop, aggregate=np.median)
    t = np.arange(len(env)) * hop / SR
    best = (0, None)
    for bpm in np.arange(110.0, 150.0, 0.01):
        per = 60.0 / bpm
        ph = (t % per) / per
        h = np.bincount((ph * 64).astype(int) % 64, weights=env, minlength=64)
        h3 = h + np.roll(h, 1) + np.roll(h, -1)
        sc = h3.max() / h.sum()
        if sc > best[0]:
            best = (sc, bpm)
    bpm = best[1]
    # refine bpm to 0.001 around the best and phase to ~1 ms
    best2 = (0, bpm, 0)
    for b in np.arange(bpm - 0.02, bpm + 0.02, 0.001):
        per = 60.0 / b
        ph = (t % per) / per
        h = np.bincount((ph * 256).astype(int) % 256, weights=env, minlength=256)
        hs = uniform_filter1d(h, 5, mode='wrap')
        sc = hs.max() / h.sum()
        if sc > best2[0]:
            best2 = (sc, b, (np.argmax(hs) + 0.5) / 256 * per)
    _, bpm, off = best2
    bpm = round(bpm, 2)
    per = 60.0 / bpm
    # offset: weighted circular centroid around the peak
    ph = (t % per) / per
    h = np.bincount((ph * 512).astype(int) % 512, weights=env, minlength=512)
    pk = int(np.argmax(uniform_filter1d(h, 9, mode='wrap')))
    idx = (np.arange(pk - 8, pk + 9)) % 512
    ww = h[idx]
    pos = (np.arange(pk - 8, pk + 9) + 0.5) / 512
    off = float((pos * ww).sum() / ww.sum()) * per
    return float(bpm), off % per


# ----------------------------------------------------------------------------------------------
# 2. chorus
# ----------------------------------------------------------------------------------------------
def beat_chroma(y, bt, hop=512):
    ch = librosa.feature.chroma_cqt(y=y, sr=SR, hop_length=hop)
    ct = librosa.times_like(ch, sr=SR, hop_length=hop)
    nb = len(bt) - 1
    out = np.zeros((12, nb))
    for i in range(nb):
        m = (ct >= bt[i]) & (ct < bt[i + 1])
        if m.any():
            out[:, i] = ch[:, m].mean(1)
    return out


def detect_chorus(vocals, drums, bpm, off, dur):
    """longest run of beats whose vocal chroma matches the vocal chroma L beats later (a repeated
    section), preferring loud sections. Returns dict(start_beat, bar_beat, length, lags, ...)."""
    beat = 60.0 / bpm
    nb = int((dur - off) / beat)
    bt = off + np.arange(nb + 1) * beat
    cv = beat_chroma(vocals, bt)
    cvn = cv / (np.linalg.norm(cv, axis=0, keepdims=True) + 1e-9)
    rms = librosa.feature.rms(y=vocals, frame_length=2048, hop_length=512)[0]
    rt = librosa.times_like(rms, sr=SR, hop_length=512)
    lvl = np.array([rms[(rt >= bt[i]) & (rt < bt[i + 1])].mean() if ((rt >= bt[i]) & (rt < bt[i + 1])).any() else 0
                    for i in range(nb)])
    thr_loud = np.percentile(lvl, 55)
    runs = []   # (length, start, lag, loudness)
    for L in range(24, nb - 24):
        s = np.einsum('ij,ij->j', cvn[:, :nb - L], cvn[:, L:nb]) > 0.95
        i = 0
        while i < len(s):
            if s[i]:
                j = i
                while j < len(s) and s[j]:
                    j += 1
                if j - i >= 24 and lvl[i:j].mean() >= thr_loud:
                    runs.append((j - i, i, L, float(lvl[i:j].mean())))
                i = j
            else:
                i += 1
    if not runs:
        return None
    # score: length x loudness, the run's earliest copy
    runs.sort(key=lambda r: -(r[0] * r[3]))
    ln, st, L, lv = runs[0]
    # all copies of this section: any run whose span overlaps the same material
    copies = sorted({st, st + L} | {r[1] for r in runs if abs(r[2] - L) < 2 and abs(r[1] - st) < 4} |
                    {r[1] + r[2] for r in runs if abs(r[1] + r[2] - st - L) < 4})
    # bar line = the beat in [st, st+7] with the strongest crash (HF energy step) on the drums stem (summed over both copies)
    D = np.abs(librosa.stft(drums, n_fft=2048, hop_length=256))
    fr = librosa.fft_frequencies(sr=SR, n_fft=2048)
    hf = D[fr > 6000].sum(0)
    ct = librosa.times_like(hf, sr=SR, hop_length=256)

    def win(a, b):
        m = (ct >= a) & (ct < b)
        return hf[m].mean() if m.any() else 0.0
    ratios = {}
    for c in range(st, min(st + 8, nb - L - 1)):
        for cp in (c, c + L):
            ratios.setdefault(c, 0.0)
            ratios[c] += win(bt[cp], bt[cp] + 0.5) / (win(bt[cp] - 0.5, bt[cp]) + 1e-3)
    bar_beat = max(ratios, key=ratios.get)
    # every other copy of the 8 bars (identical audio or a re-sung take): mean chroma similarity over the 32 beats
    sims = []
    for Lx in range(8, nb - bar_beat - 32):
        sims.append((float(np.mean(np.einsum('ij,ij->j', cvn[:, bar_beat:bar_beat + 32],
                                                cvn[:, bar_beat + Lx:bar_beat + Lx + 32]))), Lx))
    take_lags = [0]
    for sc, Lx in sorted(sims, reverse=True):
        if sc >= 0.95 and all(abs(Lx - t) > 8 for t in take_lags):
            take_lags.append(Lx)
    take_lags = sorted(take_lags)
    return dict(start_beat=int(st), bar_beat=int(bar_beat), run_beats=int(ln), lag_beats=int(L),
                crash_ratios={int(k): float(v) for k, v in ratios.items()}, copies=[int(c) for c in copies],
                take_lags=[int(t) for t in take_lags], bt=bt)


# ----------------------------------------------------------------------------------------------
# f0 / Viterbi note segmentation
# ----------------------------------------------------------------------------------------------
def crepe_f0(y22, fmin, fmax, cache=None):
    if cache:                                   # cache key = content of the excerpt + range
        import zlib
        key = zlib.crc32(np.round(y22[::37] * 1e4).astype(np.int32).tobytes() + f'{fmin}-{fmax}'.encode())
        cache = cache.replace('.npz', f'_{key:08x}.npz')
    if cache and os.path.exists(cache):
        z = np.load(cache)
        return z['midi'], z['per'], z['db']
    import torch, torchcrepe
    torch.set_num_threads(6)
    y16 = librosa.resample(y22, orig_sr=SR, target_sr=16000)
    x = torch.tensor(np.asarray(y16, dtype=np.float32))[None]
    f0, per = torchcrepe.predict(x, 16000, 160, fmin, fmax, 'full', batch_size=512, device='cpu',
                                 return_periodicity=True, decoder=torchcrepe.decode.viterbi)
    f0 = f0[0].numpy(); per = per[0].numpy()
    rms = librosa.feature.rms(y=y16, frame_length=640, hop_length=160)[0]
    n = min(len(f0), len(rms))
    midi = librosa.hz_to_midi(np.maximum(f0[:n], 1.0))
    db = 20 * np.log10(rms[:n] + 1e-6)
    per = per[:n]
    if cache:
        np.savez(cache, midi=midi, per=per, db=db)
    return midi, per, db


def viterbi_states(midi, per, db, pmin, pmax, db_floor=-32.0, cap=4.0, t_sw=4.0, t_rest=3.0,
                   rest_w=3.0, per_ok=0.0):
    """frame-wise path over {rest} + semitone states. returns int array: 0 = rest, else midi pitch."""
    n = len(midi)
    states = np.arange(pmin, pmax + 1)
    S = len(states) + 1
    conf = np.clip(per, 0, 1)
    loud = (db - db.max()) > db_floor
    d = midi[:, None] - states[None, :]
    emis = np.empty((n, S))
    emis[:, 1:] = np.minimum(d ** 2, cap) * (0.25 + conf[:, None])
    emis[:, 1:] += np.where(loud, 0.0, 0.3)[:, None]
    emis[:, 0] = rest_w * conf * loud + np.where(loud, 0.3, 0.0)
    trans = np.full((S, S), t_sw)
    trans[0, :] = t_rest
    trans[:, 0] = t_rest
    np.fill_diagonal(trans, 0.0)
    cost = np.full((n, S), np.inf)
    back = np.zeros((n, S), dtype=np.int32)
    cost[0] = emis[0]
    for i in range(1, n):
        tot = cost[i - 1][:, None] + trans            # from -> to
        back[i] = np.argmin(tot, axis=0)
        cost[i] = tot[back[i], np.arange(S)] + emis[i]
    path = np.zeros(n, dtype=np.int32)
    path[-1] = int(np.argmin(cost[-1]))
    for i in range(n - 1, 0, -1):
        path[i - 1] = back[i, path[i]]
    return np.where(path == 0, 0, states[np.maximum(path - 1, 0)])





# ----------------------------------------------------------------------------------------------
# note extraction (shared by lead and bass): runs -> cleaned runs -> slot-quantised notes
# ----------------------------------------------------------------------------------------------
def runs_of(a):
    out = []; i = 0; n = len(a)
    while i < n:
        j = i
        while j + 1 < n and a[j + 1] == a[i]:
            j += 1
        out.append([i, j + 1, int(a[i])]); i = j + 1
    return out


def clean_runs(states, per, hop_ms=10, tiny_ms=60, glide_ms=130, d1_ms=170, weak_per=0.5, weak_ms=400,
               fill_rest_ms=50):
    """absorb glide / scoop / unreliable fragments into the neighbouring note (fixes the 'chopped' look of a
    frame-wise f0), fill very short rests between equal pitches."""
    st = states.copy()
    for _ in range(2000):
        r = runs_of(st)
        changed = False
        for k in range(1, len(r) - 1):
            if r[k][2] == 0 and (r[k][1] - r[k][0]) * hop_ms <= fill_rest_ms and r[k - 1][2] == r[k + 1][2] != 0:
                st[r[k][0]:r[k][1]] = r[k - 1][2]; changed = True; break
        if changed:
            continue
        cand = []
        for k, (a, b, p) in enumerate(r):
            if p == 0:
                continue
            ln = (b - a) * hop_ms
            prev = r[k - 1] if k > 0 and r[k - 1][2] != 0 else None
            nxt = r[k + 1] if k + 1 < len(r) and r[k + 1][2] != 0 else None
            if prev is None and nxt is None:
                continue
            opts = sorted([(abs(nb[2] - p), -(nb[1] - nb[0]), nb) for nb in (prev, nxt) if nb is not None],
                          key=lambda x: (x[0], x[1]))
            d, _, nb = opts[0]
            nlen = (nb[1] - nb[0]) * hop_ms
            mper = float(per[a:b].mean())
            ok = (ln < tiny_ms) or (ln < d1_ms and d <= 1 and nlen > ln) or \
                 (ln < glide_ms and d <= 2 and nlen >= 2.5 * ln) or (mper < weak_per and ln <= weak_ms and d <= 1)
            if ok:
                cand.append((ln, k, nb[2]))
        if not cand:
            break
        cand.sort()
        _, k, newp = cand[0]
        st[r[k][0]:r[k][1]] = newp
    return st


def notes_from_states(st, midi, per, db, f_t0, T0, SL, k_lo, k_hi, cfg=None):
    """cleaned frame states -> notes [k0, k1, pitch, vel] on the 16th-note slot grid (slot k starts at T0 + k*SL).
    onset = start of the stable pitch (glides finish before the grid line); end = next onset (legato) or the end of
    the voiced region; internal energy dips (breath / consonant) between equal pitches re-articulate."""
    cfg = cfg or {}
    hop = 0.01
    ftime = lambda i: f_t0 + i * hop
    runs = runs_of(st)
    raw = []
    dbm = uniform_filter1d(db, 5)
    dbref = float(np.median(db[st > 0])) if (st > 0).any() else float(np.median(db))
    for idx, (a, b, p) in enumerate(runs):
        if p == 0:
            continue
        prev_voiced = idx > 0 and runs[idx - 1][2] != 0
        ps = a
        if prev_voiced:
            for i in range(a, b - 2):
                if all(abs(midi[i + j] - p) <= 0.7 for j in range(3)):
                    ps = i; break
        # glide mid-point (the Viterbi switch) is early, the plateau start is late: take the middle
        t_on = 0.5 * (ftime(a) + ftime(ps))
        # end of voiced region (energy decay): last frame whose db is within 14 dB of the run's median
        med = float(np.median(db[a:b]))
        e = b
        while e - 1 > a and dbm[e - 1] < med - 14:
            e -= 1
        next_voiced = idx + 1 < len(runs) and runs[idx + 1][2] != 0
        raw.append(dict(t_on=t_on, a=a, b=b, e=e, p=p, med=med, next_voiced=next_voiced,
                        mper=float(per[a:b].mean())))
    # rests shorter than rest_ms are legato
    rest_ms = cfg.get('rest_ms', 90)
    for i, r in enumerate(raw[:-1]):
        nxt = raw[i + 1]
        gap = (nxt['a'] - r['b']) * 10
        if not r['next_voiced'] and gap < rest_ms:
            r['next_voiced'] = True
    notes = []
    for i, r in enumerate(raw):
        k0 = int(round((r['t_on'] - T0) / SL))
        notes.append([k0, None, r['p'], r['med'], i])
    # end slots
    for i, r in enumerate(raw):
        k0 = notes[i][0]
        if r['next_voiced'] and i + 1 < len(raw):
            k1 = notes[i + 1][0]
        else:
            k1 = int(round((ftime(r['e']) - T0) / SL))
        notes[i][1] = max(k1, k0 + 1)
    # conflicts: identical onsets -> keep the longer; clip to window
    notes.sort(key=lambda n: (n[0], -(n[1] - n[0])))
    out = []
    for n in notes:
        if out and n[0] <= out[-1][0]:
            continue
        if out and n[0] < out[-1][1]:
            out[-1][1] = n[0]
        out.append(n)
    notes = [n for n in out if n[1] > n[0]]
    # split on internal energy dips and merge equal-pitch neighbours without a dip
    dip_db = cfg.get('dip_db', 7.0)
    res = []
    for k0, k1, p, med, i in notes:
        t_a, t_b = T0 + k0 * SL, T0 + k1 * SL
        ia, ib = int(round((t_a - f_t0) / hop)), int(round((t_b - f_t0) / hop))
        ia = max(ia, 0); ib = min(ib, len(db))
        seg = dbm[ia:ib]
        pieces = [[k0, k1]]
        if len(seg) > 40:
            thr = np.median(seg) - dip_db
            low = seg < thr
            j = 0
            while j < len(low):
                if low[j]:
                    s = j
                    while j < len(low) and low[j]:
                        j += 1
                    if (j - s) * hop >= 0.12 and s * hop > 0.25 and (len(low) - j) * hop > 0.15:
                        k_new = int(round((t_a + j * hop - T0) / SL))
                        if k_new - pieces[-1][0] >= 2 and k1 - k_new >= 1:
                            pieces[-1][1] = k_new
                            pieces.append([k_new, k1])
                else:
                    j += 1
        for a_, b_ in pieces:
            res.append([a_, b_, p, med, i])
    # merge equal-pitch neighbours that touch and are not separated by a dip (from the split above)
    merged = []
    for n in res:
        if merged and merged[-1][2] == n[2] and merged[-1][1] == n[0] and n[4] != merged[-1][4] and \
                not cfg.get('keep_repeats', True):
            merged[-1][1] = n[1]
        else:
            merged.append(n)
    out = []
    for k0, k1, p, med, i in merged:
        if k1 <= k_lo or k0 >= k_hi:
            continue
        k0c, k1c = max(k0, k_lo), min(k1, k_hi)
        vel = int(np.clip(round(88 + 2.0 * (med - dbref)), 50, 120))
        out.append(dict(k0=k0c, k1=k1c, pitch=int(p), vel=vel))
    return out


def extract_part(y22, a0, T0, SL, k_lo, k_hi, fmin, fmax, pmin, pmax, cache, cfg=None, vit=None):
    midi, per, db = crepe_f0(y22, fmin, fmax, cache=cache)
    vit = vit or {}
    st = viterbi_states(midi, per, db, pmin, pmax, **vit)
    st2 = clean_runs(st, per, **(cfg or {}).get('clean', {}))
    notes = notes_from_states(st2, midi, per, db, a0, T0, SL, k_lo, k_hi, cfg)
    return notes, dict(midi=midi, per=per, db=db, st=st, st2=st2, f_t0=a0)


# ----------------------------------------------------------------------------------------------
# drums + chords
# ----------------------------------------------------------------------------------------------
def drum_pattern(drums_win, w0, T0, SL, k_lo, k_hi):
    """kick / snare / hat per slot from band-limited onset flux of the drums stem. drums_win starts at time w0."""
    HOP = 64
    D = np.abs(librosa.stft(drums_win, n_fft=1024, hop_length=HOP))
    fr = librosa.fft_frequencies(sr=SR, n_fft=1024)
    ct = librosa.times_like(D[0], sr=SR, hop_length=HOP) + w0

    def band(lo, hi):
        e = np.log1p(D[(fr >= lo) & (fr < hi)].sum(0) * 0.05)
        return np.maximum(0, np.diff(e, prepend=e[0]))
    fl = {'kick': band(35, 130), 'snare': band(150, 450) + band(1500, 4500), 'hat': band(7000, 11000)}
    out = {}
    for name, f in fl.items():
        v = []
        for k in range(k_lo, k_hi):
            t = T0 + k * SL
            m = (ct >= t - 0.02) & (ct < t + 0.05)
            v.append(float(f[m].sum()))
        v = np.array(v)
        out[name] = v
    hits = {}
    ref = {n: np.percentile(v, 99) for n, v in out.items()}
    th = {'kick': 0.30, 'snare': 0.22, 'hat': 0.30}
    for n, v in out.items():
        hits[n] = [k_lo + i for i, x in enumerate(v) if x > th[n] * ref[n]]
    # a kick slot that is also a strong snare stays kick + snare
    return hits, out


TRIADS = {'M': (0, 4, 7), 'm': (0, 3, 7)}


def chord_track(other_win, bass_win, w0, T0, SL, k_lo, k_hi, span_slots=8, min_score=0.80):
    """best major / minor triad per `span_slots` slots from the other + bass chroma. returns list of
    (k0, k1, root_pc, quality, score)."""
    y = other_win + bass_win
    ch = librosa.feature.chroma_cqt(y=y, sr=SR, hop_length=512)
    ct = librosa.times_like(ch, sr=SR, hop_length=512) + w0
    tm = []
    for r in range(12):
        for q, iv in TRIADS.items():
            v = np.zeros(12); v[[(r + i) % 12 for i in iv]] = 1
            tm.append(((r, q), v / np.linalg.norm(v)))
    out = []
    for k in range(k_lo, k_hi, span_slots):
        a, b = T0 + k * SL, T0 + (k + span_slots) * SL
        m = (ct >= a) & (ct < b)
        if not m.any():
            continue
        v = ch[:, m].mean(1); v = v / (np.linalg.norm(v) + 1e-9)
        sc = [float(v @ t) for _, t in tm]
        i = int(np.argmax(sc))
        out.append((k, min(k + span_slots, k_hi), tm[i][0][0], tm[i][0][1], sc[i]))
    return out


# ----------------------------------------------------------------------------------------------
# MIDI
# ----------------------------------------------------------------------------------------------
def write_midi(path, notes, k_lo, SL, bpm, program, name, shift=0):
    import pretty_midi
    pm = pretty_midi.PrettyMIDI(initial_tempo=bpm, resolution=480)
    inst = pretty_midi.Instrument(program=program, name=name)
    for n in notes:
        inst.notes.append(pretty_midi.Note(velocity=n['vel'], pitch=n['pitch'] + shift,
                                           start=(n['k0'] - k_lo) * SL, end=(n['k1'] - k_lo) * SL))
    pm.instruments.append(inst)
    pm.write(path)


def read_midi_notes(path, k_lo, SL):
    import pretty_midi
    pm = pretty_midi.PrettyMIDI(path)
    out = []
    for n in pm.instruments[0].notes:
        out.append(dict(k0=int(round(n.start / SL)) + k_lo, k1=int(round(n.end / SL)) + k_lo, pitch=n.pitch, vel=n.velocity))
    return sorted(out, key=lambda x: x['k0'])


# ----------------------------------------------------------------------------------------------
# synthesis (44.1 kHz) : band-limited pulse lead, 4-bit triangle bass, noise drums, 50 % arpeggio
# ----------------------------------------------------------------------------------------------
def _blep(t, dt):
    out = np.zeros_like(t)
    m = t < dt
    x = t[m] / dt[m] if np.ndim(dt) else t[m] / dt
    out[m] = x + x - x * x - 1.0
    m = t > 1 - dt
    x = (t[m] - 1) / dt[m] if np.ndim(dt) else (t[m] - 1) / dt
    out[m] = x * x + x + x + 1.0
    return out


def pulse_wave(freq, n, duty, sr=SR_OUT):
    freq = np.broadcast_to(np.asarray(freq, dtype=np.float64), (n,)).copy()
    dt = freq / sr
    ph = np.cumsum(dt) % 1.0
    y = np.where(ph < duty, 1.0, -1.0)
    y += _blep(ph, dt)
    y -= _blep((ph - duty) % 1.0, dt)
    return y - (2 * duty - 1)


def tri_wave(freq, n, sr=SR_OUT, bits=4):
    freq = np.broadcast_to(np.asarray(freq, dtype=np.float64), (n,))
    ph = np.cumsum(freq / sr) % 1.0
    w = 2 * np.abs(2 * ph - 1) - 1
    q = 2 ** bits - 1
    return np.round((w * 0.5 + 0.5) * q) / q * 2 - 1


def env_ar(n, a, r, sr=SR_OUT):
    e = np.ones(n)
    a = max(1, min(n, int(sr * a))); r = max(1, min(n, int(sr * r)))
    e[:a] = np.linspace(0, 1, a)
    e[-r:] = np.minimum(e[-r:], np.linspace(1, 0, r))
    return e


def hz(p):
    return 440.0 * 2 ** ((np.asarray(p, dtype=np.float64) - 69) / 12)


def render_notes(notes, k_lo, SL, total_s, shape, shift=0, gate_gap=0.022, vel_depth=0.0, duty=0.25, bits=4,
                 attack=0.003, release=0.020, vibrato=0.0):
    sr = SR_OUT
    out = np.zeros(int(total_s * sr) + sr)
    for i, n in enumerate(notes):
        t0 = (n['k0'] - k_lo) * SL
        t1 = (n['k1'] - k_lo) * SL
        # re-articulation gap: if the next note starts right at the end, close this one a little earlier
        nxt = notes[i + 1] if i + 1 < len(notes) else None
        if nxt is not None and nxt['k0'] <= n['k1']:
            t1 = max(t0 + 0.04, t1 - gate_gap)
        ns = max(8, int((t1 - t0) * sr))
        f = hz(n['pitch'] + shift)
        if vibrato:
            tt = np.arange(ns) / sr
            depth = vibrato * np.clip((tt - 0.18) / 0.15, 0, 1)
            f = f * 2 ** (depth * np.sin(2 * np.pi * 5.5 * tt) / 12)
        if shape == 'pulse':
            w = pulse_wave(f, ns, duty)
        else:
            w = tri_wave(f, ns, bits=bits)
        g = 1.0 if not vel_depth else (1 - vel_depth) + vel_depth * (n['vel'] - 50) / 70
        s = int(round(t0 * sr))
        seg = w * env_ar(ns, attack, release) * g
        out[s:s + ns] += seg[:len(out) - s]
    return out


def render_arp(chords, k_lo, SL, total_s, duty=0.5):
    sr = SR_OUT
    out = np.zeros(int(total_s * sr) + sr)
    for k0, k1, root, q, sc in chords:
        tones = [57 + ((root + iv - 57) % 12) for iv in TRIADS[q]]       # fold into A3..G#4
        tones = sorted(tones)
        pat = [tones[0], tones[1], tones[2], tones[1]]
        for j, k in enumerate(range(k0, k1)):
            t0 = (k - k_lo) * SL
            ns = int(SL * 0.8 * sr)
            w = pulse_wave(hz(pat[j % 4] + 12), ns, duty) * env_ar(ns, 0.002, 0.015)
            s = int(round(t0 * sr))
            out[s:s + ns] += w[:len(out) - s]
    return out


def render_drums(hits, k_lo, SL, total_s, seed=3):
    sr = SR_OUT
    rng = np.random.default_rng(seed)
    out = np.zeros(int(total_s * sr) + sr)

    def put(t, x):
        s = int(round(t * sr)); out[s:s + len(x)] += x[:len(out) - s]
    for k in hits.get('kick', []):
        n = int(sr * 0.13)
        f = np.linspace(170, 48, n)
        ph = np.cumsum(f) / sr
        w = np.round((2 * np.abs(2 * (ph % 1) - 1) - 1) * 7.5) / 7.5
        e = np.exp(-np.arange(n) / (sr * 0.05))
        click = np.zeros(n); c = int(sr * 0.004); click[:c] = rng.choice([-1.0, 1.0], c) * 0.4
        put((k - k_lo) * SL, (w * e + click) * 0.9)
    for k in hits.get('snare', []):
        n = int(sr * 0.16)
        x = np.repeat(rng.choice([-1.0, 1.0], n // 6 + 1), 6)[:n]
        e = np.exp(-np.arange(n) / (sr * 0.045))
        tone = np.sign(np.sin(2 * np.pi * 190 * np.arange(n) / sr)) * np.exp(-np.arange(n) / (sr * 0.02)) * 0.4
        put((k - k_lo) * SL, (x * e * 0.6 + tone) * 0.7)
    for k in hits.get('hat', []):
        n = int(sr * 0.04)
        x = rng.choice([-1.0, 1.0], n)
        x = np.diff(x, prepend=0)
        put((k - k_lo) * SL, x * np.exp(-np.arange(n) / (sr * 0.008)) * 0.25)
    return out


# ----------------------------------------------------------------------------------------------
# audio io / loudness
# ----------------------------------------------------------------------------------------------
def lufs(x, sr=SR_OUT):
    import pyloudnorm as pyln
    return float(pyln.Meter(sr).integrated_loudness(x.astype(np.float64)))


def normalise(x, target=-16.0, peak_ceiling=0.89):
    l = lufs(x)
    g = 10 ** ((target - l) / 20)
    y = x * g
    pk = np.max(np.abs(y))
    limited = False
    if pk > peak_ceiling:                       # soft ceiling instead of hard clipping
        y = np.tanh(y / peak_ceiling * 1.0) * peak_ceiling if pk > 1.2 else y * (peak_ceiling / pk)
        limited = True
    return y, l, lufs(y), float(np.max(np.abs(y))), limited


def write_mp3(path, y, sr=SR_OUT, kbps=192):
    wav = path[:-4] + '.wav'
    sf.write(wav, y.astype(np.float32), sr, subtype='PCM_16')
    subprocess.run(['ffmpeg', '-v', 'error', '-y', '-i', wav, '-codec:a', 'libmp3lame', '-b:a', f'{kbps}k', path], check=True)
    return wav


# ----------------------------------------------------------------------------------------------
# key-aware clean-up + consensus over the repeated takes of the chorus
# ----------------------------------------------------------------------------------------------
def key_scale(notes):
    """major scale (pitch classes) that holds most of the note time."""
    w = np.zeros(12)
    for n in notes:
        w[n['pitch'] % 12] += n['k1'] - n['k0']
    best = max(range(12), key=lambda r: sum(w[(r + i) % 12] for i in (0, 2, 4, 5, 7, 9, 11)))
    return best, {(best + i) % 12 for i in (0, 2, 4, 5, 7, 9, 11)}


def key_cleanup(notes, scale, max_slots=4):
    """a short out-of-key note that touches an in-key note a semitone away is a pitch scoop into / out of it:
    absorb it (the frame-wise f0 shows these as separate 100-300 ms 'notes')."""
    notes = [dict(n) for n in notes]
    changed = True
    while changed:
        changed = False
        for i, n in enumerate(notes):
            if n['pitch'] % 12 in scale or n['k1'] - n['k0'] > max_slots:
                continue
            nxt = notes[i + 1] if i + 1 < len(notes) and notes[i + 1]['k0'] == n['k1'] else None
            prv = notes[i - 1] if i > 0 and notes[i - 1]['k1'] == n['k0'] else None
            if nxt is not None and abs(nxt['pitch'] - n['pitch']) == 1 and nxt['pitch'] % 12 in scale:
                nxt['k0'] = n['k0']; del notes[i]; changed = True; break
            if prv is not None and abs(prv['pitch'] - n['pitch']) == 1 and prv['pitch'] % 12 in scale:
                prv['k1'] = n['k1']; del notes[i]; changed = True; break
    return notes


# ----------------------------------------------------------------------------------------------
# consensus over the repeated takes of the chorus
# ----------------------------------------------------------------------------------------------
def consensus(takes, tol=1):
    """takes[0] is the reference. a note is matched in another take when the pitch is equal and the onset is
    within `tol` slots; onset / end become the median over the takes that carry the note."""
    ref = takes[0]
    out = []
    stats = dict(n=len(ref), matched=[0] * (len(takes) - 1), changed=0)
    for n in ref:
        k0s = [n['k0']]; k1s = [n['k1']]
        for ti, other in enumerate(takes[1:]):
            m = [o for o in other if o['pitch'] == n['pitch'] and abs(o['k0'] - n['k0']) <= tol]
            if m:
                o = min(m, key=lambda o: abs(o['k0'] - n['k0']))
                k0s.append(o['k0']); k1s.append(o['k1']); stats['matched'][ti] += 1
        k0 = int(np.median(k0s)); k1 = int(np.median(k1s))
        if (k0, k1) != (n['k0'], n['k1']):
            stats['changed'] += 1
        out.append(dict(n, k0=k0, k1=max(k1, k0 + 1)))
    for i in range(len(out) - 1):                       # keep the sequence monotone, no overlaps
        if out[i]['k1'] > out[i + 1]['k0']:
            out[i]['k1'] = out[i + 1]['k0']
    return out, stats


# ----------------------------------------------------------------------------------------------
# checks
# ----------------------------------------------------------------------------------------------
def basic_pitch_notes(wav, fmin_midi, fmax_midi, min_len_ms=80):
    from basic_pitch.inference import predict, Model
    from basic_pitch import ICASSP_2022_MODEL_PATH
    m = Model(ICASSP_2022_MODEL_PATH)
    _, _, ne = predict(wav, m, onset_threshold=0.5, frame_threshold=0.3, minimum_note_length=min_len_ms,
                       minimum_frequency=librosa.midi_to_hz(fmin_midi), maximum_frequency=librosa.midi_to_hz(fmax_midi),
                       melodia_trick=True, multiple_pitch_bends=False)
    return [dict(t0=float(s), t1=float(e), pitch=int(p), amp=float(a)) for s, e, p, a, _ in sorted(ne, key=lambda x: x[0])]


def note_match_stats(ref_notes, est_notes, tol_s):
    """mir_eval onset+pitch F-measure (offset ignored), pitch tolerance 50 cents (= exact semitone)."""
    import mir_eval
    ri = np.array([[n['t0'], n['t1']] for n in ref_notes]); rp = librosa.midi_to_hz([n['pitch'] for n in ref_notes])
    if not est_notes:
        return dict(precision=0.0, recall=0.0, f1=0.0, tol_ms=tol_s * 1000)
    ei = np.array([[n['t0'], n['t1']] for n in est_notes]); ep = librosa.midi_to_hz([n['pitch'] for n in est_notes])
    p, r, f, _ = mir_eval.transcription.precision_recall_f1_overlap(ri, rp, ei, ep, onset_tolerance=tol_s,
                                                                    pitch_tolerance=50.0, offset_ratio=None)
    return dict(precision=float(p), recall=float(r), f1=float(f), tol_ms=round(tol_s * 1000, 1))


def per_note_match(ref_notes, est_notes, tol_s):
    rows = []
    for n in ref_notes:
        c = [e for e in est_notes if abs(e['t0'] - n['t0']) <= tol_s * 2]
        if c:
            e = min(c, key=lambda e: abs(e['t0'] - n['t0']))
            rows.append(dict(ref=note_name(n['pitch']), est=note_name(e['pitch']), onset_err_ms=round((e['t0'] - n['t0']) * 1000, 1),
                             pitch_ok=bool(e['pitch'] == n['pitch'])))
        else:
            rows.append(dict(ref=note_name(n['pitch']), est=None, onset_err_ms=None, pitch_ok=False))
    return rows


def coverage_vs_vocal(notes, midi, per, db, f_t0, T0, SL, k_lo, k_hi):
    """% of vocal-voiced time in the window covered by a note of the same pitch (+/-0.5, +/-1 semitone, pitch class).
    `stable` = the same, leaving out 70 ms around every note boundary (glides cannot match a quantised note)."""
    hop = 0.01
    t = f_t0 + np.arange(len(midi)) * hop
    t_a, t_b = T0 + k_lo * SL, T0 + k_hi * SL
    voiced = (per >= 0.5) & (db - db.max() >= -25) & (t >= t_a) & (t < t_b)
    idx = np.where(voiced)[0]
    bounds = np.array([T0 + n['k0'] * SL for n in notes] + [T0 + n['k1'] * SL for n in notes])
    cnt = dict(any=0, exact=0, w1=0, pc=0, s_n=0, s_exact=0, s_w1=0)
    for i in idx:
        k = (t[i] - T0) / SL
        n = next((n for n in notes if n['k0'] <= k < n['k1']), None)
        if n is None:
            continue
        cnt['any'] += 1
        d = midi[i] - n['pitch']
        cnt['exact'] += abs(d) <= 0.5
        cnt['w1'] += abs(d) <= 1.0
        cnt['pc'] += (round(midi[i]) - n['pitch']) % 12 == 0
        if np.min(np.abs(bounds - t[i])) > 0.07:
            cnt['s_n'] += 1
            cnt['s_exact'] += abs(d) <= 0.5
            cnt['s_w1'] += abs(d) <= 1.0
    N = max(1, len(idx))
    return dict(voiced_frames=int(len(idx)), voiced_s=round(len(idx) * hop, 2), any_note=round(100 * cnt['any'] / N, 1),
                same_pitch_exact=round(100 * cnt['exact'] / N, 1), within_1_semitone=round(100 * cnt['w1'] / N, 1),
                same_pitch_class_any_octave=round(100 * cnt['pc'] / N, 1),
                stable_part_same_pitch_exact=round(100 * cnt['s_exact'] / max(1, cnt['s_n']), 1),
                stable_part_within_1_semitone=round(100 * cnt['s_w1'] / max(1, cnt['s_n']), 1),
                stable_part_share_of_voiced=round(100 * cnt['s_n'] / N, 1))


def drum_onsets(y, w0, hop=64, agg=np.median, delta=0.15):
    """drum onsets (seconds, absolute) from a drums-like signal (agg=np.mean for a band-limited signal)."""
    oenv = librosa.onset.onset_strength(y=y, sr=SR, hop_length=hop, aggregate=agg)
    on = librosa.onset.onset_detect(onset_envelope=oenv, sr=SR, hop_length=hop, units='time', backtrack=False,
                                    delta=delta, wait=int(0.045 * SR / hop))
    return on + w0


def onset_alignment(ref_on, est_on, grid_t0, SL):
    """ref_on: onsets of the original drums stem; est_on: onsets of the 8-bit drum track. An original onset is
    'matched' when a render onset lies within half a 16th; errors are reported for the matched ones."""
    ref_on = np.asarray(ref_on); est_on = np.asarray(est_on)
    d = np.array([est_on[np.argmin(np.abs(est_on - r))] - r for r in ref_on])
    m = np.abs(d) <= SL / 2
    res = dict(n_orig_onsets=int(len(ref_on)), n_render_onsets=int(len(est_on)), matched_within_half_16th=round(100 * float(m.mean()), 1),
               matched_median_err_ms=round(float(np.median(d[m]) * 1000), 1), matched_mean_abs_err_ms=round(float(np.mean(np.abs(d[m])) * 1000), 1),
               matched_within_20ms=round(100 * float(np.mean(np.abs(d[m]) <= 0.02)), 1),
               matched_within_1_16_beat_29ms=round(100 * float(np.mean(np.abs(d[m]) <= SL / 4)), 1))
    g = (ref_on - grid_t0) / SL
    dev = (g - np.round(g)) * SL
    res['orig_onsets_vs_16th_grid_median_ms'] = round(float(np.median(dev) * 1000), 1)
    res['orig_onsets_vs_16th_grid_mean_abs_ms'] = round(float(np.mean(np.abs(dev)) * 1000), 1)
    res['orig_onsets_within_20ms_of_grid_pct'] = round(100 * float(np.mean(np.abs(dev) <= 0.02)), 1)
    # reverse: render hits that have no original onset near them (invented hits)
    d2 = np.array([ref_on[np.argmin(np.abs(ref_on - e))] - e for e in est_on])
    res['render_hits_with_orig_onset_within_half_16th_pct'] = round(100 * float(np.mean(np.abs(d2) <= SL / 2)), 1)
    return res


def grid_phase_ms(y22, t_start, T0, SL):
    """phase (ms, relative to the exact 16th grid through T0, in [-SL/2, SL/2)) at which the onset envelope of y22 peaks
    when folded modulo the 16th period; y22 starts at absolute time t_start."""
    hop = 64
    env = librosa.onset.onset_strength(y=y22, sr=SR, hop_length=hop, aggregate=np.median)
    t = np.arange(len(env)) * hop / SR + t_start
    ph = ((t - T0) % SL) / SL
    h = np.bincount((ph * 100).astype(int) % 100, weights=env, minlength=100)
    hs = uniform_filter1d(h, 5, mode='wrap')
    p = (np.argmax(hs) + 0.5) / 100
    p = p if p < 0.5 else p - 1
    return round(float(p * SL * 1000), 1)


def draw_roll(path, lead, bass, hits, info, T0, SL, k_lo, k_hi, bpm, w0, title):
    import matplotlib
    matplotlib.use('Agg')
    import matplotlib.pyplot as plt
    from matplotlib.patches import Rectangle
    fig, (ax, ax2) = plt.subplots(2, 1, figsize=(20, 10), gridspec_kw=dict(height_ratios=[3, 2]), sharex=True)
    t_a, t_b = T0 + k_lo * SL, T0 + k_hi * SL
    f_t0 = info['f_t0']
    t = f_t0 + np.arange(len(info['midi'])) * 0.01
    m = (t >= t_a) & (t < t_b)
    conf = np.clip(info['per'][m], 0, 1)
    ok = (conf > 0.45) & (info['db'][m] - info['db'].max() > -35)
    sc = ax.scatter(t[m][ok], info['midi'][m][ok], c=conf[ok], cmap='Greys', vmin=0.2, vmax=1.0, s=7, zorder=2,
                    label='vocal stem f0 (torchcrepe, shade = periodicity)')
    cols = plt.cm.tab10(np.arange(10))
    for i, n in enumerate(lead):
        x0, x1 = T0 + n['k0'] * SL, T0 + n['k1'] * SL
        ax.add_patch(Rectangle((x0, n['pitch'] - 0.45), x1 - x0, 0.9, facecolor=cols[i % 10], alpha=0.45, edgecolor='k', lw=0.8, zorder=3))
        ax.text(x0 + 0.01, n['pitch'] + 0.55, note_name(n['pitch']), fontsize=7, zorder=4)
    for k in range(k_lo, k_hi + 1):
        x = T0 + k * SL
        ax.axvline(x, color='tab:blue' if k % 16 == 0 else ('gray' if k % 4 == 0 else '#dddddd'),
                   lw=1.6 if k % 16 == 0 else (0.7 if k % 4 == 0 else 0.4), zorder=1)
        ax2.axvline(x, color='tab:blue' if k % 16 == 0 else ('gray' if k % 4 == 0 else '#dddddd'),
                    lw=1.6 if k % 16 == 0 else (0.7 if k % 4 == 0 else 0.4), zorder=1)
    ps = [n['pitch'] for n in lead]
    ax.set_ylim(min(ps) - 3, max(ps) + 3)
    ax.set_ylabel('MIDI pitch (vocal register)')
    ax.set_title(f'{title}   BPM {bpm:.1f}  bar 1 = {T0:.2f}s (blue lines = bar lines, grey = beats, faint = 16ths)', fontsize=10)
    ax.legend(loc='upper right', fontsize=8)
    for i, n in enumerate(bass):
        x0, x1 = T0 + n['k0'] * SL, T0 + n['k1'] * SL
        ax2.add_patch(Rectangle((x0, n['pitch'] - 0.45), x1 - x0, 0.9, facecolor='tab:green', alpha=0.5, edgecolor='k', lw=0.6, zorder=3))
    bp = [n['pitch'] for n in bass]
    lo = min(bp) - 2
    ax2.set_ylim(lo - 7, max(bp) + 3)
    for row, (name, c) in enumerate((('kick', 'tab:red'), ('snare', 'tab:orange'), ('hat', 'tab:purple'))):
        for k in hits.get(name, []):
            ax2.plot([T0 + k * SL + SL / 2], [lo - 1.5 - row * 2], marker='s', color=c, ms=5, zorder=4)
        ax2.text(t_a - 0.02, lo - 1.5 - row * 2, name, ha='right', va='center', fontsize=7)
    ax2.set_ylabel('bass MIDI pitch / drum hits')
    ax2.set_xlim(t_a, t_b)
    ax2.set_xlabel('time in the original song (s, stem timeline)')
    plt.tight_layout()
    plt.savefig(path, dpi=100)
    plt.close()


# ----------------------------------------------------------------------------------------------
# main
# ----------------------------------------------------------------------------------------------
def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--chip-dir', default=os.path.join(SCRATCH, 'chip'))
    ap.add_argument('--out', default=HERE)
    ap.add_argument('--bar-beat', type=int, default=None, help='override the detected chorus bar line (beat index)')
    ap.add_argument('--no-arp', action='store_true')
    ap.add_argument('--vibrato', type=float, default=0.0, help='lead vibrato depth in semitones (0 = off)')
    ap.add_argument('--skip-checks', action='store_true')
    args = ap.parse_args()
    out = os.path.abspath(args.out)
    work = os.path.join(out, 'work')
    os.makedirs(work, exist_ok=True)
    S = os.path.join(args.chip_dir, 'sep/htdemucs/song')
    song = os.path.join(args.chip_dir, 'song.mp3')
    ld = lambda n: librosa.load(f'{S}/{n}.wav', sr=SR, mono=True)[0]
    voc, drm, bas, oth = ld('vocals'), ld('drums'), ld('bass'), ld('other')
    dur = len(drm) / SR
    R = {}

    # 1. grid
    bpm, off = detect_grid(drm)
    BEAT = 60.0 / bpm
    SL = BEAT / 4
    log(f'[grid] BPM {bpm}  phase {off:.4f}s (stem timeline)')
    # 2. chorus
    ch = detect_chorus(voc, drm, bpm, off, dur)
    bar_beat = args.bar_beat if args.bar_beat is not None else ch['bar_beat']
    log(f"[chorus] repeated vocal run starts at beat {ch['start_beat']} ({ch['run_beats']} beats, lag {ch['lag_beats']}), "
        f"bar line at beat {bar_beat} (crash ratios {ch['crash_ratios']}), takes at lags {ch['take_lags']}")
    T0 = off + bar_beat * BEAT
    PICK = 1
    k_lo, k_hi = -4 * PICK, 128
    w0 = T0 + k_lo * SL
    w1 = T0 + k_hi * SL
    total_s = w1 - w0
    PAD = 0.6
    log(f'[window] 8 bars {T0:.3f}s -> {w1:.3f}s ({T0 / 60:.0f}:{T0 % 60:05.2f} - {int(w1 // 60)}:{w1 % 60:05.2f}), '
        f'1-beat pickup from {w0:.3f}s; bar numbers are counted from the bar line')
    R.update(bpm=bpm, grid_phase_s=off, bar_beat=bar_beat, bar1_start_s=T0, end_s=w1, window_start_s=w0, pickup_beats=PICK,
             take_lags=ch['take_lags'], crash_ratios=ch['crash_ratios'])

    # 3. lead over all takes -> consensus
    takes_notes = []; infos = []
    for ti, lag in enumerate(ch['take_lags']):
        T0t = T0 + lag * BEAT
        a0 = T0t + k_lo * SL - PAD
        seg = voc[int(a0 * SR):int((T0t + k_hi * SL + PAD) * SR)]
        notes, info = extract_part(seg, a0, T0t, SL, k_lo, k_hi, 60, 1200, 45, 86, os.path.join(work, f'lead_crepe_take{ti + 1}_{int(round(a0 * 1000))}.npz'))
        takes_notes.append(notes); infos.append(info)
        log(f'[lead] take {ti + 1} (lag {lag} beats): {len(notes)} notes')
    root, scale = key_scale(takes_notes[0])
    log(f'[key] {NAMES[root]} major / {NAMES[(root + 9) % 12]} minor scale holds the melody; out-of-key short notes are scoops')
    R['key'] = f'{NAMES[root]} major'
    takes_notes = [key_cleanup(t, scale) for t in takes_notes]
    log('[lead] notes per take after key clean-up: ' + str([len(t) for t in takes_notes]))
    lead, cstat = consensus(takes_notes)
    log(f"[lead] consensus: {len(lead)} notes; matched in other takes {cstat['matched']}; boundaries changed {cstat['changed']}")
    R['lead_takes'] = dict(n_notes=[len(t) for t in takes_notes], consensus_matches=cstat['matched'], boundaries_changed=cstat['changed'])
    # note table for the report
    for n in lead:
        log(f"   slot {n['k0']:4d}-{n['k1']:4d}  bar {n['k0'] // 16 + 1}.{(n['k0'] % 16) / 4 + 1:.2f}  {note_name(n['pitch']):>4}")

    # 4. bass
    a0b = w0 - PAD
    segb = bas[int(a0b * SR):int((w1 + PAD) * SR)]
    bcfg = dict(clean=dict(tiny_ms=50, glide_ms=100, d1_ms=110, weak_per=0.4, weak_ms=200, fill_rest_ms=60), rest_ms=80, dip_db=99)
    bass, binfo = extract_part(segb, a0b, T0, SL, k_lo, k_hi, 33, 500, 26, 62, os.path.join(work, f'bass_crepe_{int(round(a0b * 1000))}.npz'), cfg=bcfg,
                               vit=dict(db_floor=-30))
    log(f'[bass] {len(bass)} notes')

    # 5. drums
    drums_win = drm[int(w0 * SR):int(w1 * SR)]
    hits, dflux = drum_pattern(drums_win, w0, T0, SL, k_lo, k_hi)
    log(f"[drums] hits  kick {len(hits['kick'])}  snare {len(hits['snare'])}  hat {len(hits['hat'])}")

    # 6. chords
    chords = []
    if not args.no_arp:
        oth_win = oth[int(w0 * SR):int(w1 * SR)]; bas_win = bas[int(w0 * SR):int(w1 * SR)]
        allc = chord_track(oth_win, bas_win, w0, T0, SL, k_lo, k_hi)
        chords = [c for c in allc if c[4] >= 0.80]
        log(f'[chords] {len(chords)}/{len(allc)} half-bars with a confident triad (score>=0.80): '
            + ' '.join(f'{NAMES[c[2]]}{c[3]}' for c in chords))
        R['chords_confident'] = f'{len(chords)}/{len(allc)}'

    # 7. MIDI
    mid_lead = os.path.join(out, 'chorus_lead.mid'); mid_bass = os.path.join(out, 'chorus_bass.mid')
    write_midi(mid_lead, lead, k_lo, SL, bpm, 80, 'lead (vocal register)')
    write_midi(mid_bass, bass, k_lo, SL, bpm, 38, 'bass')
    lead_rt = read_midi_notes(mid_lead, k_lo, SL)
    assert [(n['k0'], n['k1'], n['pitch']) for n in lead_rt] == [(n['k0'], n['k1'], n['pitch']) for n in lead], 'MIDI round trip'
    R['n_lead_notes'] = len(lead); R['n_bass_notes'] = len(bass)

    # 8. render
    LEAD_SHIFT = 12
    x_lead = render_notes(lead, k_lo, SL, total_s, 'pulse', shift=LEAD_SHIFT, duty=0.25, vibrato=args.vibrato)
    x_bass = render_notes(bass, k_lo, SL, total_s, 'tri', shift=0, bits=4, attack=0.002, release=0.015, gate_gap=0.025)
    x_drum = render_drums(hits, k_lo, SL, total_s)
    x_arp = render_arp(chords, k_lo, SL, total_s) if chords else np.zeros_like(x_lead)
    n_out = int(total_s * SR_OUT)
    pad = lambda x: x[:n_out] if len(x) >= n_out else np.pad(x, (0, n_out - len(x)))
    x_lead, x_bass, x_drum, x_arp = map(pad, (x_lead, x_bass, x_drum, x_arp))
    y_lead, l0, l1, pk, lim = normalise(x_lead)
    wav_lead = write_mp3(os.path.join(out, 'chorus_8bit_lead.mp3'), y_lead)
    R['lead_only'] = dict(lufs_before=round(l0, 1), lufs=round(l1, 1), peak_dbfs=round(20 * np.log10(pk), 1), limited=lim)
    G = dict(lead=0.55, bass=0.50, drums=0.62, arp=0.085)
    mix = G['lead'] * x_lead + G['bass'] * x_bass + G['drums'] * x_drum + G['arp'] * x_arp
    comp = {k: round(lufs(v * g), 1) for k, v, g in (('lead', x_lead, G['lead']), ('bass', x_bass, G['bass']), ('drums', x_drum, G['drums']))
            }
    if chords:
        comp['arp'] = round(lufs(x_arp * G['arp']), 1)
    y_full, f0_, f1_, pkf, limf = normalise(mix)
    wav_full = write_mp3(os.path.join(out, 'chorus_8bit_full.mp3'), y_full)
    R['full'] = dict(lufs_before=round(f0_, 1), lufs=round(f1_, 1), peak_dbfs=round(20 * np.log10(pkf), 1), limited=limf,
                     component_lufs_before_norm=comp)
    log(f"[render] lead-only {R['lead_only']}  full {R['full']}")

    # original excerpt (stems timeline is 23 ms later than the mp3 decode)
    from scipy.signal import correlate
    mixd, _ = librosa.load(song, sr=SR, mono=True)
    stsum = sum([voc, drm, bas, oth])
    n_ = min(len(mixd), len(stsum))
    a_, b_ = mixd[int(30 * SR):int(60 * SR)], stsum[int(30 * SR):int(60 * SR)]
    lag_s = (np.argmax(correlate(a_, b_, mode='full', method='fft')) - (len(b_) - 1)) / SR      # <0: stems later
    t_cut = w0 + lag_s
    subprocess.run(['ffmpeg', '-v', 'error', '-y', '-ss', f'{t_cut:.4f}', '-t', f'{total_s:.4f}', '-i', song,
                    '-codec:a', 'libmp3lame', '-b:a', '192k', os.path.join(out, 'chorus_orig.mp3')], check=True)
    orig, _ = librosa.load(os.path.join(out, 'chorus_orig.mp3'), sr=SR_OUT, mono=True)
    R['orig'] = dict(cut_start_in_mp3_s=round(t_cut, 4), stems_vs_mp3_lag_ms=round(lag_s * 1000, 2), lufs=round(lufs(orig), 1))

    # ------------------------------------------------------------------ checks
    if not args.skip_checks:
        chk = {}
        # (a) re-transcribe the 8-bit lead and compare with the cleaned MIDI
        ref = [dict(t0=(n['k0'] - k_lo) * SL, t1=(n['k1'] - k_lo) * SL, pitch=n['pitch'] + LEAD_SHIFT) for n in lead]
        bp_notes = basic_pitch_notes(wav_lead, 55, 100)
        chk['a_basic_pitch'] = dict(n_est=len(bp_notes), n_ref=len(ref),
                                    tol_1_16_beat=note_match_stats(ref, bp_notes, SL / 4),
                                    tol_1_16_note=note_match_stats(ref, bp_notes, SL))
        # monophonic re-transcription with the same CREPE pipeline as the extraction
        y22 = librosa.resample(y_lead, orig_sr=SR_OUT, target_sr=SR)
        y22p = np.pad(y22, (int(PAD * SR), int(PAD * SR)))
        # same extraction but with T0 expressed on the render's own timeline (window start = 0)
        rn, rinfo = extract_part(y22p, -PAD, -k_lo * SL, SL, k_lo, k_hi, 150, 1800, 55, 100, os.path.join(work, 'render_crepe.npz'))
        rn_notes = [dict(t0=(n['k0'] - k_lo) * SL, t1=(n['k1'] - k_lo) * SL, pitch=n['pitch']) for n in rn]
        ref_set = {(n['k0'], n['pitch']) for n in lead}
        est_set = {(n['k0'], n['pitch'] - LEAD_SHIFT) for n in rn}
        ref_set_t = {(k0, p) for k0, p in ref_set}
        chk['a_crepe_pipeline'] = dict(n_est=len(rn_notes), n_ref=len(ref),
                                       tol_1_16_beat=note_match_stats(ref, rn_notes, SL / 4),
                                       tol_1_16_note=note_match_stats(ref, rn_notes, SL),
                                       exact_onset_slot_and_pitch=len(ref_set & est_set),
                                       ref_notes_not_found=[f'slot {k}:{note_name(p)}' for k, p in sorted(ref_set - est_set)],
                                       extra_est_notes=[f'slot {k}:{note_name(p)}' for k, p in sorted(est_set - ref_set)])
        chk['a_basic_pitch']['per_note'] = per_note_match(ref, bp_notes, SL)
        # (b) coverage against the vocal stem pitch track (take 1)
        i0 = infos[0]
        chk['b_vocal_coverage'] = coverage_vs_vocal(lead, i0['midi'], i0['per'], i0['db'], i0['f_t0'], T0, SL, k_lo, k_hi)
        # (c) note-length histogram, 16th units
        ln = np.array([n['k1'] - n['k0'] for n in lead])
        hist = {int(v): int((ln == v).sum()) for v in sorted(set(ln))}
        bl = np.array([n['k1'] - n['k0'] for n in bass])
        chk['c_note_lengths_16ths'] = dict(lead_hist=hist, lead_shorter_than_16th=int((ln < 1).sum()), lead_min=int(ln.min()),
                                           lead_median=float(np.median(ln)),
                                           bass_hist={int(v): int((bl == v).sum()) for v in sorted(set(bl))},
                                           bass_shorter_than_16th=int((bl < 1).sum()))
        # (d) onset alignment
        ref_on = drum_onsets(drums_win, w0)
        # the render's drum track alone, written on the same timeline
        x22 = librosa.resample(x_drum, orig_sr=SR_OUT, target_sr=SR)
        est_on = drum_onsets(x22, w0)
        chk['d_onsets_drums_render_vs_orig'] = onset_alignment(ref_on, est_on, T0, SL)
        # same, restricted to the kick / snare body band (35-450 Hz) where the hits of both signals are unambiguous
        from scipy.signal import butter, sosfilt
        sos = butter(4, [35, 450], btype='band', fs=SR, output='sos')
        chk['d_onsets_kick_snare_band_render_vs_orig'] = onset_alignment(
            drum_onsets(sosfilt(sos, drums_win), w0, agg=np.mean, delta=0.1),
            drum_onsets(sosfilt(sos, x22), w0, agg=np.mean, delta=0.1), T0, SL)
        # 16th-grid phase (onset envelope folded modulo the 16th) of: original drums stem / original excerpt (mp3) /
        # 8-bit drums / 8-bit full mix / 8-bit lead; all measured against the same exact 128 BPM grid through bar 1
        orig22 = librosa.resample(orig, orig_sr=SR_OUT, target_sr=SR)
        full22 = librosa.resample(y_full, orig_sr=SR_OUT, target_sr=SR)
        chk['d_16th_grid_phase_ms'] = dict(
            original_drums_stem=grid_phase_ms(drums_win, w0, T0, SL),
            original_excerpt_mp3=grid_phase_ms(orig22, w0, T0, SL),
            render_drums=grid_phase_ms(x22, w0, T0, SL),
            render_full=grid_phase_ms(full22, w0, T0, SL),
            render_lead_only=grid_phase_ms(librosa.resample(y_lead, orig_sr=SR_OUT, target_sr=SR), w0, T0, SL))
        # cut alignment: excerpt mp3 against the stems window (lag 0 expected)
        sw = (voc + drm + bas + oth)[int(w0 * SR):int(w1 * SR)]
        nn = min(len(sw), len(orig22))
        lag_cut = (np.argmax(correlate(orig22[:nn], sw[:nn], mode='full', method='fft')) - (nn - 1)) / SR
        chk['d_orig_cut_vs_stems_window_lag_ms'] = round(lag_cut * 1000, 2)
        R['checks'] = chk
        # piano roll
        draw_roll(os.path.join(out, 'roll.png'), lead, bass, hits, infos[0], T0, SL, k_lo, k_hi, bpm, w0,
                  f'chorus 8 bars: cleaned lead MIDI over the vocal f0 ({len(lead)} notes)')
    # decoded mp3s: length, peak, loudness (no clipping, lead and full the same length as the original excerpt)
    R['mp3'] = {}
    for nm in ('chorus_orig', 'chorus_8bit_lead', 'chorus_8bit_full'):
        yy, _ = librosa.load(os.path.join(out, nm + '.mp3'), sr=SR_OUT, mono=True)
        R['mp3'][nm] = dict(seconds=round(len(yy) / SR_OUT, 3), peak_dbfs=round(float(20 * np.log10(np.max(np.abs(yy)))), 2),
                            lufs=round(lufs(yy), 1))
    with open(os.path.join(out, 'result.json'), 'w') as f:
        json.dump(R, f, indent=1, ensure_ascii=False)
    log(json.dumps(R, indent=1, ensure_ascii=False))


if __name__ == '__main__':
    main()
