// Controles de toque (celular), 2026-11-12.
// Esquerda: direcional analógico 360° flutuante, como nos jogos de ação para celular: aparece onde o
// polegar encosta, a alavanca segue o dedo e a base acompanha quando o dedo passa da borda.
// Direita: os quatro botões do controle do Xbox (Y em cima, X à esquerda, B à direita, A embaixo),
// translúcidos, com as cores e letras do controle.
// Tudo desenhado em canvas (degradês e brilho) uma vez só e reaproveitado entre as lutas.
import { FONT, H, W } from './data.js';

const R = 96;                       // raio da base do direcional
const KNOB = 42;                    // raio da alavanca
const DEAD = 0.28;                  // zona morta (fração do raio)
const PAD_HOME = { x: 200, y: 548 };
const PAD_ZONE_X = W * 0.46;        // toques à esquerda disto movem o direcional
const TOP_SAFE = 140;               // acima disto fica o placar (barras de vida, tempo)
const BTN_R = 42;
const BTN_C = { x: 1116, y: 552 };  // centro do losango de botões
const BTN_GAP = 84;
const BTN_HIT = BTN_R * 1.45;       // área de toque um pouco maior que o desenho
const IDLE_ALPHA = 0.5;

export const XBOX_COLORS = { A: '#5fc72e', B: '#ef3d37', X: '#2f88f7', Y: '#f8c51c' };
const BTN_POS = { Y: [0, -1], X: [-1, 0], B: [1, 0], A: [0, 1] };

