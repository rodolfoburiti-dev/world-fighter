"""Importa as animações dos pacotes de personagens para o jogo.

    python tools/import_sheets.py [pasta_pacote] [pasta_pacote_4k]
        (padrão: incoming/all_characters e incoming/all_characters_4k)

Saída em site/worldfight/assets/anims/:
  <id>.json + <id>-<n>-<hash>.webp   atlas de cada lutador (multiatlas do Phaser, páginas até 2048x2048)
  meta.json                          por lutador: origem dos pés, altura do corpo, animações e quadro de impacto

De onde vem cada coisa:
  - golpes, andar, pulo e respiração dos 9 lutadores: pacote antigo (folhas 10x10). No pacote 4K estes
    vieram fatiados numa grade fixa que corta os bonecos ao meio (447 de 1180 quadros mutilados).
  - Lula: tudo do pacote 4K (os 10 movimentos dele vieram inteiros), em resolução maior.
  - defesa ("defender") e queda ("cair_derrota"): pacote 4K, para todos (vieram inteiros).

Atenção: nos dois pacotes os NOMES das folhas de golpes estão trocados (ex.: "Donald_Trump" é o Kim).
O mapa SHEETS foi feito olhando o conteúdo. Já "defender" e "cair_derrota" do 4K estão com o nome certo.
"""
import hashlib
import json
import os
import sys

import numpy as np
from PIL import Image

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from upscale import upscale  # noqa: E402  (EPX/Scale2x da skill pixel-art-scaler)

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..")
SRC = sys.argv[1] if len(sys.argv) > 1 else os.path.join(ROOT, "incoming", "all_characters")
SRC4K = sys.argv[2] if len(sys.argv) > 2 else os.path.join(ROOT, "incoming", "all_characters_4k")
OUT = os.path.join(ROOT, "site", "worldfight", "assets", "anims")
PAGE = 2048  # lado máximo de cada página do atlas (cabe em qualquer GPU, inclusive de celular)

# id do lutador -> pasta do pacote 4K pelo NOME (vale para defender e cair_derrota)
FOLDER_4K = {
    "lula": "Lula", "milei": "Javier_Milei", "trump": "Donald_Trump", "pena": "Santiago_Pena",
    "xi": "Xi_Jinping", "putin": "Vladimir_Putin", "netanyahu": "Benjamin_Netanyahu", "kim": "Kim_Jong_Un",
    "flavio": "Flavio_Bolsonaro", "bolsonaro": "Jair_Bolsonaro",
}
AI_DIR = os.path.join(ROOT, "incoming", "anim_ia")  # <id>/<estado>/frame-N.png: animações refeitas por IA (sprite-gen)
AI_STATES = {"idle": "idle", "walkf": "walk", "crouch": "crouch", "jab": "jab", "strong": "strong",
             "lowkick": "lowkick", "highkick": "highkick", "jump": "jump", "special": "special", "block": "block"}
AI_USED = set()  # lutadores importados das tiras de IA nesta execução
AI_KO = set()    # ... com nocaute (quique) e levantada também desenhados pela IA
KO_BOUNCE = 4    # quadro do quique na tira de nocaute (0 = recuo do golpe ... 5 = esparramado)
GUARD_FIRST = ("jab", "strong", "lowkick", "highkick", "special", "block", "crouch", "win")  # tiras que começam na guarda
# opcionais: só entram se a pasta existir (win = comemoração de vitória própria do lutador, ex.: o "L" do Molusculo)
AI_OPTIONAL = {"win": "win"}
LYING_DIR = os.path.join(ROOT, "incoming", "deitado")  # <id>.png: o lutador deitado de costas (gerado por IA)
FALL_ANGLES = [0, 14, 32, 52, 70]  # a guarda caindo de costas (graus; anti-horário = cabeça para trás)
LAND_ANGLES = [8, 3, 0, 0, 0]      # já deitado: o tronco bate e assenta no chão
LYING_LEN = 1.35                   # comprimento do corpo deitado / altura da guarda
BODY_H = 290  # altura do corpo de TODOS os lutadores no atlas (o jogo desenha com 300): mesma nitidez para os 10
LULA_BODY_H = BODY_H

# id do lutador -> pasta da folha no pacote (pelo CONTEÚDO, não pelo nome do arquivo)
SHEETS = {
    "xi": "Benjamin_Netanyahu",
    "kim": "Donald_Trump",
    "flavio": "Flavio_Presidente_do_Brazil",
    "netanyahu": "Jair_Bolsonaro",
    "bolsonaro": "Javier_Milei",
    "trump": "Kim_Jong_Un",
    "milei": "Santiago_Pena",
    "putin": "Vladimir_Putin",
    "pena": "Xi_Jinping",
}
ROWS = ["idle", "walkf", "walkb", "crouch", "jab", "strong", "lowkick", "highkick", "jump", "special"]
# Lula (pacote 4K): uma pasta por movimento; não tem andar próprio
LULA = {"idle": "idle_ref", "jab": "golpe_rapido", "strong": "soco_forte", "lowkick": "chute_baixo",
        "highkick": "chute_alto", "crouch": "agachar", "jump": "salto", "special": "soco_alternativo"}
