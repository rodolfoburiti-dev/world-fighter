"""Gera os quadros de golpe dos lutadores a partir da pose única de guarda ("boneco de recorte").

    python tools/rig_frames.py            # gera site/worldfight/assets/fighters/<id>/<quadro>.webp
    python tools/rig_frames.py --debug    # também salva tools/rig_debug.png com os pontos marcados

Para cada lutador marcamos (em frações da largura/altura do sprite, olhando para a direita):
ombro S, cotovelo E e punho F do braço da frente; quadril H, joelho K, tornozelo A e pé P da
perna da frente. O braço/perna é recortado em duas peças com a textura original, retirado do
corpo (o buraco é preenchido com a cor vizinha) e remontado na nova posição.

Todos os quadros saem na mesma tela (mesma largura), com o corpo centralizado: trocar de quadro
no jogo não desloca o lutador.
"""
import math
import os
import sys

import numpy as np
from PIL import Image, ImageDraw

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..")
SRC = os.path.join(ROOT, "site", "worldfight", "assets", "fighters")
CANVAS_HALF = 300  # metade da largura da tela de cada quadro (px, sprite com 440 de altura)

# (x, y) em frações; ra = meia-espessura do braço, rf = raio do punho, rl = meia-espessura da perna (frações da altura)
COMMON_LEG = dict(H=(0.62, 0.52), K=(0.745, 0.70), A=(0.81, 0.88), P=(0.86, 0.95), rl=0.065, rp=0.055)
LANDMARKS = {
    "lula":      dict(S=(0.68, 0.27), E=(0.85, 0.37), F=(0.765, 0.235), ra=0.045, rf=0.058, **COMMON_LEG),
    "milei":     dict(S=(0.66, 0.25), E=(0.78, 0.43), F=(0.865, 0.33), ra=0.045, rf=0.055, **{**COMMON_LEG, "K": (0.74, 0.70), "A": (0.83, 0.88), "P": (0.88, 0.95)}),
    "trump":     dict(S=(0.66, 0.25), E=(0.86, 0.34), F=(0.80, 0.215), ra=0.045, rf=0.058, **{**COMMON_LEG, "K": (0.76, 0.70), "A": (0.82, 0.88), "P": (0.87, 0.95)}),
    "pena":      dict(S=(0.68, 0.25), E=(0.84, 0.40), F=(0.78, 0.265), ra=0.045, rf=0.058, **{**COMMON_LEG, "A": (0.80, 0.88), "P": (0.85, 0.95)}),
    "xi":        dict(S=(0.68, 0.24), E=(0.90, 0.34), F=(0.84, 0.21), ra=0.045, rf=0.055, **{**COMMON_LEG, "K": (0.75, 0.70), "A": (0.82, 0.88), "P": (0.87, 0.95)}),
    "putin":     dict(S=(0.66, 0.25), E=(0.86, 0.36), F=(0.78, 0.24), ra=0.045, rf=0.055, **{**COMMON_LEG, "K": (0.73, 0.70), "A": (0.78, 0.88), "P": (0.84, 0.95)}),
    "netanyahu": dict(S=(0.65, 0.25), E=(0.79, 0.42), F=(0.84, 0.30), ra=0.045, rf=0.058, **COMMON_LEG),
    "kim":       dict(S=(0.72, 0.27), E=(0.92, 0.35), F=(0.84, 0.22), ra=0.042, rf=0.058, **{**COMMON_LEG, "H": (0.64, 0.52), "K": (0.77, 0.70), "A": (0.84, 0.88), "P": (0.88, 0.95)}),
    "flavio":    dict(S=(0.68, 0.25), E=(0.88, 0.37), F=(0.79, 0.25), ra=0.045, rf=0.055, **COMMON_LEG),
    "bolsonaro": dict(S=(0.71, 0.28), E=(0.87, 0.42), F=(0.775, 0.28), ra=0.04, rf=0.055, **{**COMMON_LEG, "H": (0.64, 0.52), "K": (0.785, 0.70), "A": (0.80, 0.88), "P": (0.83, 0.96), "rl": 0.068}),
}

FRAMES = ["idle", "punch1", "punch2", "kick1", "kick2", "crouch", "cpunch", "sweep", "jump"]


