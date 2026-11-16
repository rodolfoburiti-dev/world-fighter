"""Corta a gravação única do locutor (feita no site do ElevenLabs) em uma fala por arquivo.

    python tools/cortar_locutor.py tools/voice_raw/locutor_geracao1.mp3            # 1ª tomada
    python tools/cortar_locutor.py tools/voice_raw/locutor_geracao1.mp3 --tomada 2 # 2ª tomada
    python tools/cortar_locutor.py ARQ --tomada 2 --so trump,pena                  # mistura tomadas

A gravação tem as falas na ordem de gerar_locutor.LINES, separadas por pausas longas
(o texto pode ter sido repetido: cada repetição é uma "tomada").
"""
import argparse
import os
import re
import shutil
import subprocess

from gerar_locutor import FX, LINES, LUTA, OUT

PAD_BEFORE, PAD_AFTER = 0.06, 0.12


def speech_segments(ffmpeg, path):
    log = subprocess.run([ffmpeg, "-hide_banner", "-nostats", "-i", path, "-af", "silencedetect=noise=-38dB:d=0.5",
                          "-f", "null", "-"], capture_output=True, text=True).stderr
    starts = [float(x) for x in re.findall(r"silence_start: ([0-9.]+)", log)]
    ends = [float(x) for x in re.findall(r"silence_end: ([0-9.]+)", log)]
    total = float(re.search(r"Duration: (\d+):(\d+):([0-9.]+)", log).groups()[2]) + \
        60 * float(re.search(r"Duration: (\d+):(\d+)", log).group(2))
    # fala = do fim de um silêncio até o início do próximo
    edges = [0.0] + ends
    stops = starts + [total]
    segs = [(a, b) for a, b in zip(edges, stops) if b - a > 0.15]
    return segs


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("arquivo")
    ap.add_argument("--tomada", type=int, default=1)
    ap.add_argument("--so")
    ap.add_argument("--grupo", choices=["nomes", "luta"], default="nomes")
    ap.add_argument("--sufixo", default="", help="ex.: -2 grava round1-2.mp3 (segunda variação)")
    args = ap.parse_args()
    lines = LUTA if args.grupo == "luta" else LINES
    ffmpeg = shutil.which("ffmpeg") or SystemExit("ffmpeg não encontrado")
    segs = speech_segments(ffmpeg, args.arquivo)
    ids = list(lines)
    if len(segs) % len(ids):
        raise SystemExit(f"Achei {len(segs)} trechos de fala; esperava múltiplo de {len(ids)}. Ajuste o limiar.")
    takes = len(segs) // len(ids)
    if not 1 <= args.tomada <= takes:
        raise SystemExit(f"A gravação tem {takes} tomada(s).")
    chosen = segs[(args.tomada - 1) * len(ids): args.tomada * len(ids)]
    only = set(args.so.split(",")) if args.so else None
    os.makedirs(OUT, exist_ok=True)
    for vid, (a, b) in zip(ids, chosen):
        if only and vid not in only:
            continue
        start = max(0.0, a - PAD_BEFORE)
        dur = (b - a) + PAD_BEFORE + PAD_AFTER
        final = os.path.join(OUT, f"{vid}{args.sufixo}.mp3")
        subprocess.run([ffmpeg, "-y", "-loglevel", "error", "-ss", f"{start:.3f}", "-t", f"{dur:.3f}", "-i", args.arquivo,
                        "-af", FX, "-ac", "1", "-b:a", "96k", final], check=True)
        print(f"ok {vid:10} {a:6.2f}s-{b:6.2f}s  {lines[vid]}")


if __name__ == "__main__":
    main()
