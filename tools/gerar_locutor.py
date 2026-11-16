"""Gera as falas do locutor com o ElevenLabs e aplica o eco de fliperama.

    python tools/gerar_locutor.py --listar          # mostra as vozes disponíveis na conta
    python tools/gerar_locutor.py                   # gera tudo com a voz escolhida automaticamente
    python tools/gerar_locutor.py --voz "Brian"     # força uma voz (nome ou id)
    python tools/gerar_locutor.py --so lula,trump   # regera só algumas falas

A chave de API vem do cofre do Windows (python deploy/credencial.py salvar elevenlabs).
Brutos em tools/voice_raw/; finais em site/worldfight/assets/voice/<id>.mp3.
Voz original de locutor da biblioteca do ElevenLabs — não é clone de ninguém.
"""
import argparse
import json
import os
import shutil
import subprocess
import sys
import urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, "..", "deploy"))
import cred  # noqa: E402

API = "https://api.elevenlabs.io/v1"
RAW = os.path.join(HERE, "voice_raw")
OUT = os.path.join(HERE, "..", "site", "worldfight", "assets", "voice")

LINES = {  # nomes de paródia (2026-11-11): o jogo não usa os nomes reais
    "lula": "Molúsculo!",
    "milei": "Mileão!",
    "trump": "Trumpete!",
    "pena": "Peñita!",
    "xi": "Xi Ping Pong!",
    "putin": "Czar Vlad!",
    "netanyahu": "Bibizão!",
    "kim": "Kim Jong Bum!",
    "flavio": "Blozinho!",
    "bolsonaro": "Blozo!",
    "versus": "Versus!",
    "title": "World Fighter!",
}
# anúncios da luta (2026-11-12), em inglês como no fliperama; gravados no site do ElevenLabs
# (voz Adam, Eleven v4, idioma inglês) e cortados com: cortar_locutor.py ARQ --grupo luta [--sufixo -2]
LUTA = {
    "round1": "Round one!",
    "round2": "Round two!",
    "round3": "Round three!",
    "round4": "Round four!",
    "round5": "Round five!",
    "roundfinal": "Final round!",
    "fight": "Fight!",
    "ko": "K.O.!",
    "perfect": "Perfect!",
    "timeover": "Time over!",
    "draw": "Draw game!",
    "wins": "Wins!",
    "youwin": "You win!",
    "youlose": "You lose!",
    "champion": "Champion!",
}
PREFERRED = ["Adam", "Brian", "Bill", "Arnold", "Clyde", "George", "Callum", "Daniel", "Josh"]

# grave e com eco: tom 8% abaixo (mesma duração), corta graves sujos, eco curto e duplo, volume padronizado
FX = ("asetrate=44100*0.92,aresample=44100,atempo=1.087,highpass=f=90,"
      "apad=pad_dur=0.4,aecho=0.8:0.6:70|140:0.32|0.16,loudnorm=I=-14:TP=-1:LRA=7")


def key() -> str:
    found = cred.load("WorldFighter-ElevenLabs")
    if not found:
        raise SystemExit("Chave não encontrada. Rode: python deploy/credencial.py salvar elevenlabs")
    return found[1]


def request(path, body=None):
    req = urllib.request.Request(API + path, method="POST" if body else "GET",
                                 headers={"xi-api-key": key(), "Content-Type": "application/json"},
                                 data=json.dumps(body).encode() if body else None)
    with urllib.request.urlopen(req, timeout=60) as r:
        return r.read()


def voices():
    return json.loads(request("/voices"))["voices"]


def pick_voice(wanted):
    vs = voices()
    if wanted:
        for v in vs:
            if wanted in (v["voice_id"], v["name"]) or v["name"].lower().startswith(wanted.lower()):
                return v
        raise SystemExit(f"Voz {wanted!r} não encontrada; use --listar.")
    for name in PREFERRED:
        for v in vs:
            if v["name"].split(" ")[0].lower() == name.lower():
                return v
    males = [v for v in vs if (v.get("labels") or {}).get("gender") == "male"]
    if not males:
        raise SystemExit("Nenhuma voz masculina na conta; use --voz.")
    return males[0]


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--listar", action="store_true")
    ap.add_argument("--voz")
    ap.add_argument("--so")
    args = ap.parse_args()

    if args.listar:
        for v in voices():
            labels = v.get("labels") or {}
            print(f'{v["name"][:28]:28} {labels.get("gender", ""):7} {labels.get("age", ""):12} {labels.get("description", "")}')
        return

    ffmpeg = shutil.which("ffmpeg")
    if not ffmpeg:
        raise SystemExit("ffmpeg não encontrado no PATH.")
    voice = pick_voice(args.voz)
    print(f'Voz: {voice["name"]} ({voice["voice_id"]})')
    os.makedirs(RAW, exist_ok=True)
    os.makedirs(OUT, exist_ok=True)
    only = set(args.so.split(",")) if args.so else None
    for vid, text in LINES.items():
        if only and vid not in only:
            continue
        audio = request(f'/text-to-speech/{voice["voice_id"]}?output_format=mp3_44100_128', {
            "text": text,
            "model_id": "eleven_multilingual_v2",
            "voice_settings": {"stability": 0.3, "similarity_boost": 0.8, "style": 0.7, "use_speaker_boost": True},
        })
        raw = os.path.join(RAW, f"{vid}.mp3")
        with open(raw, "wb") as fh:
            fh.write(audio)
        final = os.path.join(OUT, f"{vid}.mp3")
        subprocess.run([ffmpeg, "-y", "-loglevel", "error", "-i", raw, "-af", FX, "-ac", "1", "-b:a", "96k", final], check=True)
        print("ok", vid, text)


if __name__ == "__main__":
    main()