# ---- geometria ------------------------------------------------------------------------------
def seg_mask(shape, p0, p1, r):
    h, w = shape
    yy, xx = np.mgrid[0:h, 0:w]
    px, py = xx - p0[0], yy - p0[1]
    vx, vy = p1[0] - p0[0], p1[1] - p0[1]
    t = np.clip((px * vx + py * vy) / max(1e-6, vx * vx + vy * vy), 0, 1)
    dx, dy = px - t * vx, py - t * vy
    return dx * dx + dy * dy <= r * r


def circle_mask(shape, c, r):
    h, w = shape
    yy, xx = np.mgrid[0:h, 0:w]
    return (xx - c[0]) ** 2 + (yy - c[1]) ** 2 <= r * r


def similarity(img, a0, a1, b0, b1):
    """Leva a peça de modo que o segmento a0→a1 caia sobre b0→b1 (gira, escala e move)."""
    ax, ay = a1[0] - a0[0], a1[1] - a0[1]
    bx, by = b1[0] - b0[0], b1[1] - b0[1]
    s = math.hypot(bx, by) / max(1e-6, math.hypot(ax, ay))
    th = math.atan2(by, bx) - math.atan2(ay, ax)
    c, si = math.cos(-th) / s, math.sin(-th) / s
    # entrada = a0 + R(-th)/s * (saída - b0)
    a, b_, d, e = c, -si, si, c
    cx = a0[0] - (a * b0[0] + b_ * b0[1])
    cy = a0[1] - (d * b0[0] + e * b0[1])
    return img.transform(img.size, Image.AFFINE, (a, b_, cx, d, e, cy), resample=Image.BICUBIC)


def piece(base, mask):
    arr = np.asarray(base).copy()
    arr[..., 3] = np.where(mask, arr[..., 3], 0)
    return Image.fromarray(arr, "RGBA")


def fill_holes_rgb(arr, holes):
    """Preenche os pixels `holes` com a média dos vizinhos já conhecidos, de fora para dentro."""
    rgb = arr[..., :3].astype(float)
    known = (arr[..., 3] > 0) & ~holes
    todo = holes.copy()
    for _ in range(200):
        if not todo.any():
            break
        acc = np.zeros_like(rgb)
        cnt = np.zeros(known.shape)
        for dy in (-1, 0, 1):
            for dx in (-1, 0, 1):
                if dx == 0 and dy == 0:
                    continue
                k = np.roll(np.roll(known, dy, 0), dx, 1)
                acc += np.roll(np.roll(rgb, dy, 0), dx, 1) * k[..., None]
                cnt += k
        ready = todo & (cnt > 0)
        rgb[ready] = acc[ready] / cnt[ready][:, None]
        known |= ready
        todo &= ~ready
    arr[..., :3] = np.clip(rgb, 0, 255).astype(np.uint8)
    return arr


def row_hull(alpha, y0, y1):
    """Para cada linha entre y0 e y1, marca o trecho entre o primeiro e o último pixel do corpo."""
    hull = np.zeros_like(alpha)
    for y in range(max(0, y0), min(alpha.shape[0], y1)):
        xs = np.nonzero(alpha[y])[0]
        if len(xs):
            hull[y, xs[0]:xs[-1] + 1] = True
    return hull


def grow_within(seed, mask):
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


def remove_part(base, mask, keep_rows, torso_seed, flank=None):
    """Tira um membro do corpo. Onde o membro estava na frente do tronco, recompõe o tronco;
    restos soltos do membro (tiras de calça, pedaços de manga) que não se ligam ao tronco somem.
    `flank` = região do tronco que ficava escondida atrás do braço e precisa ser redesenhada."""
    arr = np.asarray(base).copy()
    alpha = arr[..., 3] > 0
    rest = alpha & ~mask
    hull = row_hull(rest, *keep_rows)
    behind = mask & (hull | (flank if flank is not None else False))
    body = grow_within(torso_seed, rest | behind)
    behind &= body
    arr[..., 3] = np.where(body, 255, 0).astype(np.uint8)
    arr = fill_holes_rgb(arr, behind)
    return Image.fromarray(arr, "RGBA")


def rot(v, deg):
    r = math.radians(deg)
    return (v[0] * math.cos(r) - v[1] * math.sin(r), v[0] * math.sin(r) + v[1] * math.cos(r))


def along(p, ang_deg, length):
    return (p[0] + math.cos(math.radians(ang_deg)) * length, p[1] + math.sin(math.radians(ang_deg)) * length)


def dist(a, b):
    return math.hypot(b[0] - a[0], b[1] - a[1])


def angle(a, b):
    return math.degrees(math.atan2(b[1] - a[1], b[0] - a[0]))


