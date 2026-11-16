"""Gera os assets do jogo a partir das imagens originais da pasta do projeto.

    python tools/prep_assets.py

Saída em site/worldfight/assets/ (WebP com transparência):
  fighters/<id>.webp   corpo inteiro, fundo removido, altura padronizada
  portraits/<id>.webp  retrato grande da tela de seleção (busto)
  tiles/<id>.webp      quadrinho da grade, recortado da tela de seleção
  map.webp, title.webp
"""
import glob
import os

import numpy as np
from PIL import Image

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..")
OUT = os.path.join(ROOT, "site", "worldfight", "assets")

# id, padrão do sprite de corpo inteiro, padrão do retrato grande (None = gerar do sprite)
FIGHTERS = [
    ("lula", "Lula em Guarda*", "Retrato Pixelado de Lutador Brasileiro*"),
    ("milei", "Milei em Guarda*", None),
    ("trump", "Donald Trump em Guarda*", "Donald Trump em Postura*"),
    ("pena", "Prisioneiro Pe*", "Retrato Pixelado de F*ria Presidencial*"),
    ("xi", "Xi Jinping em Pose*", "Retrato Pixelado de Xi Jinping*"),
    ("putin", "Vladimir Putin*", None),
    ("netanyahu", "Pol*tico israelense*", "Retrato Pixelado de Pol*tico Israelense*"),
    ("kim", "Kim Jong-un*", "Retrato Pixelado em Pose de Combate*"),
    ("flavio", "Presidente em Pose de Combate*", "Retrato Pixelado de Fl*vio*"),
    ("bolsonaro", "Bolsonaro em Posi*", "Pol*tico em Guarda de Combate*"),
]

# Grade 5x2 da "Tela de seleção com Lula de chapéu branco" (bordas medidas na imagem)
TILE_X = [(441, 637), (651, 846), (858, 1053), (1067, 1256), (1271, 1467)]
TILE_Y = [(479, 657), (674, 850)]

# cenário -> arquivo (no Brasil, o cenário é do lutador: Lula no Nordeste, Flávio e Bolsonaro no Rio)
STAGES = {
    "us": "Arena Pixelada do Cap*",
    "br": "Bras*lia em Pixel Art*",
    "br-lula": "Pra*a Nordestina*",
    "br-rio": "Batalha Pixel Art no P*o de A*car*",
    "ru": "Pra*a Vermelha*",
    "ar": "Buenos Aires em Pixel Art*",
    "il": "Jerusal*m em Pixel Art*",
    "py": "Palacio de Gobierno*",
    "cn": "Pal*cio Chin*s em Pixel Art*",
    "kp": "Pra*a Monumental ao Amanhecer*",
}

SPRITE_H = 440
PORTRAIT_H = 560


def find(pattern):
    hits = sorted(glob.glob(os.path.join(ROOT, pattern + ".png")))
    if len(hits) != 1:
        raise SystemExit(f"esperava 1 arquivo para {pattern!r}, achei {len(hits)}")
    return hits[0]


def border_flood(candidate: np.ndarray) -> np.ndarray:
    """Pixels candidatos a fundo que se ligam à borda da imagem (4-vizinhança)."""
    bg = np.zeros_like(candidate)
    bg[0, :], bg[-1, :], bg[:, 0], bg[:, -1] = candidate[0, :], candidate[-1, :], candidate[:, 0], candidate[:, -1]
    while True:
        grown = bg.copy()
        grown[1:, :] |= bg[:-1, :]
        grown[:-1, :] |= bg[1:, :]
        grown[:, 1:] |= bg[:, :-1]
        grown[:, :-1] |= bg[:, 1:]
        grown &= candidate
        if (grown == bg).all():
            return bg
        bg = grown


def cut_blue_background(img: Image.Image) -> Image.Image:
    rgb = np.asarray(img.convert("RGB")).astype(int)
    h, w, _ = rgb.shape
    edge = np.concatenate([rgb[0], rgb[-1], rgb[:, 0], rgb[:, -1]])
    ref = np.median(edge, axis=0)
    dist = np.abs(rgb - ref).sum(axis=2)
    # fundo azul-marinho e a sombra escura sob os pés
    candidate = (dist < 70) | ((rgb[..., 2] > rgb[..., 0] + 40) & (rgb[..., 0] < 30) & (rgb[..., 1] < 30))
    bg = border_flood(candidate)
    # Fundo preso entre as pernas (cercado pela sombra): manchas grandes da cor exata do fundo.
    # A abertura (erode + dilate) descarta pixels soltos do mesmo tom dentro da roupa.
    strict = dilate(erode(dist < 45, 10), 10)
    rgba = np.dstack([rgb, np.where(bg | strict, 0, 255)]).astype(np.uint8)
    return Image.fromarray(rgba, "RGBA")


def erode(mask: np.ndarray, n: int) -> np.ndarray:
    for _ in range(n):
        m = mask.copy()
        m[1:, :] &= mask[:-1, :]
        m[:-1, :] &= mask[1:, :]
        m[:, 1:] &= mask[:, :-1]
        m[:, :-1] &= mask[:, 1:]
        mask = m
    return mask


