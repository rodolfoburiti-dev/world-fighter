"""Ampliação de sprites para o World Fighter, com o algoritmo EPX/Scale2x da skill pixel-art-scaler
(.claude/skills/pixel-art-scaler) em versão vetorizada (numpy), muito mais rápida que o laço por pixel.

Os sprites do pacote não são pixel art "limpa": cada cor vem com ruído. O EPX compara cores exatas,
então antes a paleta é reduzida (quantização) para os vizinhos iguais serem reconhecidos como borda.
Fluxo: quantiza -> Scale2x -> Scale2x (4x) -> reduz com Lanczos até o tamanho final (bordas suaves).
"""
import numpy as np
from PIL import Image


def scale2x(px: np.ndarray) -> np.ndarray:
    """EPX/Scale2x (mesmas regras de scale_epx.py da skill), aplicado à imagem inteira de uma vez."""
    P = px
    A = np.concatenate([P[:1], P[:-1]], axis=0)        # vizinho de cima
    D = np.concatenate([P[1:], P[-1:]], axis=0)        # de baixo
    C = np.concatenate([P[:, :1], P[:, :-1]], axis=1)  # da esquerda
    B = np.concatenate([P[:, 1:], P[:, -1:]], axis=1)  # da direita
    eq = lambda u, v: (u == v).all(axis=2)
    CA, AB, DC, BD = eq(C, A), eq(A, B), eq(D, C), eq(B, D)
    CD, AC, BA, DB = eq(C, D), eq(A, C), eq(B, A), eq(D, B)
    p1 = np.where((CA & ~CD & ~AB)[..., None], A, P)
    p2 = np.where((AB & ~AC & ~BD)[..., None], B, P)
    p3 = np.where((DC & ~DB & ~CA)[..., None], C, P)
    p4 = np.where((BD & ~BA & ~DC)[..., None], D, P)
    h, w, c = P.shape
    out = np.empty((h * 2, w * 2, c), P.dtype)
    out[0::2, 0::2], out[0::2, 1::2], out[1::2, 0::2], out[1::2, 1::2] = p1, p2, p3, p4
    return out


def upscale(img: Image.Image, factor: float, colors: int = 96) -> Image.Image:
    """Amplia um quadro RGBA por `factor` (até 4x) preservando bordas nítidas."""
    rgba = img.convert("RGBA")
    alpha = np.asarray(rgba)[..., 3]
    # paleta reduzida só no RGB; o fundo transparente vira uma "cor" própria
    rgb = Image.fromarray(np.asarray(rgba)[..., :3])
    q = np.asarray(rgb.quantize(colors=colors, method=Image.Quantize.MEDIANCUT, dither=Image.Dither.NONE).convert("RGB")).copy()
    q[alpha < 128] = (255, 0, 255)
    px = np.dstack([q, np.where(alpha < 128, 0, 255).astype(np.uint8)])
    big = scale2x(scale2x(px))  # 4x
    out = Image.fromarray(big, "RGBA")
    w, h = max(1, round(img.width * factor)), max(1, round(img.height * factor))
    # reduz com alfa pré-multiplicado (sem halo magenta) e devolve borda nítida
    arr = np.asarray(out).astype(np.float32)
    arr[..., :3] *= arr[..., 3:4] / 255.0
    pre = Image.fromarray(arr.clip(0, 255).astype(np.uint8), "RGBA").resize((w, h), Image.LANCZOS)
    res = np.asarray(pre).astype(np.float32)
    a = res[..., 3:4]
    res[..., :3] = np.where(a > 0, res[..., :3] * 255.0 / np.maximum(a, 1), 0)
    res[..., 3] = np.where(res[..., 3] >= 128, 255, 0)
    return Image.fromarray(res.clip(0, 255).astype(np.uint8), "RGBA")
