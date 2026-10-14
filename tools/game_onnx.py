"""GAME (openvpi, 歌声 → 音符) の ONNX を onnxruntime で回す。torch 版 infer.py と同じ既定値
(境界の閾値 0.2 ・ 半径 0.02 秒 = 2 フレーム ・ D3PM 8 段 t = 0, 0.125, ... ・ 音の有無の閾値 0.2)。
使い方: python game_onnx.py <model_dir> <wav> <start_s> <dur_s> <out.json> [lang]"""
import json, sys
import numpy as np, librosa, onnxruntime as ort

mdir, wav, start, dur, out = sys.argv[1], sys.argv[2], float(sys.argv[3]), float(sys.argv[4]), sys.argv[5]
lang = sys.argv[6] if len(sys.argv) > 6 else 'ja'
cfg = json.load(open(f'{mdir}/config.json'))
sr = cfg['samplerate']
y, _ = librosa.load(wav, sr=sr, mono=True, offset=start, duration=dur)
y = y.astype(np.float32)
opt = ort.SessionOptions(); opt.log_severity_level = 3
S = {n: ort.InferenceSession(f'{mdir}/{n}.onnx', opt, providers=['CPUExecutionProvider']) for n in ['encoder', 'dur2bd', 'segmenter', 'bd2dur', 'estimator']}
D = np.array([len(y) / sr], np.float32)
x_seg, x_est, maskT = S['encoder'].run(None, {'waveform': y[None], 'duration': D})
known = S['dur2bd'].run(None, {'durations': D[None], 'maskT': maskT})[0]
prev = known
lang_id = np.array([cfg['languages'].get(lang, 0)], np.int64)
steps = 8
for i in range(steps):
    prev = S['segmenter'].run(None, {'x_seg': x_seg, 'language': lang_id, 'known_boundaries': known, 'prev_boundaries': prev,
                                     't': np.array([i / steps], np.float32), 'maskT': maskT,
                                     'threshold': np.array(0.2, np.float32), 'radius': np.array(2, np.int64)})[0]
durs, maskN = S['bd2dur'].run(None, {'boundaries': prev, 'maskT': maskT})
pres, scores = S['estimator'].run(None, {'x_est': x_est, 'boundaries': prev, 'maskT': maskT, 'maskN': maskN, 'threshold': np.array(0.2, np.float32)})
notes, t = [], start
for d, m, p, s in zip(durs[0], maskN[0], pres[0], scores[0]):
    if not m: continue
    if p: notes.append({'start': round(float(t), 3), 'dur': round(float(d), 3), 'pitch': round(float(s), 2)})
    t += float(d)
json.dump({'notes': notes, 'lang': lang, 'start': start, 'dur': dur}, open(out, 'w'), indent=1)
print(len(notes), 'notes')