def dilate(mask: np.ndarray, n: int) -> np.ndarray:
    return ~erode(~mask, n)


def remove_baked_shadow(img: Image.Image) -> Image.Image:
    """Tira a sombra que veio desenhada sob os pés (o jogo desenha a própria, que acompanha o pulo).

    Na faixa dos pés, a sombra é azul-escura; os sapatos são pretos/cinzas (sem azul) e o chinelo
    azul é bem mais claro, então ambos ficam. Depois some com pontinhos soltos que sobraram.
    """
    rgba = np.asarray(img).copy()
    h = rgba.shape[0]
    band = slice(int(h * 0.86), h)
    r, g, b, a = (rgba[band, :, i].astype(int) for i in range(4))
    shadow = (a > 0) & (np.maximum(r, g) < 34) & (b < 125) & (b - np.maximum(r, g) > 12)
    alpha = rgba[..., 3] > 0
    alpha[band] &= ~shadow
    # na faixa dos pés só fica o que está ligado às pernas (que entram pela borda de cima da faixa);
    # manchas soltas de sombra e pontinhos de sujeira saem
    region = alpha[band]
    seed = np.zeros_like(region)
    seed[0, :] = region[0, :]
    alpha[band] = grow_within(seed, region)
    rgba[..., 3] = np.where(alpha, 255, 0)
    return Image.fromarray(rgba, "RGBA")


def grow_within(seed: np.ndarray, mask: np.ndarray) -> np.ndarray:
    """Pixels de `mask` ligados a `seed` (8-vizinhança)."""
    cur = seed & mask
    while True:
        g = cur.copy()
        g[1:, :] |= cur[:-1, :]
        g[:-1, :] |= cur[1:, :]
        g[:, 1:] |= cur[:, :-1]
        g[:, :-1] |= cur[:, 1:]
        g[1:, 1:] |= cur[:-1, :-1]
        g[1:, :-1] |= cur[:-1, 1:]
        g[:-1, 1:] |= cur[1:, :-1]
        g[:-1, :-1] |= cur[1:, 1:]
        g &= mask
        if (g == cur).all():
            return g
        cur = g


def cut_black_background(img: Image.Image) -> Image.Image:
    rgba = np.asarray(img.convert("RGBA")).copy()
    if img.mode == "RGBA":
        rgba[..., 3] = np.where(rgba[..., 3] < 40, 0, 255)
        return Image.fromarray(rgba, "RGBA")
    subject = rgba[..., :3].max(axis=2) >= 14
    # Fecha as frestas escuras e finas entre braço e corpo (fechamento: dilata e erode o
    # personagem), para o fundo só entrar pelo lado de fora e não por dentro do terno.
    closed = erode(dilate(subject, 10), 10)
    # O retrato é cortado embaixo: o terno escuro encosta na borda inferior. Essa borda vira
    # "parede", senão o fundo entra por baixo e esvazia o terno.
    closed[-4:, :] = True
    bg = border_flood(~closed)
    rgba[..., 3] = np.where(bg, 0, 255)
    return Image.fromarray(rgba, "RGBA")


def crop_to_content(img: Image.Image) -> Image.Image:
    box = img.getchannel("A").getbbox()
    return img.crop(box)


def fit_height(img: Image.Image, height: int) -> Image.Image:
    w = round(img.width * height / img.height)
    return img.resize((w, height), Image.LANCZOS)


def save(img: Image.Image, *parts) -> str:
    path = os.path.join(OUT, *parts)
    os.makedirs(os.path.dirname(path), exist_ok=True)
    img.save(path, "WEBP", quality=90, method=6)
    return path


def main():
    select = Image.open(find("Tela de sele*o com Lula*")).convert("RGB")
    for i, (fid, sprite_pat, portrait_pat) in enumerate(FIGHTERS):
        body = crop_to_content(remove_baked_shadow(crop_to_content(cut_blue_background(Image.open(find(sprite_pat))))))
        save(fit_height(body, SPRITE_H), "fighters", f"{fid}.webp")

        if portrait_pat:
            portrait = crop_to_content(cut_black_background(Image.open(find(portrait_pat))))
        else:  # sem retrato próprio: busto recortado do sprite
            portrait = crop_to_content(body.crop((0, 0, body.width, int(body.height * 0.6))))
        save(fit_height(portrait, PORTRAIT_H), "portraits", f"{fid}.webp")

        x0, x1 = TILE_X[i % 5]
        y0, y1 = TILE_Y[i // 5]
        save(select.crop((x0, y0, x1, y1)), "tiles", f"{fid}.webp")
        print("ok", fid, body.size, portrait.size)

    for cc, pattern in STAGES.items():
        stage = Image.open(find(pattern)).convert("RGB").resize((1280, 720), Image.LANCZOS)
        save(stage, "stages", f"{cc}.webp")
        print("ok cenário", cc)

    save(Image.open(find("Mapa Mundial Arcade*")).convert("RGB").resize((1200, 600), Image.LANCZOS), "map.webp")
    save(Image.open(find("Poster de luta mundial*")).convert("RGB").resize((1280, 720), Image.LANCZOS), "title.webp")


if __name__ == "__main__":
    main()