def lerp_angle(a, b, t):
    d = (b - a + 180) % 360 - 180
    return a + d * t


# ---- quadros ----------------------------------------------------------------------------------
class Rig:
    def __init__(self, fid, img):
        self.fid = fid
        w, h = img.size
        W = max(w, CANVAS_HALF * 2)
        self.ox = (W - w) // 2
        self.canvas = Image.new("RGBA", (W, h), (0, 0, 0, 0))
        self.canvas.paste(img, (self.ox, 0))
        self.W, self.h, self.w = W, h, w
        L = LANDMARKS[fid]
        P = lambda k: (self.ox + L[k][0] * w, L[k][1] * h)
        self.S, self.E, self.F = P("S"), P("E"), P("F")
        self.H, self.K, self.A, self.Pf = P("H"), P("K"), P("A"), P("P")
        self.ra, self.rf, self.rl, self.rp = L["ra"] * h, L["rf"] * h, L["rl"] * h, L["rp"] * h
        shape = (h, W)
        alpha = np.asarray(self.canvas)[..., 3] > 0
        below_hip = np.zeros(shape, bool)
        below_hip[int(self.H[1] - 0.02 * h):, :] = True

        def arm_masks(k):
            up = seg_mask(shape, self.S, self.E, self.ra * k) & alpha
            fo = (seg_mask(shape, self.E, self.F, self.ra * k) | circle_mask(shape, self.F, self.rf * k)) & alpha
            return up, fo

        def leg_masks(k):
            th = seg_mask(shape, self.H, self.K, self.rl * k) & alpha & below_hip
            sh = (seg_mask(shape, self.K, self.A, self.rl * 0.85 * k) | circle_mask(shape, self.Pf, self.rp * k)
                  | seg_mask(shape, self.A, (self.Pf[0] + self.rp, self.Pf[1]), self.rp * 0.8 * k)) & alpha & below_hip
            return th, sh

        # a peça que se move é justa; o buraco tirado do corpo é mais largo (some com as bordas do membro)
        self.upper_m, self.fore_m = arm_masks(1.0)
        # a manga do braço de cima não leva junto a camisa/gravata do peito
        rgb = np.asarray(self.canvas)[..., :3].astype(int)
        shirt = (rgb.min(axis=2) > 175) | ((rgb[..., 0] > 150) & (rgb[..., 1] < 90) & (rgb[..., 2] < 90))
        self.upper_m &= ~(shirt & (np.mgrid[0:h, 0:W][1] < self.S[0] + 0.04 * w))
        self.thigh_m, self.shin_m = leg_masks(1.1)
        cut_up, cut_fo = arm_masks(1.4)
        cut_th, cut_sh = leg_masks(1.5)
        seed = np.zeros(shape, bool)
        seed[int(0.30 * h):int(0.48 * h), int(self.ox + 0.38 * w):int(self.ox + 0.55 * w)] = True
        # lateral do tronco escondida atrás do braço: do ombro até o quadril, um pouco além do ombro
        yy, xx = np.mgrid[0:h, 0:W]
        t = np.clip((yy - self.S[1]) / max(1.0, self.H[1] - self.S[1]), 0, 1)
        edge = (self.S[0] + 0.03 * w) * (1 - t) + (self.H[0] + 0.07 * w) * t
        flank = (yy >= self.S[1] - 0.02 * h) & (yy <= self.H[1]) & (xx <= edge)
        self.no_arm = remove_part(self.canvas, cut_up | cut_fo, (0, int(self.H[1])), seed, flank)
        self.no_leg = remove_part(self.canvas, cut_th | cut_sh, (int(self.H[1] - 0.02 * h), int(self.H[1] + 0.025 * h)), seed)

    # braço: a = ângulo final do braço (0 = reto para a frente); t = 0..1 do caminho até lá
    def arm(self, body, t, final=4, shift=(0, 0)):
        a_up0, a_fo0 = angle(self.S, self.E), angle(self.E, self.F)
        a_up, a_fo = lerp_angle(a_up0, final, t), lerp_angle(a_fo0, final, t)
        S = (self.S[0] + shift[0], self.S[1] + shift[1])
        E2 = along(S, a_up, dist(self.S, self.E))
        F2 = along(E2, a_fo, dist(self.E, self.F) * (1 + 0.1 * t))
        out = body.copy()
        out.alpha_composite(similarity(piece(self.canvas, self.upper_m), self.S, self.E, S, E2))
        out.alpha_composite(similarity(piece(self.canvas, self.fore_m), self.E, self.F, E2, F2))
        return out

    # perna: ângulos da coxa e da canela (graus; 0 = para a frente, negativo = para cima)
    def leg(self, body, a_thigh, a_shin, hip=None):
        H = hip or self.H
        K2 = along(H, a_thigh, dist(self.H, self.K))
        A2 = along(K2, a_shin, dist(self.K, self.A))
        out = body.copy()
        out.alpha_composite(similarity(piece(self.canvas, self.thigh_m), self.H, self.K, H, K2))
        out.alpha_composite(similarity(piece(self.canvas, self.shin_m), self.K, self.A, K2, A2))
        return out

    def crouch(self, img, factor=0.5):
        """Agacha: o tronco desce inteiro e só as pernas encolhem (o personagem não é achatado)."""
        split = int(self.H[1])
        top = img.crop((0, 0, self.W, split))
        legs = img.crop((0, split, self.W, self.h))
        new_h = max(1, int(legs.height * factor))
        legs = legs.resize((int(self.W * 1.0), new_h), Image.LANCZOS)
        out = Image.new("RGBA", (self.W, self.h), (0, 0, 0, 0))
        drop = self.h - split - new_h
        out.alpha_composite(top, (0, drop))
        out.alpha_composite(legs, (0, self.h - new_h))
        return out, drop

    def frames(self):
        f = {"idle": self.canvas}
        f["punch1"] = self.arm(self.no_arm, 0.5)
        f["punch2"] = self.arm(self.no_arm, 1.0)
        f["kick1"] = self.leg(self.no_leg, -35, 55)          # joelho sobe, canela ainda dobrada
        f["kick2"] = self.leg(self.no_leg, -12, -12)         # perna esticada à frente, sola para o alvo
        f["crouch"], drop = self.crouch(self.canvas)
        f["cpunch"], _ = self.crouch(f["punch2"])
        body, drop = self.crouch(self.no_leg)
        hip = (self.H[0], self.H[1] + drop)
        reach = dist(self.H, self.K) + dist(self.K, self.A)
        low = math.degrees(math.asin(min(0.98, (self.h - 0.035 * self.h - hip[1]) / reach)))
        f["sweep"] = self.leg(body, low * 0.55, low * 0.35, hip=hip)  # rasteira: perna varrendo rente ao chão
        f["jump"], _ = self.crouch(self.canvas, 0.68)
        return f


