# 煽り演出のアンミカさんの声を作る道具 (2026-10-15)

声の 2 回目 (本人の声だけを声の素にした版) を作った手順。出来た声は public/sounds/voice/ (git に入れない)。

1. pick_anmika.py: 文字起こしの区切りごとに話者の埋め込み (resemblyzer) を取り、本人の平均との近さ 0.87 以上だけを切り出す (本人 0.92〜0.95、女性の司会 0.80 前後、男性の司会 0.67〜0.74)
2. build_manifest.py: 切れ端を Irodori-TTS の学習用の manifest にする
3. gen_anmika2.py: 声の素を渡す形 (refs) と、Speaker Inversion で学習した話者の埋め込み (embed) の 2 通りで読ませる
4. score_anmika.py: 出来た声と本人の近さを測り、文字起こしで「ん」の落ちなどを見る

resemblyzer は irodori の venv に入っていないので、`pip install --target <pylib> resemblyzer` して PYTHONPATH で読む。
本番の声は 煽り = 声の素渡しの 1 本目 (近さ 0.775、「切っとんねん」の「ん」まで聞こえる物)、役満放銃 = 「えらいこっちゃ！役満やで！」(0.838)。
