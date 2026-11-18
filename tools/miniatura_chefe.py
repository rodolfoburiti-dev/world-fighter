"""Retrato e miniatura do chefe final (XANDÃO) a partir do retrato gerado por IA.

    python tools/miniatura_chefe.py [retrato.png]     (padrão: work/boss/portrait_1.png)

Saída: assets/portraits/moraes.webp (busto, fundo transparente, mesma altura dos outros retratos)
e assets/tiles/moraes.webp (busto sobre fundo vermelho-escuro de chefe, com a faixa de baixo copiada da
miniatura do Blozinho — bandeira do Brasil — e o nome escrito como nas outras miniaturas).
"""
import os
import sys

import numpy as np
from PIL import Image

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from renomear_miniaturas import measure, repaint  # noqa: E402

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..")
ASSETS = os.path.join(ROOT, "site", "worldfight", "assets")
SRC = sys.argv[1] if len(sys.argv) > 1 else os.path.join(ROOT, "work", "boss", "portrait_1.png")
NAME = "XANDÃO"


def main():
    por = Image.open(SRC).convert("RGBA")
    por = por.crop(por.getbbox())
    ref = Image.open(os.path.join(ASSETS, "portraits", "putin.webp"))
    h = ref.height
    big = por.resize((round(por.width * h / por.height), h), Image.LANCZOS)
    big.save(os.path.join(ASSETS, "portraits", "moraes.webp"), "WEBP", quality=92)

    # miniatura: fundo de chefe + busto (cabeça e ombros) + faixa do Blozinho com o nome novo
    tile_ref = Image.open(os.path.join(ROOT, "backup_nomes", "tiles", "flavio.webp")).convert("RGBA")
    tw, th = tile_ref.size
    y = np.linspace(0, 1, th)[:, None]
    top, bottom = np.array([120, 10, 10]), np.array([20, 0, 0])
    grad = (top * (1 - y) + bottom * y)[:, None, :].repeat(tw, axis=1).astype(np.uint8)
    tile = Image.fromarray(grad.reshape(th, tw, 3), "RGB").convert("RGBA")
    bust = por.crop((int(por.width * 0.2), 0, int(por.width * 0.92), int(por.height * 0.5)))  # rosto de perto
    scale = tw * 1.15 / bust.width
    bust = bust.resize((round(bust.width * scale), round(bust.height * scale)), Image.LANCZOS)
    tile.alpha_composite(bust, ((tw - bust.width) // 2, 2))
    band_y = int(th * 0.75)
    tile.alpha_composite(tile_ref.crop((0, band_y, tw, th)), (0, band_y))
    _, (_, cap_top, _, cap_bottom), _ = measure(Image.open(os.path.join(ROOT, "backup_nomes", "tiles", "trump.webp")))
    size = int((cap_bottom - cap_top + 1) * 1.4)
    out = repaint(tile, NAME, cap_top, cap_bottom, size)
    out.convert("RGB").save(os.path.join(ASSETS, "tiles", "moraes.webp"), "WEBP", quality=92)
    print("ok: portraits/moraes.webp", big.size, "tiles/moraes.webp", out.size)


if __name__ == "__main__":
    main()
