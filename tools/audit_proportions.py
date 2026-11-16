"""Auditoria de proporções das animações de cada lutador (como o jogo desenha).

    python tools/audit_proportions.py

Para cada lutador e animação mede, em relação à pose de guarda (idle):
  - altura dos quadros "em pé" (1º e último de cada golpe/andar): deveria ser ~100%
  - largura do tronco na altura do peito: deveria ser ~100% (corpo mais "gordo" = linha em outra escala)
  - deriva dentro da animação: quanto a altura dos quadros em pé varia entre o início e o fim
E entre lutadores: altura e largura de ombro quando todos são desenhados com o mesmo tamanho no jogo.
"""
import json
import os

import numpy as np
from PIL import Image

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..")
ANIMS = os.path.join(ROOT, "site", "worldfight", "assets", "anims")
STANDING = ["idle", "walkf", "walkb", "jab", "strong", "lowkick", "highkick", "special", "block"]


def load(fid):
    data = json.load(open(os.path.join(ANIMS, f"{fid}.json"), encoding="utf-8"))
    frames = {}
    for tex in data["textures"]:
        page = Image.open(os.path.join(ANIMS, tex["image"])).convert("RGBA")
        for fr in tex["frames"]:
            f = fr["frame"]
            img = np.asarray(page.crop((f["x"], f["y"], f["x"] + f["w"], f["y"] + f["h"])))[..., 3] > 0
            frames[fr["filename"]] = (img, fr["spriteSourceSize"], fr["sourceSize"])
    return frames


def measure(entry, origin_y):
    img, sss, src = entry
    ys = np.nonzero(img.any(axis=1))[0]
    feet = origin_y * src["h"]
    top = sss["y"] + ys[0]
    height = feet - top
    # largura do tronco a 60% da altura (peito), ignorando braços: maior trecho contínuo da linha
    y = int(round(feet - 0.6 * height - sss["y"]))
    y = min(max(y, 0), img.shape[0] - 1)
    row = img[y]
    best = run = 0
    for v in row:
        run = run + 1 if v else 0
        best = max(best, run)
    return height, best


def main():
    meta = json.load(open(os.path.join(ANIMS, "meta.json"), encoding="utf-8"))
    rows = []
    for fid, m in meta.items():
        frames = load(fid)
        idle = [measure(frames[f"idle_{k}"], m["originY"]) for k in range(m["anims"]["idle"]["frames"])]
        h0 = float(np.median([h for h, _ in idle]))
        w0 = float(np.median([w for _, w in idle]))
        problems = []
        for anim in STANDING:
            if anim not in m["anims"] or anim == "idle":
                continue
            n = m["anims"][anim]["frames"]
            ends = [measure(frames[f"{anim}_{k}"], m["originY"]) for k in (0, n - 1)]
            hr = float(np.mean([h for h, _ in ends])) / h0
            wr = float(np.mean([w for _, w in ends])) / w0
            drift = abs(ends[0][0] - ends[1][0]) / h0
            flag = abs(hr - 1) > 0.06 or abs(wr - 1) > 0.15 or drift > 0.06
            if flag:
                problems.append(f"{anim}: altura {hr:.0%} tronco {wr:.0%} deriva {drift:.0%}")
        rows.append((fid, h0, w0, problems))
    print("lutador     altura  tronco/altura  problemas")
    for fid, h0, w0, problems in rows:
        print(f"{fid:10} {h0:6.0f}px   {w0 / h0:5.2f}       " + ("; ".join(problems) if problems else "ok"))


if __name__ == "__main__":
    main()
