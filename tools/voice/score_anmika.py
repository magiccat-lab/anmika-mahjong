"""作った声を採点する: 本人の声の平均 (clips の埋め込みの平均) との近さ (resemblyzer) と、文字起こしがセリフどおりか。
  PYTHONPATH=<pylib> irodori の python score_anmika.py <wav dir>
"""
import glob
import json
import sys
from pathlib import Path

import numpy as np
from resemblyzer import VoiceEncoder, preprocess_wav

D = Path(__file__).resolve().parent / "anmika_voice"
enc = VoiceEncoder("cpu")
clips = [D / "clips" / m["file"] for m in json.load(open(D / "clips.json"))]
cen = np.mean([enc.embed_utterance(preprocess_wav(str(f))) for f in clips], 0)
cen /= np.linalg.norm(cen)
out = {}
for f in sorted(glob.glob(str(Path(sys.argv[1]) / "*.wav"))):
    out[Path(f).name] = round(float(enc.embed_utterance(preprocess_wav(f)) @ cen), 3)
    print(out[Path(f).name], Path(f).name)
json.dump(out, open(Path(sys.argv[1]) / "scores.json", "w"), indent=1)
