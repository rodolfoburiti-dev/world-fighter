// Elenco e países. A ordem segue a grade 5x2 da tela de seleção.
export const FIGHTERS = [
  { id: 'lula', name: 'MOLUSCULO', country: 'br', winVoice: true }, // vitória: "Faz o L, meu filho!" (voice/win-lula.mp3)
  { id: 'milei', name: 'MILEÃO', country: 'ar' },
  { id: 'trump', name: 'TRUMPETE', country: 'us', winVoice: true, winLoop: 1, winFps: 5 }, // vitória: a dancinha (quadros 1+ em loop), "Eu sou o dono do mundo, man!"
  { id: 'pena', name: 'PEÑITA', country: 'py' },
  { id: 'xi', name: 'XI PING PONG', country: 'cn' },
  { id: 'putin', name: 'CZAR VLAD', country: 'ru' },
  { id: 'netanyahu', name: 'BIBIZÃO', country: 'il', size: 0.92, winVoice: true }, // 8% menor (desenhado agachado e corpulento); vitória: soco para o alto, "Que Deus proteja Israel"
  { id: 'kim', name: 'KIM JONG BUM', country: 'kp', winVoice: true, winLoop: 1, winFps: 5 }, // vitória: dancinha (loop), "Um botão nuclear está sempre na minha mesa"
  { id: 'flavio', name: 'BLOZINHO', country: 'br', winVoice: true }, // vitória: pose de sentido, "Sou o presidente do Brasil" (voice/win-flavio.mp3)
  { id: 'bolsonaro', name: 'BLOZO', country: 'br', winVoice: true }, // vitória: rasga a camiseta e grita (voice/win-bolsonaro.mp3)
];

// Chefe final do Arcade: só aparece depois de vencer os outros nove (não está na grade de seleção).
// Entra voando com a toga, joga a toga fora e cai no chão; bate mais forte (power) e aguenta mais (armor).
export const BOSS = { id: 'moraes', name: 'XANDÃO', country: 'br', boss: true, power: 1.35, armor: 0.75, winVoice: true };
export const ALL_FIGHTERS = [...FIGHTERS, BOSS];

// Quem zera o jogo (vence o chefe no Arcade) libera o Xandão para jogar; fica guardado no navegador.
const UNLOCK_KEY = 'wf-xandao';
export function bossUnlocked() {
  try { return localStorage.getItem(UNLOCK_KEY) === '1'; } catch (e) { return false; }
}
export function unlockBoss() {
  try { localStorage.setItem(UNLOCK_KEY, '1'); } catch (e) { /* navegador sem armazenamento */ }
}
// lutadores da tela de seleção: os 10, mais o Xandão depois de desbloqueado
export const roster = () => (bossUnlocked() ? ALL_FIGHTERS : FIGHTERS);

// x/y = pino vermelho no mapa original (1774x887).
export const COUNTRIES = {
  br: { name: 'BRASIL', x: 594, y: 590 },
  ar: { name: 'ARGENTINA', x: 539, y: 710 },
  us: { name: 'EUA', x: 447, y: 272 },
  py: { name: 'PARAGUAI', x: 654, y: 631 },
  cn: { name: 'CHINA', x: 1361, y: 282 },
  ru: { name: 'RÚSSIA', x: 1187, y: 177 },
  il: { name: 'ISRAEL', x: 1033, y: 342 },
  kp: { name: 'COREIA DO NORTE', x: 1529, y: 291 },
};
export const MAP_SRC_W = 1774;

// Cores do golpe especial (bola de energia) de cada país: núcleo e brilho.
export const ORB = {
  br: [0xffe14a, 0x2bb54a], ar: [0xffffff, 0x6fc5ff], us: [0xffffff, 0xff3b3b], py: [0xffffff, 0x3b6bff],
  cn: [0xffe14a, 0xff3030], ru: [0xffffff, 0x3b6bff], il: [0xffffff, 0x3b8bff], kp: [0xffffff, 0xff3b3b],
};

export const FONT = 'PressStart';
export const W = 1280;
export const H = 720;

// Estilo de texto "arcade": amarelo com contorno grosso, como nos letreiros de luta.
export function arcadeText(size, color = '#ffd63a', extra = {}) {
  return {
    fontFamily: FONT,
    fontSize: `${size}px`,
    color,
    stroke: '#3a0a00',
    strokeThickness: Math.max(4, Math.round(size / 4)),
    shadow: { offsetX: 0, offsetY: Math.max(2, Math.round(size / 8)), color: '#000', blur: 0, fill: true, stroke: true },
    ...extra,
  };
}