# golpes cujo quadro de impacto é o de maior alcance para a frente (jab: só o 1º golpe da sequência)
ATTACKS = {"jab": 6, "strong": 10, "lowkick": 10, "highkick": 10, "special": 10}


def grow_within(seed, mask):
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


def hard_alpha(arr):
    """Borda nítida: some com o halo semitransparente (o "contorno avermelhado")."""
    arr = arr.copy()
    arr[..., 3] = np.where(arr[..., 3] >= 128, 255, 0).astype(np.uint8)
    return arr


def components(mask):
    """Rotula as manchas conectadas (8-vizinhança) por trechos de linha. Devolve [(rótulo, [(y, x0, x1)])]."""
    parent = []

    def find(i):
        while parent[i] != i:
            parent[i] = parent[parent[i]]
            i = parent[i]
        return i

    runs, prev = [], []
    for y in range(mask.shape[0]):
        d = np.diff(np.concatenate([[0], mask[y].astype(np.int8), [0]]))
        cur = []
        for s, e in zip(np.nonzero(d == 1)[0], np.nonzero(d == -1)[0]):
            lab = len(parent)
            parent.append(lab)
            for ps, pe, pl in prev:
                if ps <= e and pe >= s:  # encosta (inclusive na diagonal)
                    a, b = find(lab), find(pl)
                    if a != b:
                        parent[a] = b
            cur.append((s, e, lab))
            runs.append((y, s, e, lab))
        prev = cur
    groups = {}
    for y, s, e, lab in runs:
        groups.setdefault(find(lab), []).append((y, s, e))
    return list(groups.values())


def frames_from_sheet(path):
    """Acha cada boneco da folha como uma mancha separada, agrupa nas 10 linhas de animação e ordena
    da esquerda para a direita. (As linhas têm de 8 a 10 quadros espalhados pela largura.)"""
    arr = hard_alpha(np.asarray(Image.open(path).convert("RGBA")))
    alpha = arr[..., 3] > 0
    blobs = []
    for runs in components(alpha):
        ys = [r[0] for r in runs]
        x0 = min(r[1] for r in runs)
        x1 = max(r[2] for r in runs)
        n = sum(r[2] - r[1] for r in runs)
        blobs.append({"runs": runs, "x0": x0, "x1": x1, "y0": min(ys), "y1": max(ys) + 1, "n": n})
    big = [b for b in blobs if b["n"] >= 400]
    typical_h = float(np.median([b["y1"] - b["y0"] for b in big]))
    # boneco = mancha grande E alta; drones, bolas de fogo e fagulhas são "efeitos"
    bodies = [b for b in big if b["y1"] - b["y0"] >= 0.6 * typical_h]
    extras = [b for b in blobs if b not in bodies and b["n"] >= 12]
    # linhas: separa pelos 9 maiores saltos na altura (centro) dos bonecos
    bodies.sort(key=lambda b: (b["y0"] + b["y1"]) / 2)
    cy = [(b["y0"] + b["y1"]) / 2 for b in bodies]
    cuts = sorted(np.argsort(np.diff(cy))[-9:] + 1)
    rows = np.split(np.array(bodies, dtype=object), cuts)
    if len(rows) != 10:
        raise SystemExit(f"{path}: achei {len(rows)} linhas")
    # efeitos soltos (fagulhas, objetos) vão para o boneco mais próximo da mesma faixa
    for e in extras:
        ecx, ecy = (e["x0"] + e["x1"]) / 2, (e["y0"] + e["y1"]) / 2
        best, dist = None, 1e9
        for b in bodies:
            if b["y0"] - 30 <= ecy <= b["y1"] + 10:
                dx = max(b["x0"] - e["x1"], e["x0"] - b["x1"], 0)
                if dx < dist:
                    best, dist = b, dx
        if best is not None and dist < 0.5 * (best["x1"] - best["x0"]):
            best.setdefault("extra", []).append(e)

    out = {}
    idle_h = back_offset = None
    for anim, row in zip(ROWS, rows):
        row = sorted(row, key=lambda b: b["x0"])
        items = []
        for b in row:
            parts = [b] + b.get("extra", [])
            x0, x1 = min(p["x0"] for p in parts), max(p["x1"] for p in parts)
            y0, y1 = min(p["y0"] for p in parts), max(p["y1"] for p in parts)
            px = np.zeros((y1 - y0, x1 - x0, 4), np.uint8)
            for p in parts:
                for y, s, e in p["runs"]:
                    px[y - y0, s - x0:e - x0] = arr[y, s:e]
            items.append({"img": Image.fromarray(px, "RGBA"), "x0": x0, "y0": y0, "x1": x1, "y1": y1,
                          "bx0": b["x0"], "bx1": b["x1"], "by0": b["y0"], "by1": b["y1"]})
        # tamanho da linha: o 1º e o último quadro são a guarda; a folha às vezes desenha uma linha maior
        row_h = float(np.median([items[0]["by1"] - items[0]["by0"], items[-1]["by1"] - items[-1]["by0"]]))
        if idle_h is None:
            idle_h = float(np.median([it["by1"] - it["by0"] for it in items]))
        scale = idle_h / row_h if abs(idle_h / row_h - 1) > 0.05 else 1.0
        scale = min(1.35, max(0.75, scale))
        ground = float(np.percentile([it["by1"] for it in items], 90))
        for it in items:
            it["ay"] = it["by1"] if anim == "jump" else ground  # no pulo, os pés de cada quadro são o chão
            # âncora horizontal de cada quadro: as costas na altura da cintura (não treme quando o braço
            # ou a perna estica, e não depende de a folha ter espaçado os quadros por igual)
            band_lo, band_hi = it["ay"] - 0.62 * row_h, it["ay"] - 0.38 * row_h
            a = np.asarray(it["img"])[..., 3] > 0
            rows_in = [y for y in range(a.shape[0]) if band_lo <= y + it["y0"] <= band_hi]
            cols = [np.nonzero(a[y])[0] for y in rows_in]
            backs = [c[0] for c in cols if len(c)]
            it["back"] = it["x0"] + (float(np.percentile(backs, 20)) if backs else 0.0)
        if back_offset is None:  # da respiração: distância das costas (cintura) ao centro do corpo
            back_offset = float(np.median([(it["bx0"] + it["bx1"]) / 2 - it["back"] for it in items]))
        for it in items:
            it["ax"] = it["back"] + back_offset / scale
            if scale != 1.0:  # redimensiona em volta da âncora (pés)
                img = it["img"]
                it["img"] = img.resize((max(1, round(img.width * scale)), max(1, round(img.height * scale))), Image.LANCZOS)
                it["img"] = Image.fromarray(hard_alpha(np.asarray(it["img"])), "RGBA")
                for k in ("x0", "x1"):
                    it[k] = it["ax"] + (it[k] - it["ax"]) * scale
                for k in ("y0", "y1"):
                    it[k] = it["ay"] + (it[k] - it["ay"]) * scale
                it["x1"] = it["x0"] + it["img"].width
                it["y1"] = it["y0"] + it["img"].height
        out[anim] = items
    return out


