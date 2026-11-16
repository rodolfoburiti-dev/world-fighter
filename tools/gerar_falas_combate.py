"""Prepara os clipes de provocação para o World Fighter.

    python tools/gerar_falas_combate.py --listar
    python tools/gerar_falas_combate.py
    python tools/gerar_falas_combate.py --importar PASTA
    python tools/gerar_falas_combate.py --importar PASTA --lutador lula --lutador flavio

A API usa FISH_AUDIO_API_KEY ou a chave salva via deploy/credencial.py salvar fishaudio.
A importação usa os MP3 do site, nomeados conforme a saída de --listar.
Para falas extras, continue a numeração dos arquivos do lutador.
"""

import argparse
import hashlib
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
from tempfile import TemporaryDirectory
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

ROOT = Path(__file__).resolve().parents[1]
GAME = ROOT / "site" / "worldfight"
CLIPS = GAME / "assets" / "voice" / "combate"
MANIFEST = GAME / "js" / "combat-voices.js"
MANIFEST_EXPORT = "export const COMBAT_VOICES = "
MODEL = "s2.1-pro-free"

FIGHTERS = {
    "lula": ("a4ac1426e4a749839c86853ad613eebe", "pt", (
        "Companheiro, esse golpe é só o começo!",
        "Nunca antes na história deste país você viu um golpe desses!",
        "O Brasil voltou! E eu também voltei pro round!",
    )),
    "flavio": ("012fd8a5269c499f909b355ac0b815ca", "pt", (
        "Saudações vascaínas! Isso aqui é só o primeiro tempo!",
        "Cadê o discurso do amor? Aqui vale é a defesa!",
        "O Brasil tem jeito! Já a sua guarda precisa de ajuda!",
    )),
    "bolsonaro": ("ed827b0532324b12803bb9344a3a607f", "pt", (
        "Quero ver defender essa, tá ok?",
        "E daí? Vai ficar só olhando?",
        "Brasil acima de tudo! E a guarda lá em cima!",
    )),
    "trump": ("4f0fe3c01dbc4c8bae05c5490c4c3700", "en", (
        "You're fired! Right out of the ring!",
        "America first! My fist second!",
        "Make America great again? I just made that punch great!",
    )),
}


def api_key():
    key = os.environ.get("FISH_AUDIO_API_KEY", "").strip()
    if not key:
        sys.path.insert(0, str(ROOT / "deploy"))
        import cred

        saved = cred.load("WorldFighter-FishAudio")
        key = saved[1] if saved else ""
    if not key:
        raise SystemExit("Sem chave do Fish Audio. Use deploy/credencial.py salvar fishaudio ou --importar PASTA.")
    return key


def synthesize(payload, key):
    request = Request(
        "https://api.fish.audio/v1/tts",
        data=payload,
        headers={"Authorization": f"Bearer {key}", "Content-Type": "application/json", "model": MODEL},
    )
    with urlopen(request, timeout=60) as response:
        return response.read()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    modes = parser.add_mutually_exclusive_group()
    modes.add_argument("--listar", action="store_true", help="mostra os textos e nomes dos arquivos")
    modes.add_argument("--importar", type=Path, metavar="PASTA", help="usa MP3 baixados do Fish Audio")
    parser.add_argument("--lutador", choices=FIGHTERS, action="append", help="importa apenas o lutador indicado")
    args = parser.parse_args()
    if args.lutador and not args.importar:
        parser.error("--lutador requer --importar PASTA")

    fighters = {fighter: data for fighter, data in FIGHTERS.items() if not args.lutador or fighter in args.lutador}
    lines = [
        (fighter, f"{fighter}-{number}", reference, language, text)
        for fighter, (reference, language, phrases) in fighters.items()
        for number, text in enumerate(phrases, 1)
    ]
    if args.listar:
        for _, name, _, _, text in lines:
            print(f"{name}.mp3  {text}")
        return

    ffmpeg = shutil.which("ffmpeg")
    if not ffmpeg:
        raise SystemExit("FFmpeg não encontrado no PATH.")
    if args.importar:
        missing = [f"{name}.mp3" for _, name, _, _, _ in lines if not (args.importar / f"{name}.mp3").is_file()]
        if missing:
            raise SystemExit("Faltam na pasta de importação: " + ", ".join(missing))
        for fighter, (reference, language, phrases) in fighters.items():
            number = len(phrases) + 1
            while (args.importar / f"{fighter}-{number}.mp3").is_file():
                lines.append((fighter, f"{fighter}-{number}", reference, language, ""))
                number += 1
    key = None if args.importar else api_key()
    CLIPS.mkdir(parents=True, exist_ok=True)
    manifest = {}
    if args.lutador and MANIFEST.is_file():
        source = MANIFEST.read_text(encoding="utf-8")
        manifest = json.loads(source.split(MANIFEST_EXPORT, 1)[1].strip().removesuffix(";"))
    manifest.update({fighter: [] for fighter in fighters})

    # Os clipes completos são reaproveitados após uma falha. O jogo só recebe a lista quando todos estão prontos.
    with TemporaryDirectory(prefix="combate-", dir=ROOT / "tools") as folder:
        tmp = Path(folder)
        for fighter, name, reference, language, text in lines:
            payload = json.dumps({
                "text": text, "reference_id": reference, "language": language, "format": "mp3",
            }, ensure_ascii=False).encode("utf-8")
            raw = (args.importar / f"{name}.mp3").read_bytes() if args.importar else None
            fingerprint = hashlib.sha256(payload + (raw if raw is not None else MODEL.encode())).hexdigest()[:12]
            clip = f"combat-{name}-{fingerprint}"
            destination = CLIPS / f"{clip}.mp3"
            if not destination.is_file():
                try:
                    audio = raw if raw is not None else synthesize(payload, key)
                    if not audio:
                        raise ValueError("áudio vazio")
                    staged = tmp / f"{clip}.mp3"
                    subprocess.run([
                        ffmpeg, "-nostdin", "-v", "error", "-xerror", "-i", "pipe:0",
                        "-map_metadata", "-1", "-af", "highpass=f=75,loudnorm=I=-17:TP=-2:LRA=7",
                        "-ar", "44100", "-ac", "1", "-b:a", "80k", str(staged),
                    ], input=audio, check=True)
                    staged.replace(destination)
                except HTTPError as error:
                    raise SystemExit(f"{name}: Fish Audio respondeu HTTP {error.code}.") from None
                except (URLError, TimeoutError, ValueError, subprocess.CalledProcessError) as error:
                    raise SystemExit(f"{name}: falha ao preparar o áudio ({error}).") from None
                print(f"{name}: pronto")
            manifest[fighter].append(clip)

        staged_manifest = tmp / MANIFEST.name
        staged_manifest.write_text(
            "// Gerado por tools/gerar_falas_combate.py a partir dos clipes disponíveis.\n"
            f"{MANIFEST_EXPORT}{json.dumps(manifest, indent=2)};\n",
            encoding="utf-8",
        )
        staged_manifest.replace(MANIFEST)
    print(f"{len(lines)} falas prontas para o jogo.")


if __name__ == "__main__":
    main()
