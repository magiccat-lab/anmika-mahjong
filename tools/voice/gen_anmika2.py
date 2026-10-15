"""アンミカさんの声で煽りのセリフを作り直す (2026-10-15 駿、2 回目)。1 回目は声の素に男性の司会の声が混じっていた。
mode refs: 本人だけの切れ端 (pick_anmika.py、似ている度合いの高い順に 110 秒) を声の素に渡す
mode embed: 同じ切れ端 6.8 分で学習した話者の埋め込み (Speaker Inversion) を使う
  PYTHONPATH=<repo_v4> irodori の python gen_anmika2.py <refs|embed> <out dir> [embed の safetensors]
"""
import json
import sys
from pathlib import Path

from irodori_tts.inference_runtime import InferenceRuntime, RuntimeKey, SamplingRequest, save_wav

D = Path(__file__).resolve().parent / "anmika_voice"
mode, OUT = sys.argv[1], Path(sys.argv[2])
OUT.mkdir(parents=True, exist_ok=True)
CKPT = "/home/m-catlab/.cache/huggingface/hub/models--Aratako--Irodori-TTS-v4.1-Small/snapshots/2b28324dc263ed5e6638b3cf3dd94c82ead07b4b/model.safetensors"
import os
DEV = os.environ.get("DEV", "cuda")  # GPU が学習で埋まっている時は DEV=cpu
PREC = "bf16" if DEV == "cuda" else "fp32"
rt = InferenceRuntime.from_key(RuntimeKey(checkpoint=CKPT, model_device=DEV, model_precision=PREC, codec_device=DEV, codec_precision=PREC))
cond = {"ref_wavs": [str(D / "clips" / f) for f in json.load(open(D / "refs_v2.json"))]} if mode == "refs" else {"ref_embed": sys.argv[3]}
CAP_T = "関西弁の明るく華やかな大人の女性が、相手の甘い一打に呆れて、勢いよくツッコミを入れている。"
CAP_Y = "関西弁の明るく華やかな大人の女性が、とんでもない事が起きて驚き、大げさに叫んでいる。"
LINES = [("aori", "どっから切っとんねーん！", CAP_T), ("yakuman_a", "えらいこっちゃ！やくまんやで！", CAP_Y),
         ("yakuman_b", "やくまん振り込むなんて、痛みにも二百色あんねん！", CAP_Y)]
SEEDS = (1, 2, 3, 4)
if os.environ.get("ONLY") == "aori_kana":
    # 「切っとんねーん」が「きっとねー」と読まれやすいので、かなで渡して種を増やす
    LINES, SEEDS = [("aori_kana", "どっから、きっとんねーん！", CAP_T)], tuple(range(1, 9))
for name, text, cap in LINES:
    for seed in SEEDS:
        res = rt.synthesize(SamplingRequest(text=text, caption=cap, seed=seed, **cond))
        save_wav(str(OUT / f"{mode}_{name}_s{seed}.wav"), res.audio, int(res.sample_rate))
        print(mode, name, seed, flush=True)