def main():
    debug = "--debug" in sys.argv
    sheets = []
    for fid in LANDMARKS:
        img = Image.open(os.path.join(SRC, f"{fid}.webp")).convert("RGBA")
        rig = Rig(fid, img)
        out_dir = os.path.join(SRC, fid)
        os.makedirs(out_dir, exist_ok=True)
        frames = rig.frames()
        for name, im in frames.items():
            im.save(os.path.join(out_dir, f"{name}.webp"), "WEBP", quality=88, method=6)
        print("ok", fid, rig.W, "x", rig.h)
        if debug:
            row = []
            for name in FRAMES:
                bg = Image.new("RGBA", frames[name].size, (235, 228, 210, 255))
                bg.alpha_composite(frames[name])
                if name == "idle":
                    d = ImageDraw.Draw(bg)
                    for p, col in ((rig.S, "red"), (rig.E, "orange"), (rig.F, "yellow"), (rig.H, "cyan"), (rig.K, "blue"), (rig.A, "magenta"), (rig.Pf, "green")):
                        d.ellipse([p[0] - 5, p[1] - 5, p[0] + 5, p[1] + 5], outline=col, width=3)
                    d.line([rig.S, rig.E, rig.F], fill="red", width=2)
                    d.line([rig.H, rig.K, rig.A, rig.Pf], fill="cyan", width=2)
                row.append(bg.convert("RGB").resize((bg.width // 2, bg.height // 2)))
            strip = Image.new("RGB", (sum(r.width for r in row), row[0].height), "white")
            x = 0
            for r in row:
                strip.paste(r, (x, 0))
                x += r.width
            sheets.append(strip)
    if debug:
        for k in range(0, len(sheets), 5):
            part = sheets[k:k + 5]
            s = Image.new("RGB", (max(p.width for p in part), sum(p.height for p in part)), "white")
            y = 0
            for p in part:
                s.paste(p, (0, y))
                y += p.height
            s.save(os.path.join(ROOT, "tools", f"rig_debug{k // 5}.png"))


if __name__ == "__main__":
    main()