def tiles_4k(path):
    """As 10 células (5x2) de uma folha 4K, na ordem, como imagens RGBA."""
    at = Image.open(path).convert("RGBA")
    tw, th = at.width // 5, at.height // 2
    return [at.crop(((k % 5) * tw, (k // 5) * th, (k % 5 + 1) * tw, (k // 5 + 1) * th)) for k in range(10)]


def remove_baked_shadow(img):
    """As folhas 4K trazem uma sombra azul-marinho desenhada sob os pés (o jogo desenha a própria).
    Na faixa dos pés, tira os pixels escuros e azulados; depois fica só o que se liga ao corpo."""
    arr = np.asarray(img).copy()
    alpha = arr[..., 3] > 0
    ys = np.nonzero(alpha.any(axis=1))[0]
    if not len(ys):
        return img
    top, bottom = ys[0], ys[-1]
    # só a faixa rente ao chão e só tons quase pretos-azulados (a barra da calça, mais clara, fica)
    band = slice(max(top, bottom - int(0.07 * (bottom - top))), bottom + 1)
    r, g, b = (arr[band, :, i].astype(int) for i in range(3))
    mx = np.maximum(r, g)
    shadow = alpha[band] & (mx < 34) & (b < 62) & (b - mx > 6)
    alpha[band] &= ~shadow
    # só fica o que está ligado ao corpo (sobras soltas da sombra saem)
    seed = np.zeros_like(alpha)
    seed[top:top + int(0.6 * (bottom - top)), :] = alpha[top:top + int(0.6 * (bottom - top)), :]
    alpha = grow_within(seed, alpha)
    arr[..., 3] = np.where(alpha, 255, 0)
    return Image.fromarray(arr, "RGBA")


def frames_from_4k(path, scale, anim):
    """Quadros de uma folha 4K reduzidos por `scale`. As células têm a mesma moldura (origem nos pés,
    ao centro), então a âncora é fixa: centro da célula e o chão comum da animação."""
    items = []
    for tile in tiles_4k(path):
        img = tile.resize((max(1, round(tile.width * scale)), max(1, round(tile.height * scale))), Image.LANCZOS)
        img = remove_baked_shadow(Image.fromarray(hard_alpha(np.asarray(img)), "RGBA"))
        bx0, by0, bx1, by1 = img.getbbox()
        items.append({"img": img.crop((bx0, by0, bx1, by1)), "x0": bx0, "y0": by0, "x1": bx1, "y1": by1,
                      "ax": img.width / 2})
    ground = float(np.percentile([it["y1"] for it in items], 90))
    for it in items:
        it["ay"] = it["y1"] if anim == "jump" else ground
    return items


def guard_height_4k(path):
    """Altura do boneco no 1º quadro (pose de guarda) de uma folha 4K, em pixels da folha."""
    t = np.asarray(tiles_4k(path)[0])[..., 3] >= 128
    ys = np.nonzero(t.any(axis=1))[0]
    return float(ys[-1] - ys[0])


def guard_box_4k(path):
    """Largura e altura do boneco no 1º quadro (guarda) de uma folha 4K, em pixels da folha."""
    t = np.asarray(tiles_4k(path)[0])[..., 3] >= 128
    ys = np.nonzero(t.any(axis=1))[0]
    xs = np.nonzero(t.any(axis=0))[0]
    return float(xs[-1] - xs[0]), float(ys[-1] - ys[0])


def add_block_ko(fid, anims, body_h, same_source=False):
    """Acrescenta a defesa e a queda (pacote 4K) na proporção da guarda deste lutador.

    Elas vêm do desenho original do personagem (mais largo que o boneco das folhas de golpes): a escala
    usa altura e largura da guarda (média ponderada, altura com peso 3) e o alinhamento usa o centro do corpo, não o centro
    da célula. Sem isso, ao defender ou cair o lutador "engordava" e pulava para o lado."""
    base = os.path.join(SRC4K, FOLDER_4K[fid], "movimentos")
    idle = anims["idle"]
    idle_w = float(np.median([it["x1"] - it["x0"] for it in idle]))
    idle_h = float(np.median([it["y1"] - it["y0"] for it in idle]))
    for anim, sub in (("block", "defender"), ("ko", "cair_derrota")):
        path = os.path.join(base, sub, "atlas_4k.webp")
        gw, gh = guard_box_4k(path)
        if same_source:  # Lula: tudo do mesmo pacote, mesma moldura -> só a altura
            scale = body_h / gh
        else:
            # altura pesa mais (o lutador não pode "encolher" ao defender); a largura corrige o desenho mais largo
            scale = float((idle_h / gh) ** 0.75 * (idle_w / gw) ** 0.25)
        if anim == "block":
            items = frames_from_4k(path, scale, anim)
        elif os.path.exists(os.path.join(LYING_DIR, f"{fid}.png")):
            items = fall_to_lying(path, scale, fid)
        else:
            items = fall_from_4k(path, scale)
        if not same_source:
            c0 = (items[0]["x0"] + items[0]["x1"]) / 2  # centro do corpo na guarda (1º quadro)
            for it in items:
                it["ax"] = c0
        anims[anim] = items


def clean_key_fringe(img):
    """Tira a franja magenta que o recorte por chroma deixa na borda da imagem gerada."""
    from PIL import ImageFilter
    arr = np.asarray(img).copy()
    clear = Image.fromarray(np.where(arr[..., 3] < 128, 255, 0).astype(np.uint8), "L").filter(ImageFilter.MaxFilter(13))
    edge = (np.asarray(clear) > 0) & (arr[..., 3] >= 128)
    r, g, b = (arr[..., i].astype(int) for i in range(3))
    arr[..., 3] = np.where(edge & (r - g > 18) & (b - g > 18), 0, arr[..., 3])
    return Image.fromarray(arr, "RGBA")


def fall_to_lying(path, scale, fid):
    """Queda de costas que termina deitada: a guarda (pacote 4K, sem a sombra) gira para trás na 1ª metade;
    na 2ª entra o desenho do lutador deitado (incoming/deitado/<id>.png), com o tronco assentando no chão.
    A levantada do jogo é esta sequência ao contrário. Os pés ficam no lugar; o corpo se estende para trás."""
    raw0 = tiles_4k(path)[0]
    clean0 = remove_baked_shadow(Image.fromarray(hard_alpha(np.asarray(raw0)), "RGBA"))
    bx0, by0, bx1, by1 = clean0.getbbox()
    guard = clean0.crop((bx0, by0, bx1, by1))
    guard = guard.resize((max(1, round(guard.width * scale)), max(1, round(guard.height * scale))), Image.LANCZOS)
    gw, gh = guard.size
    ax = raw0.width / 2 * scale            # mesma âncora da queda antiga (centro da célula)
    gx1 = bx1 * scale                       # frente da guarda (lado dos pés da frente)
    ground = by1 * scale
    lying = clean_key_fringe(Image.open(os.path.join(LYING_DIR, f"{fid}.png")).convert("RGBA"))
    lying = lying.crop(lying.getbbox())
    length = LYING_LEN * gh
    lying = lying.resize((round(length), max(1, round(lying.height * length / lying.width))), Image.LANCZOS)

    items = []

    def place(img, right):
        img = Image.fromarray(hard_alpha(np.asarray(img)), "RGBA")
        img = img.crop(img.getbbox())
        w, h = img.size
        items.append({"img": img, "x0": right - w, "x1": right, "y0": ground - h, "y1": ground, "ax": ax, "ay": ground})

    for th in FALL_ANGLES:
        place(guard.rotate(th, resample=Image.BICUBIC, expand=True), gx1 + 0.12 * gw * th / 90)
    for th in LAND_ANGLES:  # ângulo negativo levanta o lado da cabeça (esquerda)
        place(lying.rotate(-th, resample=Image.BICUBIC, expand=True), gx1 + 0.15 * gw)
    print(f"   queda: de costas até deitado ({lying.width}x{lying.height} px)")
    return items


def fall_from_4k(path, scale):
    """A queda do pacote ("cair_derrota") é a pose de guarda girando, mas a sombra desenhada sob os pés
    gira junto e vira um risco preto. Aqui, para cada quadro, descubro o giro e o deslocamento aplicados
    (comparando silhuetas) e reaplico a MESMA transformação na pose limpa, sem a sombra."""
    tiles = tiles_4k(path)
    raw0 = tiles[0]
    clean0 = remove_baked_shadow(Image.fromarray(hard_alpha(np.asarray(raw0)), "RGBA"))
    small = 0.25

    def mask(img):
        return np.asarray(img)[..., 3] >= 128

    def centroid(m):
        ys, xs = np.nonzero(m)
        return xs.mean(), ys.mean()

    raw0_s = raw0.resize((raw0.width // 4, raw0.height // 4), Image.BILINEAR)
    pad = 400  # folga em volta da célula: o corpo deitado passa da largura dela
    W, H = raw0.width + 2 * pad, raw0.height + 2 * pad
    items, scores = [], []
    for k, tile in enumerate(tiles):
        target = mask(tile.resize(raw0_s.size, Image.BILINEAR))
        tx, ty = centroid(target)
        best = (-1, 0.0)
        for coarse in (range(-130, 41, 3), None):
            angles = coarse if coarse is not None else np.arange(best[1] - 3, best[1] + 3.01, 0.5)
            for th in angles:
                rot = mask(raw0_s.rotate(th, resample=Image.BILINEAR, expand=True))
                cx, cy = centroid(rot)
                # coloca a silhueta girada no lugar do alvo (centroides iguais) e mede a sobreposição
                ox, oy = int(round(tx - cx)), int(round(ty - cy))
                canvas = np.zeros((target.shape[0] + 2 * rot.shape[0], target.shape[1] + 2 * rot.shape[1]), bool)
                sy, sx = rot.shape[0] + oy, rot.shape[1] + ox
                canvas[sy:sy + rot.shape[0], sx:sx + rot.shape[1]] = rot
                inner = canvas[rot.shape[0]:rot.shape[0] + target.shape[0], rot.shape[1]:rot.shape[1] + target.shape[1]]
                inter = (inner & target).sum()
                iou = inter / max(1, (canvas.sum() + target.sum() - inter))
                if iou > best[0]:
                    best = (iou, float(th))
        th = best[1]
        scores.append(best[0])
        # aplica o giro na resolução cheia: posição pelo centroide da versão COM sombra (a referência do pacote)
        rot_raw = raw0.rotate(th, resample=Image.BICUBIC, expand=True)
        rot_clean = clean0.rotate(th, resample=Image.BICUBIC, expand=True)
        rx, ry = centroid(mask(rot_raw))
        fx, fy = centroid(mask(tile))
        frame = Image.new("RGBA", (W, H), (0, 0, 0, 0))
        frame.alpha_composite(rot_clean, (int(round(pad + fx - rx)), int(round(pad + fy - ry))))
        img = frame.resize((max(1, round(W * scale)), max(1, round(H * scale))), Image.LANCZOS)
        img = Image.fromarray(hard_alpha(np.asarray(img)), "RGBA")
        bx0, by0, bx1, by1 = img.getbbox()
        items.append({"img": img.crop((bx0, by0, bx1, by1)), "x0": bx0, "y0": by0, "x1": bx1, "y1": by1,
                      "ax": W * scale / 2})
    ground = items[0]["y1"]  # o chão é o dos pés na pose em pé
    for it in items:
        it["ay"] = ground
        # o ponto mais baixo do corpo sempre encosta no chão: nem afunda, nem flutua
        shift = it["y1"] - ground
        it["y0"] -= shift
        it["y1"] -= shift
    print("   queda: encaixe do giro por quadro", " ".join(f"{s:.2f}" for s in scores))
    return items


def ai_available(fid):
    return all(os.path.isdir(os.path.join(AI_DIR, fid, st)) for st in AI_STATES.values())


def frames_from_ai(fid):
    """Animações geradas por IA (uma tira por movimento, já recortadas pelo sprite-gen em células iguais,
    pés no mesmo chão). Uma escala só para o lutador inteiro (corpo parado = BODY_H); as tiras que começam
    na guarda são corrigidas pela altura dessa guarda, para nenhum golpe "crescer" ou "encolher".
    Âncora horizontal: o calcanhar de trás, que fica plantado nos golpes (o corpo não "anda" quando o braço
    estica); no andar e no pulo, o centro do tronco."""
    raw = {}
    states = dict(AI_STATES)
    states.update({a: st for a, st in AI_OPTIONAL.items() if os.path.isdir(os.path.join(AI_DIR, fid, st))})
    for anim, st in states.items():
        d = os.path.join(AI_DIR, fid, st)
        files = sorted((f for f in os.listdir(d) if f.startswith("frame-") and f.endswith(".png") and ".plain" not in f),
                       key=lambda f: int(f[6:-4]))
        raw[anim] = [Image.fromarray(hard_alpha(np.asarray(Image.open(os.path.join(d, f)).convert("RGBA"))), "RGBA")
                     for f in files]
    idle_h = float(np.median([im.getbbox()[3] - im.getbbox()[1] for im in raw["idle"]]))
    ground = max(im.getbbox()[3] for im in raw["idle"])
    base = BODY_H / idle_h

    def torso_x(im):  # centro do tronco (faixa entre 25% e 55% da altura)
        a = np.asarray(im)[..., 3] > 0
        bx0, by0, bx1, by1 = im.getbbox()
        band = a[by0 + int(0.25 * (by1 - by0)):by0 + int(0.55 * (by1 - by0))]
        return float(np.nonzero(band)[1].mean())

    def heel_x(im):  # calcanhar de trás (o lutador olha para a direita): fica plantado nos golpes
        a = np.asarray(im)[..., 3] > 0
        bx0, by0, bx1, by1 = im.getbbox()
        band = a[by1 - max(3, int(0.06 * idle_h)):by1]
        return float(np.nonzero(band.any(axis=0))[0].min())

    heel_off = heel_x(raw["idle"][0]) - torso_x(raw["idle"][0])
    out = {}
    for anim, imgs in raw.items():
        k = base
        if anim in GUARD_FIRST:
            g = imgs[0].getbbox()
            k = base * float(np.clip(idle_h / (g[3] - g[1]), 0.92, 1.08))
        items = []
        for im in imgs:
            bx0, by0, bx1, by1 = im.getbbox()
            # âncora = onde fica o tronco na guarda: pelo calcanhar de trás (plantado) nos movimentos no chão;
            # no andar e no pulo, que não têm pé fixo, pelo próprio tronco
            hx = torso_x(im) if anim in ("walkf", "jump") else heel_x(im) - heel_off
            crop = im.crop((bx0, by0, bx1, by1))
            crop = crop.resize((max(1, round(crop.width * k)), max(1, round(crop.height * k))), Image.LANCZOS)
            crop = Image.fromarray(hard_alpha(np.asarray(crop)), "RGBA")
            x0, y0 = (bx0 - hx) * k, (by0 - ground) * k
            items.append({"img": crop, "x0": x0, "y0": y0, "x1": x0 + crop.width, "y1": y0 + crop.height,
                          "ax": 0.0, "ay": 0.0})
        out[anim] = items
    AI_USED.add(fid)
    out["walkb"] = list(reversed(out["walkf"]))  # andar para trás: o mesmo passo ao contrário
    # nocaute com quique e levantada desenhados pela IA (mesmo traço); senão, a queda montada com o desenho deitado
    ko_dir = os.path.join(AI_DIR, fid, "ko")
    if os.path.isdir(ko_dir) and os.path.isdir(os.path.join(AI_DIR, fid, "getup")):
        for anim in ("ko", "getup"):
            d = os.path.join(AI_DIR, fid, anim)
            files = sorted((f for f in os.listdir(d) if f.startswith("frame-") and f.endswith(".png") and ".plain" not in f),
                           key=lambda f: int(f[6:-4]))
            items = []
            for f in files:
                im = Image.fromarray(hard_alpha(np.asarray(Image.open(os.path.join(d, f)).convert("RGBA"))), "RGBA")
                bx0, by0, bx1, by1 = im.getbbox()
                hx = torso_x(im)  # deitado ou no ar: centro do corpo
                crop = im.crop((bx0, by0, bx1, by1))
                crop = crop.resize((max(1, round(crop.width * base)), max(1, round(crop.height * base))), Image.LANCZOS)
                crop = Image.fromarray(hard_alpha(np.asarray(crop)), "RGBA")
                g = max(Image.open(os.path.join(d, ff)).getbbox()[3] for ff in files)  # chão da tira
                x0, y0 = (bx0 - hx) * base, (by0 - g) * base
                items.append({"img": crop, "x0": x0, "y0": y0, "x1": x0 + crop.width, "y1": y0 + crop.height, "ax": 0.0, "ay": 0.0})
            out[anim] = items
        AI_KO.add(fid)
    else:
        out["ko"] = fall_to_lying_from(out["idle"][0], fid)
    print(f"   IA: corpo {idle_h:.0f}px na célula -> escala {base:.3f}")
    return out


def fall_to_lying_from(guard_item, fid):
    """Igual a fall_to_lying, mas a partir da guarda gerada por IA (mesmo traço do resto das animações)."""
    guard = guard_item["img"]
    gw, gh = guard.size
    gx1, ground, ax = guard_item["x1"], guard_item["y1"], guard_item["ax"]
    lying = clean_key_fringe(Image.open(os.path.join(LYING_DIR, f"{fid}.png")).convert("RGBA"))
    lying = lying.crop(lying.getbbox())
    length = LYING_LEN * gh
    lying = lying.resize((round(length), max(1, round(lying.height * length / lying.width))), Image.LANCZOS)
    items = []

    def place(img, right):
        img = Image.fromarray(hard_alpha(np.asarray(img)), "RGBA")
        img = img.crop(img.getbbox())
        w, h = img.size
        items.append({"img": img, "x0": right - w, "x1": right, "y0": ground - h, "y1": ground, "ax": ax, "ay": guard_item["ay"]})

    for th in FALL_ANGLES:
        place(guard.rotate(th, resample=Image.BICUBIC, expand=True), gx1 + 0.12 * gw * th / 90)
    for th in LAND_ANGLES:
        place(lying.rotate(-th, resample=Image.BICUBIC, expand=True), gx1 + 0.15 * gw)
    return items


def scale_items(anims, factor):
    """Amplia todos os quadros com a skill (EPX) e escala as coordenadas junto."""
    done = {}
    for items in anims.values():
        for it in items:
            if id(it) in done:
                continue
            done[id(it)] = True
            it["img"] = upscale(it["img"], factor)
            for k in ("x0", "y0", "ax", "ay"):
                it[k] = it[k] * factor
            it["x1"] = it["x0"] + it["img"].width
            it["y1"] = it["y0"] + it["img"].height


def frames_from_lula():
    base = os.path.join(SRC4K, "Lula", "movimentos")
    scale = LULA_BODY_H / guard_height_4k(os.path.join(base, "idle_ref", "atlas_4k.webp"))
    out = {anim: frames_from_4k(os.path.join(base, sub, "atlas_4k.webp"), scale, anim) for anim, sub in LULA.items()}
    # Lula não tem andar no pacote: anda na pose de respiração (o jogo acrescenta o balanço do passo)
    out["walkf"] = out["idle"]
    out["walkb"] = out["idle"]
    add_block_ko("lula", out, LULA_BODY_H, same_source=True)
    return out


def build_atlas(fid, anims):
    # tela comum a todos os quadros, com os pés no mesmo ponto (troca de quadro não desloca o lutador)
    left = right = up = down = 0
    for items in anims.values():
        for it in items:
            left = max(left, it["ax"] - it["x0"])
            right = max(right, it["x1"] - it["ax"])
            up = max(up, it["ay"] - it["y0"])
            down = max(down, it["y1"] - it["ay"])
    half = int(np.ceil(max(left, right))) + 2
    cw, chh = half * 2, int(np.ceil(up + down)) + 4
    ay = int(np.ceil(up)) + 2

    # empacota os quadros recortados em prateleiras, abrindo páginas novas quando enche (multiatlas);
    # quadros repetidos (ex.: andar do Lula = respiração) são guardados uma vez só
    entries, seen = [], {}
    for anim, items in anims.items():
        for k, it in enumerate(items):
            entries.append((f"{anim}_{k}", it))
    unique = []
    for name, it in entries:
        if id(it) not in seen:
            seen[id(it)] = name
            unique.append((name, it))
    unique.sort(key=lambda e: -e[1]["img"].height)
    pages = [[]]
    x = y = shelf = 0
    place_of = {}
    for name, it in unique:
        w, h = it["img"].size
        if x + w > PAGE:
            x, y, shelf = 0, y + shelf + 2, 0
        if y + h > PAGE:
            pages.append([])
            x = y = shelf = 0
        pages[-1].append((it, x, y))
        place_of[id(it)] = (len(pages) - 1, x, y)
        x += w + 2
        shelf = max(shelf, h)

    for old in os.listdir(OUT):  # páginas antigas deste lutador
        if old.startswith(f"{fid}-") and old.endswith(".webp") or old == f"{fid}.webp":
            os.remove(os.path.join(OUT, old))
    textures = []
    for p, placed in enumerate(pages):
        pw = max(px + it["img"].width for it, px, _ in placed)
        ph = max(py + it["img"].height for it, _, py in placed)
        page = Image.new("RGBA", (pw, ph), (0, 0, 0, 0))
        for it, px, py in placed:
            page.alpha_composite(it["img"], (px, py))
        tmp = os.path.join(OUT, f"{fid}-{p}.tmp.webp")
        page.save(tmp, "WEBP", quality=90, method=6)
        digest = hashlib.md5(open(tmp, "rb").read()).hexdigest()[:8]  # nome muda quando a imagem muda
        name = f"{fid}-{p}-{digest}.webp"
        os.replace(tmp, os.path.join(OUT, name))
        textures.append({"image": name, "format": "RGBA8888", "size": {"w": pw, "h": ph}, "scale": 1, "frames": []})
    for name, it in entries:
        p, px, py = place_of[id(it)]
        w, h = it["img"].size
        ox = int(round(half + (it["x0"] - it["ax"])))
        oy = int(round(ay + (it["y0"] - it["ay"])))
        textures[p]["frames"].append({"filename": name, "frame": {"x": px, "y": py, "w": w, "h": h}, "rotated": False,
                                      "trimmed": True, "spriteSourceSize": {"x": ox, "y": oy, "w": w, "h": h},
                                      "sourceSize": {"w": cw, "h": chh}})
    with open(os.path.join(OUT, f"{fid}.json"), "w", encoding="utf-8") as fh:
        json.dump({"textures": textures, "meta": {"app": "World Fighter tools/import_sheets.py"}}, fh)
    atlas_size = (len(textures), sum(t["size"]["w"] * t["size"]["h"] for t in textures) // 1000)

    idle = anims["idle"]
    body_h = float(np.median([it["y1"] - it["y0"] for it in idle]))
    body_w = float(np.median([it["x1"] - it["x0"] for it in idle]))
    guard = front_mass(idle[0], body_h, body_w, ATTACK_ZONE["jab"])
    info = {"originY": ay / chh, "bodyH": body_h, "bodyW": body_w, "anims": {}, "alias": {}}
    for anim, items in anims.items():
        a = {"frames": len(items)}
        if anim in ATTACKS:
            lim = ATTACKS[anim]
            mass = [front_mass(it, body_h, body_w, ATTACK_ZONE[anim]) for it in items[:lim]]
            if fid in AI_USED and len(mass) > 2:  # tiras de IA começam e terminam na guarda: impacto no meio
                mass[0] = mass[-1] = -1
            a["impact"] = int(np.argmax(mass))
            a["reach"] = round((items[a["impact"]]["x1"] - items[a["impact"]]["ax"]) / body_h, 3)
            a["strength"] = round(max(mass) / max(1, guard), 2)
        if anim == "ko" and fid in AI_KO:
            a["bounce"] = KO_BOUNCE
        if anim == "crouch":
            a["low"] = int(np.argmin([it["y1"] - it["y0"] for it in items[:7]]))
        info["anims"][anim] = a
    # golpe que não aparece de verdade na folha (ex.: "chute alto" desenhado como pulinhos) usa outro golpe
    for anim, fallback in (("highkick", "lowkick"), ("lowkick", "highkick"), ("strong", "jab")):
        if fid in AI_USED:  # tiras de IA trazem cada golpe desenhado de verdade (a troca era para as folhas antigas)
            break
        if anim in info["anims"] and info["anims"][anim].get("strength", 9) < 1.6:
            info["alias"][anim] = fallback
    if anims["walkf"] is anims["idle"]:
        info["noWalk"] = True  # sem andar próprio: o jogo faz o balanço do passo
    return info, atlas_size


# regiões "à frente do corpo" onde cada golpe deve aparecer (frações da largura/altura do corpo,
# medidas a partir dos pés): (x mínimo à frente do centro, altura mínima, altura máxima)
ATTACK_ZONE = {"jab": (0.32, 0.45, 0.9), "strong": (0.32, 0.4, 0.9), "lowkick": (0.3, 0.0, 0.5),
               "highkick": (0.25, 0.4, 1.2), "special": (0.35, 0.2, 1.0)}


def front_mass(it, body_h, body_w, zone):
    """Quantos pixels do boneco estão à frente do corpo, na faixa de altura do golpe."""
    fx, h0, h1 = zone
    arr = np.asarray(it["img"])[..., 3] > 0
    ys, xs = np.nonzero(arr)
    gx = xs + it["x0"] - it["ax"]          # x relativo ao centro do corpo
    gy = it["ay"] - (ys + it["y0"])        # altura acima do chão
    return int(((gx > fx * body_w) & (gy >= h0 * body_h) & (gy <= h1 * body_h)).sum())


def main():
    os.makedirs(OUT, exist_ok=True)
    meta = {}
    for fid, folder in SHEETS.items():
        if ai_available(fid):
            anims = frames_from_ai(fid)
        else:
            sheet = os.path.join(SRC, folder, f"{folder}_spritesheet.png")
            anims = frames_from_sheet(sheet)
            body_h = float(np.median([it["y1"] - it["y0"] for it in anims["idle"]]))
            scale_items(anims, BODY_H / body_h)  # todos com o mesmo tamanho de corpo do Lula
            add_block_ko(fid, anims, BODY_H)
        meta[fid], size = build_atlas(fid, anims)
        print(f"ok {fid:10} páginas/kpx {size}  corpo {meta[fid]['bodyH']:.0f}px  "
              + "  ".join(f"{k}:{v.get('impact', '')}/{v.get('reach', '')}" for k, v in meta[fid]["anims"].items() if "impact" in v))
    meta["lula"], size = build_atlas("lula", frames_from_ai("lula") if ai_available("lula") else frames_from_lula())
    print(f"ok lula       páginas/kpx {size}  corpo {meta['lula']['bodyH']:.0f}px")
    with open(os.path.join(OUT, "meta.json"), "w", encoding="utf-8") as fh:
        json.dump(meta, fh, indent=1)


if __name__ == "__main__":
    main()
