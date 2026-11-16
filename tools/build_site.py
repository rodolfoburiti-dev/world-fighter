"""Monta uma cópia do jogo pronta para publicar em qualquer hospedagem estática.

    python tools/build_site.py                 # gera dist/worldfight/
    python tools/build_site.py --out saida     # outra pasta de destino

Carimba uma versão (?v=AAAAMMDD-HHMMSS) em cada import de JavaScript, no index.html e nos arquivos
carregados pelo jogo (window.WF_VERSION). Assim, quem já abriu o jogo antes recebe os arquivos novos
mesmo que a hospedagem mande o navegador guardar cópias por muito tempo.
"""
import argparse
import datetime
import os
import re
import shutil

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..")
GAME = os.path.join(ROOT, "site", "worldfight")
IGNORE = ("*.bak", "*.bak-*", "__pycache__", ".DS_Store", "Thumbs.db")

IMPORT_RE = re.compile(r"""(\bfrom\s+['"])(\.{1,2}/[^'"?]+\.js)(['"])""")
HTML_REF_RE = re.compile(r"""((?:src|href)=["'])((?:js|assets)/[^"'?]+)(["'])""")
CSS_URL_RE = re.compile(r"""(url\(['"]?)(assets/[^'")?]+)(['"]?\))""")


def build(out_dir, stamp):
    dest = os.path.join(out_dir, "worldfight")
    if os.path.exists(dest):
        shutil.rmtree(dest)
    shutil.copytree(GAME, dest, ignore=shutil.ignore_patterns(*IGNORE))
    for folder, _, files in os.walk(dest):
        for name in files:
            path = os.path.join(folder, name)
            if name.endswith(".js") and name != "phaser.min.js":
                text = open(path, encoding="utf-8").read()
                text = IMPORT_RE.sub(lambda m: f"{m.group(1)}{m.group(2)}?v={stamp}{m.group(3)}", text)
                open(path, "w", encoding="utf-8", newline="\n").write(text)
            elif name == "index.html":
                text = open(path, encoding="utf-8").read().replace("__WF_VERSION__", stamp)
                text = HTML_REF_RE.sub(lambda m: f"{m.group(1)}{m.group(2)}?v={stamp}{m.group(3)}", text)
                text = CSS_URL_RE.sub(lambda m: f"{m.group(1)}{m.group(2)}?v={stamp}{m.group(3)}", text)
                open(path, "w", encoding="utf-8", newline="\n").write(text)
    return dest


def main():
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--out", default=os.path.join(ROOT, "dist"))
    args = ap.parse_args()
    stamp = datetime.datetime.now().strftime("%Y%m%d-%H%M%S")
    dest = build(os.path.abspath(args.out), stamp)
    print(f"versão {stamp} pronta em {dest}")


if __name__ == "__main__":
    main()
