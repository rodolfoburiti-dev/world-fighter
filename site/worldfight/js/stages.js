import { H, W } from './data.js';

// Linha do chão (onde ficam os pés dos lutadores), igual para todos os cenários.
export const GROUND_Y = 650;

// Cenários com imagem. No Brasil o cenário é do lutador: Lula no Nordeste, Bolsonaro no Rio, Flávio em Brasília.
export const STAGE_IMAGES = ['us', 'br', 'br-lula', 'br-rio', 'ar', 'il', 'py', 'cn', 'kp', 'ru'];
const STAGE_BY_FIGHTER = { lula: 'br-lula', flavio: 'br', bolsonaro: 'br-rio', moraes: 'br' }; // chefe: Praça dos Três Poderes

// Cenário da luta para o lutador "dono da casa".
export const stageFor = (fighter) => STAGE_BY_FIGHTER[fighter.id] || fighter.country;

export function addStage(scene, cc) {
  if (scene.textures.exists(`stage-${cc}`)) {
    return scene.add.image(W / 2, H / 2, `stage-${cc}`).setDisplaySize(W, H).setDepth(0);
  }
  return drawRussiaStage(scene);
}

// Reserva caso uma imagem de cenário não carregue: Praça Vermelha desenhada em código.
function drawRussiaStage(scene) {
  const c = scene.add.container(0, 0).setDepth(0);
  const g = scene.add.graphics();
  c.add(g);
  const horizon = 470;

  g.fillGradientStyle(0x1b2a5c, 0x1b2a5c, 0xd98a6b, 0xd98a6b, 1).fillRect(0, 0, W, horizon);
  // muralha e torres
  g.fillStyle(0x8c2a22, 1).fillRect(0, 380, W, 100);
  g.fillStyle(0x6e1f19, 1);
  for (let x = 0; x < W; x += 44) g.fillRect(x + 6, 364, 24, 18);
  for (const tx of [150, 1130]) {
    g.fillStyle(0x9a3027, 1).fillRect(tx - 40, 250, 80, 150);
    g.fillStyle(0x2f6b3a, 1).fillTriangle(tx - 52, 252, tx + 52, 252, tx, 150);
    g.fillStyle(0xffd84a, 1).fillCircle(tx, 160, 8);
  }
  // catedral de cúpulas
  const domes = [
    { x: 520, h: 210, r: 46, a: 0xd8322a, b: 0xffffff },
    { x: 600, h: 270, r: 54, a: 0x2f8f4a, b: 0xffd84a },
    { x: 690, h: 235, r: 48, a: 0x2f6bd8, b: 0xffffff },
    { x: 770, h: 205, r: 42, a: 0xffd84a, b: 0xd8322a },
  ];
  for (const d of domes) {
    g.fillStyle(0xe8d8c0, 1).fillRect(d.x - 34, 480 - d.h, 68, d.h);
    g.fillStyle(d.a, 1).fillEllipse(d.x, 480 - d.h - d.r * 0.55, d.r * 1.5, d.r * 2);
    g.fillStyle(d.b, 1);
    for (let i = -2; i <= 2; i++) g.fillRect(d.x + i * 12 - 3, 480 - d.h - d.r * 1.45, 6, d.r * 1.8);
    g.fillStyle(0xffd84a, 1).fillCircle(d.x, 480 - d.h - d.r * 1.65, 6);
  }
  // piso de pedra com perspectiva
  g.fillStyle(0x6c6a72, 1).fillRect(0, horizon, W, H - horizon);
  g.lineStyle(2, 0x4d4b54, 0.8);
  for (let i = 0; i < 9; i++) {
    const y = horizon + 8 + Math.pow(i / 8, 1.6) * (H - horizon);
    g.lineBetween(0, y, W, y);
  }
  for (let i = -12; i <= 12; i++) g.lineBetween(W / 2 + i * 28, horizon, W / 2 + i * 150, H);
  g.fillStyle(0xe0b13a, 1).fillRect(0, H - 14, W, 14);
  // bandeiras nos postes
  for (const px of [70, W - 70]) {
    g.fillStyle(0x2b2b33, 1).fillRect(px - 5, 300, 10, 350);
    g.fillStyle(0xffffff, 1).fillRect(px - 38, 310, 76, 24);
    g.fillStyle(0x2f6bd8, 1).fillRect(px - 38, 334, 76, 24);
    g.fillStyle(0xd8322a, 1).fillRect(px - 38, 358, 76, 24);
  }
  // neve
  for (let i = 0; i < 46; i++) {
    const flake = scene.add.circle(Math.random() * W, Math.random() * H, 1.5 + Math.random() * 2, 0xffffff, 0.8);
    c.add(flake);
    scene.tweens.add({
      targets: flake, y: H + 10, x: flake.x + (Math.random() * 80 - 40),
      duration: 4000 + Math.random() * 4000, repeat: -1, delay: Math.random() * 3000,
      onRepeat: () => { flake.y = -10; flake.x = Math.random() * W; },
    });
  }
  return c;
}