const rgba = (hex, a) => {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${n >> 16},${(n >> 8) & 255},${n & 255},${a})`;
};

function canvasTexture(scene, key, size, draw) {
  if (scene.textures.exists(key)) return;
  const tex = scene.textures.createCanvas(key, size, size);
  const ctx = tex.getContext();
  draw(ctx, size / 2);
  tex.refresh();
}

function disc(ctx, c, r) {
  ctx.beginPath();
  ctx.arc(c, c, r, 0, Math.PI * 2);
}

function makeTextures(scene) {
  // base do direcional: disco escuro translúcido, aro claro, guia interna e quatro setas
  canvasTexture(scene, 'tc-base', (R + 10) * 2, (ctx, c) => {
    const g = ctx.createRadialGradient(c, c, R * 0.15, c, c, R);
    g.addColorStop(0, 'rgba(24,30,70,0.10)');
    g.addColorStop(1, 'rgba(8,12,36,0.45)');
    disc(ctx, c, R);
    ctx.fillStyle = g;
    ctx.fill();
    ctx.lineWidth = 3;
    ctx.strokeStyle = 'rgba(255,255,255,0.6)';
    disc(ctx, c, R - 1.5);
    ctx.stroke();
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = 'rgba(255,255,255,0.16)';
    disc(ctx, c, R * 0.6);
    ctx.stroke();
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.lineWidth = 3.5;
    ctx.strokeStyle = 'rgba(255,255,255,0.7)';
    for (let k = 0; k < 4; k++) {
      ctx.save();
      ctx.translate(c, c);
      ctx.rotate((k * Math.PI) / 2);
      ctx.translate(R - 19, 0);
      ctx.beginPath();
      ctx.moveTo(-5, -9);
      ctx.lineTo(4, 0);
      ctx.lineTo(-5, 9);
      ctx.stroke();
      ctx.restore();
    }
  });
  // brilho no aro, apontando para onde a alavanca está empurrada
  canvasTexture(scene, 'tc-glow', (R + 22) * 2, (ctx, c) => {
    ctx.lineCap = 'round';
    ctx.shadowColor = 'rgba(255,214,58,0.9)';
    ctx.shadowBlur = 16;
    ctx.lineWidth = 6;
    ctx.strokeStyle = 'rgba(255,224,110,0.95)';
    ctx.beginPath();
    ctx.arc(c, c, R + 6, -0.85, 0.85);
    ctx.stroke();
  });
  // alavanca: esfera clara com reflexo e aro
  canvasTexture(scene, 'tc-knob', (KNOB + 10) * 2, (ctx, c) => {
    ctx.shadowColor = 'rgba(0,0,0,0.45)';
    ctx.shadowBlur = 10;
    ctx.shadowOffsetY = 3;
    const g = ctx.createRadialGradient(c - KNOB * 0.35, c - KNOB * 0.4, 2, c, c, KNOB);
    g.addColorStop(0, 'rgba(255,255,255,0.85)');
    g.addColorStop(0.55, 'rgba(225,232,255,0.45)');
    g.addColorStop(1, 'rgba(150,162,215,0.38)');
    disc(ctx, c, KNOB);
    ctx.fillStyle = g;
    ctx.fill();
    ctx.shadowColor = 'transparent';
    ctx.lineWidth = 2.5;
    ctx.strokeStyle = 'rgba(255,255,255,0.9)';
    disc(ctx, c, KNOB - 1.25);
    ctx.stroke();
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = 'rgba(255,255,255,0.35)';
    disc(ctx, c, KNOB * 0.5);
    ctx.stroke();
  });
  // botão de pausa (pequeno, abaixo do relógio)
  canvasTexture(scene, 'tc-pause', 56, (ctx, c) => {
    disc(ctx, c, 24);
    ctx.fillStyle = 'rgba(8,12,36,0.5)';
    ctx.fill();
    ctx.lineWidth = 2;
    ctx.strokeStyle = 'rgba(255,255,255,0.6)';
    ctx.stroke();
    ctx.fillStyle = 'rgba(255,255,255,0.85)';
    ctx.fillRect(c - 8, c - 9, 5, 18);
    ctx.fillRect(c + 3, c - 9, 5, 18);
  });
}

// botão do Xbox: disco escuro brilhante com a letra colorida; apertado, acende na cor do botão
function makeButtonTexture(scene, id, label, pressed) {
  const color = XBOX_COLORS[id];
  canvasTexture(scene, `tc-btn-${id}${pressed ? '-on' : ''}`, (BTN_R + 12) * 2, (ctx, c) => {
    ctx.shadowColor = pressed ? rgba(color, 0.9) : 'rgba(0,0,0,0.4)';
    ctx.shadowBlur = pressed ? 18 : 8;
    ctx.shadowOffsetY = pressed ? 0 : 2;
    const body = ctx.createRadialGradient(c - BTN_R * 0.3, c - BTN_R * 0.45, 2, c, c, BTN_R);
    if (pressed) {
      body.addColorStop(0, rgba(color, 0.95));
      body.addColorStop(1, rgba(color, 0.6));
    } else {
      body.addColorStop(0, 'rgba(70,74,92,0.55)');
      body.addColorStop(1, 'rgba(6,8,16,0.55)');
    }
    disc(ctx, c, BTN_R);
    ctx.fillStyle = body;
    ctx.fill();
    ctx.shadowColor = 'transparent';
    ctx.lineWidth = 3;
    ctx.strokeStyle = pressed ? 'rgba(255,255,255,0.95)' : rgba(color, 0.9);
    disc(ctx, c, BTN_R - 1.5);
    ctx.stroke();
    // reflexo na metade de cima, como plástico
    ctx.save();
    disc(ctx, c, BTN_R - 4);
    ctx.clip();
    const gloss = ctx.createLinearGradient(0, c - BTN_R, 0, c);
    gloss.addColorStop(0, 'rgba(255,255,255,0.26)');
    gloss.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = gloss;
    ctx.beginPath();
    ctx.ellipse(c, c - BTN_R * 0.42, BTN_R * 0.82, BTN_R * 0.52, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
    // letra
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = '900 34px "Arial Black", "Segoe UI", Arial, sans-serif';
    ctx.lineWidth = 3;
    ctx.strokeStyle = 'rgba(0,0,0,0.35)';
    ctx.strokeText(id, c, c - 6);
    ctx.fillStyle = pressed ? '#ffffff' : color;
    ctx.fillText(id, c, c - 6);
    // nome do golpe
    ctx.font = `7px ${FONT}`;
    ctx.fillStyle = pressed ? '#ffffff' : 'rgba(255,255,255,0.78)';
    ctx.fillText(label, c, c + 22);
  });
}

export class TouchControls {
  /**
   * @param {Phaser.Scene} scene
   * @param {{id: 'A'|'B'|'X'|'Y', label: string, press: Function, release?: Function}[]} buttons
   * @param {{onPause?: Function}} opts
   */
  constructor(scene, buttons, opts = {}) {
    this.scene = scene;
    this.state = { left: false, right: false, up: false, down: false };
    this.stick = null;          // { id, bx, by } enquanto um dedo segura o direcional
    this.held = new Map();      // dedo -> botão
    this.enabled = true;
    makeTextures(scene);
    scene.input.addPointer(3);

    this.base = scene.add.image(PAD_HOME.x, PAD_HOME.y, 'tc-base').setDepth(70).setAlpha(IDLE_ALPHA);
    this.glow = scene.add.image(PAD_HOME.x, PAD_HOME.y, 'tc-glow').setDepth(71).setVisible(false);
    this.knob = scene.add.image(PAD_HOME.x, PAD_HOME.y, 'tc-knob').setDepth(72).setAlpha(IDLE_ALPHA + 0.15);

    this.buttons = buttons.map((b) => {
      makeButtonTexture(scene, b.id, b.label, false);
      makeButtonTexture(scene, b.id, b.label, true);
      const [ox, oy] = BTN_POS[b.id];
      const x = BTN_C.x + ox * BTN_GAP;
      const y = BTN_C.y + oy * BTN_GAP;
      const img = scene.add.image(x, y, `tc-btn-${b.id}`).setDepth(72).setAlpha(0.85);
      return { ...b, x, y, img, down: 0 };
    });

    this.parts = [this.base, this.glow, this.knob, ...this.buttons.map((b) => b.img)];
    if (opts.onPause) {
      const pause = scene.add.image(W / 2, 112, 'tc-pause').setDepth(73).setAlpha(0.8)
        .setInteractive(new Phaser.Geom.Circle(28, 28, 30), Phaser.Geom.Circle.Contains);
      pause.on('pointerdown', () => opts.onPause());
      this.parts.push(pause);
    }

    const inp = scene.input;
    inp.on('pointerdown', this.onDown, this);
    inp.on('pointermove', this.onMove, this);
    inp.on('pointerup', this.onUp, this);
    inp.on('pointerupoutside', this.onUp, this);
    const lost = () => this.releaseAll();
    scene.game.events.on('blur', lost);
    scene.events.once('shutdown', () => {
      inp.off('pointerdown', this.onDown, this);
      inp.off('pointermove', this.onMove, this);
      inp.off('pointerup', this.onUp, this);
      inp.off('pointerupoutside', this.onUp, this);
      scene.game.events.off('blur', lost);
    });
  }

  setEnabled(on) {
    this.enabled = on;
    if (!on) this.releaseAll();
    for (const o of this.parts) o.setVisible(on && o !== this.glow);
  }

  onDown(p, over) {
    if (!this.enabled || (over && over.length)) return;
    if (p.x < PAD_ZONE_X && p.y > TOP_SAFE) {
      if (this.stick) return;
      // a base aparece sob o polegar (sem sair da tela nem subir no placar)
      const bx = Phaser.Math.Clamp(p.x, R + 8, PAD_ZONE_X - R);
      const by = Phaser.Math.Clamp(p.y, TOP_SAFE + R, H - R - 6);
      this.stick = { id: p.id, bx, by };
      this.scene.tweens.killTweensOf([this.base, this.knob]);
      this.base.setPosition(bx, by).setAlpha(0.95);
      this.knob.setAlpha(1);
      this.moveStick(p.x, p.y);
      return;
    }
    const b = this.buttonAt(p.x, p.y);
    if (b) this.press(b, p.id);
  }

  onMove(p) {
    if (!this.enabled) return;
    if (this.stick && p.id === this.stick.id) { this.moveStick(p.x, p.y); return; }
    // deslizar o dedo de um botão para outro (como no controle de verdade)
    const cur = this.held.get(p.id);
    if (cur && p.isDown) {
      const b = this.buttonAt(p.x, p.y, BTN_R * 1.05);
      if (b && b !== cur) { this.release(cur, p.id); this.press(b, p.id); }
    }
  }

  onUp(p) {
    if (this.stick && p.id === this.stick.id) this.releaseStick();
    const b = this.held.get(p.id);
    if (b) this.release(b, p.id);
  }

  buttonAt(x, y, reach = BTN_HIT) {
    let best = null;
    let bestD = reach;
    for (const b of this.buttons) {
      const d = Math.hypot(x - b.x, y - b.y);
      if (d < bestD) { best = b; bestD = d; }
    }
    return best;
  }

  press(b, id) {
    this.held.set(id, b);
    if (b.down++ === 0) {
      b.img.setTexture(`tc-btn-${b.id}-on`).setAlpha(1);
      this.scene.tweens.killTweensOf(b.img);
      b.img.setScale(0.9);
      this.scene.tweens.add({ targets: b.img, scale: 0.94, duration: 80 });
      navigator.vibrate?.(8);
      b.press();
    }
  }

  release(b, id) {
    this.held.delete(id);
    b.down = Math.max(0, b.down - 1);
    if (b.down === 0) {
      b.img.setTexture(`tc-btn-${b.id}`).setAlpha(0.85);
      this.scene.tweens.killTweensOf(b.img);
      this.scene.tweens.add({ targets: b.img, scale: 1, duration: 110, ease: 'Back.easeOut' });
      b.release?.();
    }
  }

  moveStick(x, y) {
    const s = this.stick;
    let dx = x - s.bx;
    let dy = y - s.by;
    let dist = Math.hypot(dx, dy);
    if (dist > R) {
      // a base acompanha o dedo que passou da borda
      s.bx += dx * (1 - R / dist);
      s.by += dy * (1 - R / dist);
      s.bx = Phaser.Math.Clamp(s.bx, R + 8, W / 2);
      s.by = Phaser.Math.Clamp(s.by, TOP_SAFE + R, H - R - 6);
      dx = x - s.bx;
      dy = y - s.by;
      dist = Math.hypot(dx, dy);
    }
    const m = Math.min(1, dist / R);
    const k = dist > R ? R / dist : 1;
    this.base.setPosition(s.bx, s.by);
    this.knob.setPosition(s.bx + dx * k, s.by + dy * k);
    const st = this.state;
    if (m < DEAD) {
      st.left = st.right = st.up = st.down = false;
      this.glow.setVisible(false);
      return;
    }
    // 8 direções; a horizontal é mais larga, para andar sem pular ou agachar sem querer
    const ux = dx / dist;
    const uy = dy / dist;
    st.right = ux > 0.42;
    st.left = ux < -0.42;
    st.up = uy < -0.6;
    st.down = uy > 0.55;
    this.glow.setPosition(s.bx, s.by).setRotation(Math.atan2(dy, dx)).setAlpha(0.35 + 0.65 * m).setVisible(true);
  }

  releaseStick() {
    this.stick = null;
    const st = this.state;
    st.left = st.right = st.up = st.down = false;
    this.glow.setVisible(false);
    const tw = this.scene.tweens;
    tw.killTweensOf([this.base, this.knob]);
    tw.add({ targets: this.knob, x: this.base.x, y: this.base.y, duration: 90, ease: 'Quad.easeOut' });
    tw.add({ targets: [this.base, this.knob], x: PAD_HOME.x, y: PAD_HOME.y, delay: 90, duration: 220, ease: 'Quad.easeInOut' });
    tw.add({ targets: this.base, alpha: IDLE_ALPHA, duration: 220 });
    tw.add({ targets: this.knob, alpha: IDLE_ALPHA + 0.15, duration: 220 });
  }

  releaseAll() {
    if (this.stick) this.releaseStick();
    for (const [id, b] of [...this.held]) this.release(b, id);
  }
}
