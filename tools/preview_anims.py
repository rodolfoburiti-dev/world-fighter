"""Prancha de conferência: desenha as animações de um lutador como o jogo vai mostrar (alinhadas pelos pés).

    python tools/preview_anims.py <id> [anim ...]   -> tools/preview_<id>.png
"""
import json
import os
import sys

from PIL import Image, ImageDraw

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..")
ANIMS = os.path.join(ROOT, "site", "worldfight", "assets", "anims")


def main():
    fid = sys.argv[1]
    meta = json.load(open(os.path.join(ANIMS, "meta.json"), encoding="utf-8"))[fid]
    data = json.load(open(os.path.join(ANIMS, f"{fid}.json"), encoding="utf-8"))
    frames, pages = {}, {}
    for tex in data["textures"]:  # multiatlas: cada quadro sabe em que página está
        img = Image.open(os.path.join(ANIMS, tex["image"])).convert("RGBA")
        for fr in tex["frames"]:
            frames[fr["filename"]] = fr
            pages[fr["filename"]] = img
    wanted = sys.argv[2:] or list(meta["anims"])
    any_frame = next(iter(frames.values()))
    cw, ch = any_frame["sourceSize"]["w"], any_frame["sourceSize"]["h"]
    oy = int(meta["originY"] * ch)
    rows = []
    for anim in wanted:
        n = meta["anims"][anim]["frames"]
        imp = meta["anims"][anim].get("impact")
        strip = Image.new("RGBA", (cw * n, ch), (235, 228, 210, 255))
        d = ImageDraw.Draw(strip)
        for k in range(n):
            f = frames[f"{anim}_{k}"]
            fr = f["frame"]
            piece = pages[f"{anim}_{k}"].crop((fr["x"], fr["y"], fr["x"] + fr["w"], fr["y"] + fr["h"]))
            sx, sy = f["spriteSourceSize"]["x"], f["spriteSourceSize"]["y"]
            strip.alpha_composite(piece, (k * cw + sx, sy))
            d.line([(k * cw + cw // 2, 0), (k * cw + cw // 2, ch)], fill=(255, 0, 0, 160))
            d.line([(k * cw, oy), (k * cw + cw, oy)], fill=(0, 120, 255, 200))
            if k == imp:
                d.rectangle([k * cw, 0, k * cw + cw - 1, ch - 1], outline=(255, 0, 0, 255), width=3)
        d.text((4, 4), anim, fill=(0, 0, 0, 255))
        rows.append(strip)
    W = max(r.width for r in rows)
    sheet = Image.new("RGB", (W, sum(r.height for r in rows)), "white")
    y = 0
    for r in rows:
        sheet.paste(r.convert("RGB"), (0, y))
        y += r.height
    scale = min(1.0, 1900 / W)
    sheet = sheet.resize((int(sheet.width * scale), int(sheet.height * scale)))
    out = os.path.join(ROOT, "tools", f"preview_{fid}.png")
    sheet.save(out)
    print(out, sheet.size)


if __name__ == "__main__":
    main()
