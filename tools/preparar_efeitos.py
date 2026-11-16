"""Prepara os efeitos sonoros gravados (MP3) do jogo a partir dos originais do Mixkit.

    python tools/preparar_efeitos.py

Originais (prévia MP3 de cada efeito, baixada de assets.mixkit.co) em work/sfx/orig/<id>.mp3.
Licença: Mixkit Sound Effects Free License (uso comercial em jogos, sem atribuição obrigatória;
proibido redistribuir os sons soltos). Crédito de cortesia em CREDITOS.txt.

Cada efeito é cortado alguns milésimos antes do impacto (para soar junto com o golpe),
termina quando o som some, ganha fade curto e fica com o pico em -1 dBFS.
Saída: site/worldfight/assets/sfx/<nome>-<n>.mp3 e a lista em site/worldfight/js/sfx-list.js.
"""
import os
import subprocess

import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
ORIG = os.path.join(HERE, "..", "work", "sfx", "orig")
OUT = os.path.join(HERE, "..", "site", "worldfight", "assets", "sfx")
LIST_JS = os.path.join(HERE, "..", "site", "worldfight", "js", "sfx-list.js")
SR = 44100

# nome do efeito no jogo -> variações. Cada variação é uma lista de camadas:
# (id do Mixkit, atraso da camada em s, início manual em s ou None = no impacto, duração máxima em s
#  [, tom em semitons])
SFX = {
    "punch": [[(2153, 0, None, 0.35)], [(2052, 0, None, 0.4)], [(2047, 0, None, 0.4)], [(2165, 0, None, 0.35)]],
    "kick": [[(2143, 0, None, 0.45)], [(2155, 0, None, 0.6)], [(2150, 0, None, 0.5)], [(2154, 0, None, 0.45)]],
    "block": [[(2053, 0, None, 0.3)], [(2148, 0, None, 0.3)], [(2145, 0, None, 0.3)]],
    "whiff": [[(2161, 0, None, 0.35)], [(2057, 0, None, 0.35)], [(2048, 0, None, 0.35)], [(2049, 0, None, 0.35)]],
    "special": [[(1338, 0, 0.15, 1.3)], [(1492, 0, 0.45, 0.9)]],
    "boom": [[(1694, 0, None, 1.0)], [(2759, 0, None, 1.0)]],
    "ko": [[(2155, 0, None, 0.6), (1143, 0.02, 0.42, 2.2)]],
    "fall": [[(2498, 0, None, 0.6)], [(753, 0, None, 0.5)]],
    "land": [[(1922, 0, None, 0.3)], [(1920, 0, None, 0.3)]],
    "jump": [[(1490, 0, 0.5, 0.35)]],
    "slam": [[(2908, 0, None, 2.6)]],
    "vs": [[(788, 0, 1.05, 3.0)]],
}

# voz de dor de cada lutador (2026-11-12): gemido nos golpes fortes (hurt-<id>) e grito no nocaute (scream-<id>).
# Mesmos gemidos gravados do Mixkit, combinados e com tom diferente para cada um (todos abaixo do original,
# que é agudo de grito). Gemidos: 2197 "Man in pain", 2200 "Scream in pain", 2204 "Ow", 2173 "Fighting man
# voice of pain". Gritos: 2768 "Human fighter pain scream", 391/392 "Male falling scream".
PAIN = {  # lutador: (gemidos, grito, semitons)
    "lula": ([2197, 2200, 2204], 392, -3),
    "milei": ([2173, 2200, 2204], 2768, -1),
    "trump": ([2197, 2204, 2173], 391, -3.5),
    "pena": ([2200, 2173, 2197], 2768, -2),
    "xi": ([2204, 2197, 2200], 392, -1.5),
    "putin": ([2173, 2197, 2204], 391, -4),
    "netanyahu": ([2200, 2204, 2173], 2768, -3),
    "kim": ([2197, 2173, 2200], 392, 0),
    "flavio": ([2204, 2200, 2197], 391, -1),
    "bolsonaro": ([2173, 2204, 2200], 2768, -2.5),
}
for fid, (hurts, scream, st) in PAIN.items():
    SFX[f"hurt-{fid}"] = [[(h, 0, None, 0.7, st)] for h in hurts]
    SFX[f"scream-{fid}"] = [[(scream, 0, None, 1.7, st - 1)]]


def load(i):
    raw = subprocess.run(["ffmpeg", "-v", "error", "-i", os.path.join(ORIG, f"{i}.mp3"), "-f", "f32le", "-ac", "1",
                          "-ar", str(SR), "-"], capture_output=True, check=True).stdout
    return np.frombuffer(raw, np.float32).copy()


def pitch(x, st):
    """Muda o tom como fita (mais grave = um pouco mais lento)."""
    if not st:
        return x
    r = 2 ** (st / 12)
    n = int(len(x) / r)
    return np.interp(np.arange(n) * r, np.arange(len(x)), x).astype(np.float32)


def cut(x, start, max_dur):
    a = np.abs(x)
    if start is None:  # impacto: primeiro ponto acima de 10% do pico, menos 8 ms
        start = max(0.0, np.argmax(a > a.max() * 0.1) / SR - 0.008)
    y = x[int(start * SR):int((start + max_dur) * SR)]
    env = np.convolve(np.abs(y), np.ones(441) / 441, mode="same")
    loud = np.nonzero(env > env.max() * 0.01)[0]  # -40 dB do pico
    if len(loud):
        y = y[:min(len(y), loud[-1] + int(0.03 * SR))]
    fade = 0.3 if max_dur >= 1.0 else 0.04  # gritos longos somem devagar
    n_in, n_out = min(len(y), int(0.003 * SR)), min(len(y), int(fade * SR))
    y = y.copy()
    y[:n_in] *= np.linspace(0, 1, n_in)
    y[-n_out:] *= np.linspace(1, 0, n_out)
    return y


def build(layers):
    parts = [(int(l[1] * SR), pitch(cut(load(l[0]), l[2], l[3]), l[4] if len(l) > 4 else 0)) for l in layers]
    n = max(off + len(p) for off, p in parts)
    mix = np.zeros(n, np.float32)
    for off, p in parts:
        mix[off:off + len(p)] += p / (np.abs(p).max() or 1)
    return mix * (10 ** (-1 / 20) / np.abs(mix).max())


def main():
    os.makedirs(OUT, exist_ok=True)
    for f in os.listdir(OUT):
        if f.endswith(".mp3"):
            os.remove(os.path.join(OUT, f))
    counts = {}
    for name, variants in SFX.items():
        for k, layers in enumerate(variants, 1):
            y = build(layers)
            path = os.path.join(OUT, f"{name}-{k}.mp3")
            subprocess.run(["ffmpeg", "-y", "-v", "error", "-f", "f32le", "-ar", str(SR), "-ac", "1", "-i", "-",
                            "-c:a", "libmp3lame", "-b:a", "96k", path], input=y.astype(np.float32).tobytes(), check=True)
            print(f"ok {name}-{k}  {len(y) / SR:.2f}s")
        counts[name] = len(variants)
    body = ", ".join((k if k.isidentifier() else f"'{k}'") + f": {v}" for k, v in counts.items())
    with open(LIST_JS, "w", encoding="utf-8", newline="\n") as fh:
        fh.write("// Gerado por tools/preparar_efeitos.py: efeito -> número de variações em assets/sfx/<efeito>-<n>.mp3\n")
        fh.write(f"export const SFX_FILES = {{ {body} }};\n")


if __name__ == "__main__":
    main()
