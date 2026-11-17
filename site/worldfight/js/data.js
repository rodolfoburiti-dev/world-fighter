// Elenco e países. A ordem segue a grade 5x2 da tela de seleção.
export const FIGHTERS = [
  { id: 'lula', name: 'MOLUSCULO', country: 'br', winVoice: true }, // vitória: "Faz o L, meu filho!" (voice/win-lula.mp3)
  { id: 'milei', name: 'MILEÃO', country: 'ar' },
  { id: 'trump', name: 'TRUMPETE', country: 'us' },
  { id: 'pena', name: 'PEÑITA', country: 'py' },
  { id: 'xi', name: 'XI PING PONG', country: 'cn' },
  { id: 'putin', name: 'CZAR VLAD', country: 'ru' },
  { id: 'netanyahu', name: 'BIBIZÃO', country: 'il' },
  { id: 'kim', name: 'KIM JONG BUM', country: 'kp' },
  { id: 'flavio', name: 'BLOZINHO', country: 'br' },
  { id: 'bolsonaro', name: 'BLOZO', country: 'br' },
];

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
