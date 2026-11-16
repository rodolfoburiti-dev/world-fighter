"""Troca o nome escrito na faixa de baixo das miniaturas (assets/tiles) pelo nome de paródia.

    python tools/renomear_miniaturas.py      # lê os nomes de site/worldfight/js/data.js

Apaga só o texto (a bandeira fica), pinta com a cor da faixa e escreve o nome novo em branco,
fonte condensada, centrado no espaço que o nome antigo ocupava. Originais em backup_nomes/tiles/.
"""
import os
import re

import numpy as np
from PIL import Image, ImageDraw, ImageFont

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..")
SRC = os.path.join(ROOT, "backup_nomes", "tiles")          # sempre parte do original
OUT = os.path.join(ROOT, "site", "worldfight", "assets", "tiles")
FONT = "C:/Windows/Fonts/bahnschrift.ttf"


def names():
    src = open(os.path.join(ROOT, "site", "worldfight", "js", "data.js"), encoding="utf-8").read()
    return dict(re.findall(r"\{ id: '(\w+)', name: '([^']+)'", src))


def measure(img):
    """Bandeira (fim à direita), caixa do texto branco e cor da faixa de uma miniatura original."""
    a = np.asarray(img.convert("RGB")).astype(int)
    h, w = a.shape[:2]
    y_off = int(h * 0.78)
    band = a[y_off:h - 3]
    mx, mn = band.max(axis=2), band.min(axis=2)
    colorful = np.nonzero(((mx - mn) > 70).sum(axis=0) > 3)[0]
    flag_r, runs, run = 0, [], []
    for c in colorful:  # a bandeira é o primeiro bloco colorido largo (bordas soltas não contam)
        if run and c - run[-1] > 4:
            runs.append(run)
            run = []
        run.append(c)
    if run:
        runs.append(run)
    wide = [r for r in runs if r[-1] - r[0] >= 20]
    if wide:
        flag_r = wide[0][-1] + 2
    white = (mn > 165) & (np.arange(w)[None, :] > flag_r + 2)
    ys, xs = np.nonzero(white)
    dark = band[mx < 60]
    bar = tuple(int(v) for v in np.median(dark, axis=0)) if len(dark) else (5, 5, 30)
    return flag_r, (xs.min(), ys.min() + y_off, xs.max(), ys.max() + y_off), bar


MIN_SQUEEZE = 0.6  # quanto as letras podem ser estreitadas (1 = largura normal da fonte)


def text_layer(name, size):
    f = ImageFont.truetype(FONT, size)
    f.set_variation_by_name("Bold Condensed")
    probe = ImageDraw.Draw(Image.new("RGBA", (1, 1)))
    x0, y0, x1, y1 = probe.textbbox((0, 0), name, font=f)
    hx0, hy0, hx1, hy1 = probe.textbbox((0, 0), "H", font=f)
    layer = Image.new("RGBA", (x1 - x0 + 4, y1 - y0 + 4), (0, 0, 0, 0))
    ImageDraw.Draw(layer).text((2 - x0, 2 - y0), name, font=f, fill=(250, 250, 252, 255))
    return layer, hy1 - y0 + 2  # imagem do texto e onde fica a base das maiúsculas dentro dela


def repaint(img, name, cap_top, cap_bottom, size):
    flag_r, (tx0, ty0, tx1, ty1), bar = measure(img)
    right = img.width - 6
    out = img.convert("RGBA").copy()
    ImageDraw.Draw(out).rectangle([flag_r + 3, min(ty0, cap_top) - 4, right, max(ty1, cap_bottom) + 2], fill=bar + (255,))
    layer, base = text_layer(name, size)
    avail = right - (flag_r + 7)
    if layer.width > avail:  # estreita as letras, mesma altura
        layer = layer.resize((avail, layer.height), Image.LANCZOS)
    cx = (flag_r + 7 + right) / 2
    out.alpha_composite(layer, (int(round(cx - layer.width / 2)), int(round(cap_bottom + 1 - base))))
    return out


def main():
    _, (_, cap_top, _, cap_bottom), _ = measure(Image.open(os.path.join(SRC, "trump.webp")))  # sem acento
    todos = names()
    imgs = {fid: Image.open(os.path.join(SRC, f"{fid}.webp")) for fid in todos}
    # uma altura só para os 10: a maior em que todo nome cabe estreitando no máximo MIN_SQUEEZE
    size = int((cap_bottom - cap_top + 1) * 1.4)
    while size > 8:
        ok = all(text_layer(n, size)[0].width * MIN_SQUEEZE <= (imgs[f].width - 6) - (measure(imgs[f])[0] + 7)
                 for f, n in todos.items())
        if ok:
            break
        size -= 1
    for fid, name in todos.items():
        repaint(imgs[fid], name, cap_top, cap_bottom, size).save(os.path.join(OUT, f"{fid}.webp"), "WEBP", quality=92)
        print("ok", fid, name, "fonte", size)


if __name__ == "__main__":
    main()
