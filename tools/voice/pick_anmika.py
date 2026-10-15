"""アンミカさん本人の声の切れ端だけを集める (2026-10-15 駿)。先輩「声がアンミカじゃない、アンミカの声の学習が下手」「役満やで、は男の声」。
1 回目は声の素に男性の司会 (小原ブラスさん) と、アンミカさんが旦那さんの口調を真似た低い声が混じっていた。
- 文字起こしの区切りごとに、話者の特徴 (resemblyzer の埋め込み) と音の高さ (yin) を取る
- 種 = 確実に本人の所 (B-side Talk #23 の 04:07〜04:47 の答え) の平均に近い物を集め、平均を取り直して 3 回回す
- 似ている度合い 0.87 以上 (本人 0.92〜0.95、女性の司会 0.80 前後、男性の司会 0.67〜0.74 を確かめた)。yin の高さは本人でも 70〜120Hz と出てぶれるので使わない
出力: <out>/clips/*.wav (48kHz) と clips.json (text ・ 元 ・ 秒 ・ 似ている度合い)
  PYTHONPATH=<pylib> irodori の python pick_anmika.py <anmika_voice dir>
"""
import json
import sys
from pathlib import Path

import librosa
import numpy as np
import soundfile as sf
from resemblyzer import VoiceEncoder, preprocess_wav

D = Path(sys.argv[1])
SRC = {"S6fAb2YwBmw": D / "tr2", "uDrFbYSpVWQ": D / "tr_uDrFbYSpVWQ", "zZoaseGqJos": D / "tr_zZoaseGqJos"}
SEED = ("S6fAb2YwBmw", 247.0, 287.0)
enc = VoiceEncoder("cpu")
rows = []
for name, trd in SRC.items():
    tr = json.load(open(trd / "transcript.json", encoding="utf-8"))
    y48, sr = sf.read(D / "src" / f"{name}.wav")
    y16 = librosa.resample(y48.astype(np.float32), orig_sr=sr, target_sr=16000)
    for s in tr["segments"]:
        a, b = float(s["start"]), float(s["end"])
        if b - a < 1.5 or b - a > 15:
            continue
        seg = y16[int(a * 16000):int(b * 16000)]
        w = preprocess_wav(seg, source_sr=16000)
        if len(w) < 16000:
            continue
        f0 = librosa.yin(seg, fmin=70, fmax=450, sr=16000, frame_length=1024)
        en = librosa.feature.rms(y=seg, frame_length=1024, hop_length=512)[0]
        n = min(len(f0), len(en))
        voiced = f0[:n][en[:n] > np.percentile(en[:n], 50)]
        rows.append({"src": name, "start": a, "end": b, "text": s["text"].strip(), "f0": float(np.median(voiced)) if len(voiced) else 0.0,
                     "emb": enc.embed_utterance(w)})
emb = np.stack([r["emb"] for r in rows])
seed = [i for i, r in enumerate(rows) if r["src"] == SEED[0] and SEED[1] <= r["start"] and r["end"] <= SEED[2] and r["f0"] >= 200]
cen = emb[seed].mean(0)
cen /= np.linalg.norm(cen)
for it in range(3):
    sim = emb @ cen
    pick = [i for i, r in enumerate(rows) if sim[i] >= 0.87]
    cen = emb[pick].mean(0)
    cen /= np.linalg.norm(cen)
    print("iter", it, "picked", len(pick), "sec", round(sum(rows[i]["end"] - rows[i]["start"] for i in pick), 1))
sim = emb @ cen
out = D / "clips"
out.mkdir(exist_ok=True)
meta = []
for i in sorted(pick, key=lambda i: -sim[i]):
    r = rows[i]
    y48, sr = sf.read(D / "src" / f"{r['src']}.wav", start=int((r["start"] - 0.05) * 48000), stop=int((r["end"] + 0.1) * 48000))
    f = out / f"{r['src']}_{int(r['start'] * 100):06d}.wav"
    sf.write(f, y48, 48000)
    meta.append({"file": f.name, "src": r["src"], "start": round(r["start"], 2), "sec": round(r["end"] - r["start"], 2), "sim": round(float(sim[i]), 3),
                 "f0": round(r["f0"]), "text": r["text"]})
json.dump(meta, open(D / "clips.json", "w", encoding="utf-8"), ensure_ascii=False, indent=1)
for s in sorted(set(r["src"] for r in rows)):
    print(s, "all", sum(1 for r in rows if r["src"] == s), "picked", sum(1 for m in meta if m["src"] == s))
print("lowest picked:", [(m["sim"], m["f0"], m["text"][:20]) for m in meta[-6:]])
print("rejected near:", [(round(float(sim[i]), 3), round(rows[i]["f0"]), rows[i]["text"][:18]) for i in np.argsort(-sim) if i not in pick][:8])
