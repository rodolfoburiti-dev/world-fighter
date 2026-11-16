// Partituras do World Fighter. Todas as músicas são originais, escritas para este jogo.
// Formato de uma música: { bpm, bars, spb, tracks: [{ inst, notes, vol }], drums }.
//   spb = passos (semicolcheias) por compasso: 16 em 4/4, 12 em 6/8.
//   notes = um token por passo: número MIDI, "." sustenta a nota anterior, "-" é pausa.
//   drums = um token por passo; cada letra é uma peça (k bumbo, s caixa, h chimbal, o chimbal aberto,
//           c prato, t taiko/tímpano, u surdo, m tamborim, d darbuka grave, e darbuka agudo,
//           x palma, r caixa leve, g gongo, w torcida).

export function midi(name) {
  if (/^\d+$/.test(name)) return Number(name);
  const m = /^([A-G])(#|b)?(-?\d)$/.exec(name);
  const base = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 }[m[1]];
  const acc = m[2] === '#' ? 1 : m[2] === 'b' ? -1 : 0;
  return 12 * (Number(m[3]) + 1) + base + acc;
}

export function parseTrack(text) {
  const byStep = new Map();
  let current = null;
  text.trim().split(/\s+/).forEach((tok, step) => {
    if (tok === '.') { if (current) current.len++; return; }
    current = null;
    if (tok === '-') return;
    current = { note: midi(tok), len: 1 };
    byStep.set(step, [...(byStep.get(step) || []), current]);
  });
  return byStep;
}

export function parseDrums(text) {
  const byStep = new Map();
  text.trim().split(/\s+/).forEach((tok, step) => {
    if (tok !== '-' && tok !== '.') byStep.set(step, tok.split(''));
  });
  return byStep;
}

// ---- ajudantes de composição -----------------------------------------------------
const MODES = {
  major: [0, 2, 4, 5, 7, 9, 11],
  minor: [0, 2, 3, 5, 7, 8, 10],
  harmMinor: [0, 2, 3, 5, 7, 8, 11],
  phrygDom: [0, 1, 4, 5, 7, 8, 10], // "freygish": escala típica do klezmer
};

const degreeNote = (keyMidi, scale, d, oct) => {
  const i = d - 1;
  return keyMidi + scale[((i % 7) + 7) % 7] + 12 * (Math.floor(i / 7) + oct);
};

// Compositor: monta as trilhas a partir da harmonia (graus por compasso) e de padrões simples.
// Forma de luta (16 compassos): parte A (a progressão uma vez) e parte B (de novo, mais pesada:
// guitarra distorcida dobra a melodia, bateria dobrada, prato na entrada), com virada de bateria
// a cada 4 compassos. Partes: line.part = 'A' | 'B' | 'AB' (padrão).
function build(spec) {
  const { bpm, key, mode, prog: half, melody, bass, pad, lines = [], spb = 16 } = spec;
  const prog = [...half, ...half];
  const bars = prog.length;
  const n = half.length;
  const scale = MODES[mode];
  const keyMidi = midi(`${key}0`);
  const tones = (root) => [root, root + 2, root + 4, root + 7, root + 9, root + 11];
  const tracks = [];
  const rest = (k) => Array(k * spb).fill('-');

  // melodia: graus com ' (oitava acima) e , (abaixo); res = quantos passos cada token dura
  const res = melody.res || 2;
  const melodyBars = (oct) => {
    const out = [];
    melody.bars.forEach((bar) => {
      const toks = bar.trim().split(/\s+/);
      if (toks.length * res !== spb) throw new Error(`melodia com ${toks.length} tokens (esperado ${spb / res}): ${bar}`);
      for (const tok of toks) {
        if (tok === '.' || tok === '-') { for (let k = 0; k < res; k++) out.push(tok); continue; }
        const m = /^(\d)('*)(,*)$/.exec(tok);
        if (!m) throw new Error(`token de melodia inválido: ${tok}`);
        out.push(degreeNote(keyMidi, scale, Number(m[1]), oct + m[2].length - m[3].length));
        for (let k = 1; k < res; k++) out.push('.');
      }
    });
    return out;
  };
  const lead = melodyBars(melody.oct);
  tracks.push({ inst: melody.inst, notes: [...lead, ...lead].join(' '), vol: melody.vol ?? 1 });
  // parte B: guitarra distorcida dobra a melodia uma oitava abaixo
  tracks.push({ inst: spec.double || 'glead', notes: [...rest(n), ...melodyBars(melody.oct - 1)].join(' '), vol: spec.doubleVol ?? 0.9 });

  // acompanhamentos por padrão: dígito = nota do acorde (0 fundamental, 1 terça, 2 quinta, 3 oitava...)
  const fromPattern = (pat, oct, voiceTone, part = 'AB') => prog.map((root, i) => {
    const inB = i >= n;
    if ((part === 'A' && inB) || (part === 'B' && !inB)) return rest(1).join(' ');
    const t = tones(root);
    const toks = pat.trim().split(/\s+/);
    if (toks.length !== spb) throw new Error(`padrão com ${toks.length} passos (esperado ${spb}): ${pat}`);
    return toks.map((tok) => {
      if (tok === '.' || tok === '-') return tok;
      const idx = tok === 'x' ? voiceTone : Number(tok);
      return degreeNote(keyMidi, scale, t[idx], oct);
    }).join(' ');
  }).join(' ');

  tracks.push({ inst: bass.inst || 'bass', notes: fromPattern(bass.pat, bass.oct ?? 2, 0), vol: bass.vol ?? 1 });
  if (pad) {
    const hold = ['x', ...Array(spb - 1).fill('.')].join(' ');
    for (let v = 0; v < 3; v++) tracks.push({ inst: pad.inst, notes: fromPattern(pad.pat === 'hold' ? hold : pad.pat, pad.oct ?? 3, v, pad.part), vol: pad.vol ?? 1 });
  }
  for (const line of lines) {
    const voices = line.voices || 1;
    for (let v = 0; v < voices; v++) tracks.push({ inst: line.inst, notes: fromPattern(line.pat, line.oct ?? 3, v, line.part), vol: line.vol ?? 1 });
  }

  // bateria: A, B (com prato no primeiro tempo da parte B) e virada no 4º compasso de cada bloco
  const pick = (p, i) => (Array.isArray(p) ? p[i % p.length] : p);
  const drumBars = prog.map((_, i) => {
    if (spec.fill && i % 4 === 3) return spec.fill;
    let bar = i < n ? pick(spec.drumsA, i) : pick(spec.drumsB, i - n);
    if (i === n || i === 0) bar = bar.replace(/^(\S+)/, (m) => (m.includes('c') ? m : `${m === '-' ? '' : m}c`) + (i === n && spec.crowd ? 'w' : ''));
    return bar;
  });
  const gain = spec.gain ?? 1; // equilibra o volume de uma música em relação às outras
  for (const tr of tracks) tr.vol = (tr.vol ?? 1) * gain;
  return { bpm, bars, spb, tracks, drums: drumBars.join(' ') };
}

// ---- abertura e seleção (rock com sabor japonês) --------------------------------------------
const PAD_REST = Array(15).fill('.').join(' ');
const REST_BAR = Array(16).fill('-').join(' ');
const TRIADS = {
  Em: ['E3', 'G3', 'B3'], C: ['C3', 'E3', 'G3'], D: ['D3', 'F#3', 'A3'], B: ['B2', 'D#3', 'F#3'],
  Am: ['A2', 'C3', 'E3'], F: ['F2', 'A2', 'C3'], G: ['G2', 'B2', 'D3'], Dm: ['D3', 'F3', 'A3'], E: ['E3', 'G#3', 'B3'],
};
const GTR_ROOT = { Em: 'E2', C: 'C3', D: 'D3', B: 'B2', Am: 'A2', F: 'F2', G: 'G2', Dm: 'D3', E: 'E2' };
const BASS_ROOT = { Em: 'E2', C: 'C2', D: 'D2', B: 'B1', Am: 'A1', F: 'F1', G: 'G1', Dm: 'D2', E: 'E2' };
const hold = (n) => `${n} ${PAD_REST}`;
const padVoice = (chords, v) => chords.map((c) => hold(TRIADS[c][v])).join(' ');
const chugBar = (r) => `${r} - ${r} - ${r} ${r} - ${r} ${r} - ${r} - ${r} ${r} - ${r}`;
const bassBar = (r) => Array(8).fill(`${r} -`).join(' ');
const kotoBar = (c) => {
  const [a, b, d] = TRIADS[c].map(midi);
  return [a + 12, b + 12, d + 12, a + 24, d + 12, b + 12, a + 12, d, a + 12, b + 12, d + 12, b + 24, d + 12, b + 12, a + 12, b].join(' ');
};
const onBars = (chords, active, fn) => chords.map((c, i) => (active(i) ? fn(c, i) : REST_BAR)).join(' ');

const TITLE_CHORDS = ['Em', 'Em', 'C', 'D', 'Em', 'Em', 'C', 'B', 'Am', 'Am', 'C', 'D', 'Em', 'C', 'D', 'B'];
const TITLE = {
  bpm: 150,
  bars: 16,
  spb: 16,
  tracks: [
    {
      inst: 'flute',
      notes: [
        'E5 . . . . . . . . . . . D5 . E5 .', 'B4 . . . . . . . . . . . . . . -',
        'C5 . . . . . . . B4 . . . A4 . . .', 'B4 . . . . . . . A4 . . . . . . .',
        'E5 . . . G5 . . . F#5 . E5 . B4 . . .', 'D5 . E5 . . . . . . . . . B4 . D5 .',
        'E5 . . . G5 . A5 . G5 . . . E5 . . .', 'F#5 . . . . . . . D#5 . . . B4 . . .',
        'A4 . C5 . E5 . . . D5 . C5 . B4 . A4 .', 'C5 . . . . . B4 . A4 . . . . . . .',
        'G4 . A4 . C5 . . . E5 . . . D5 . C5 .', 'D5 . . . . . . . F#5 . . . A5 . . .',
        'B5 . . . . . A5 . G5 . . . E5 . . .', 'G5 . . . . . E5 . C5 . . . E5 . G5 .',
        'A5 . . . . . F#5 . D5 . . . F#5 . A5 .', 'B5 . . . . . . . . . . . D#5 . F#5 .',
      ].join(' '),
    },
    ...[0, 1, 2].map((v) => ({ inst: 'strings', notes: padVoice(TITLE_CHORDS, v) })),
    { inst: 'chug', notes: onBars(TITLE_CHORDS, (i) => i >= 4, (c) => chugBar(GTR_ROOT[c])) },
    { inst: 'gtr', notes: onBars(TITLE_CHORDS, (i) => i === 3 || i >= 12, (c) => hold(GTR_ROOT[c])) },
    { inst: 'bass', notes: onBars(TITLE_CHORDS, () => true, (c, i) => (i < 4 ? hold(BASS_ROOT[c]) : bassBar(BASS_ROOT[c]))) },
  ],
  drums: [
    't - - - - - - - t - - - - - - -', 't - - - - - - - t - - - t - - -',
    't - - - - - - - t - - - - - - -', 't - - - t - - - t - t - t t t t',
    ...Array.from({ length: 12 }, (_, i) => (i % 4 === 0 ? 'kct - h - s - h - k k h - s - h h' : 'k - h - s - h - k k h - s - h h')),
  ].join(' '),
};

const SELECT_CHORDS = ['Am', 'Am', 'F', 'G', 'Am', 'Am', 'Dm', 'E'];
const SELECT = {
  bpm: 140,
  bars: 8,
  spb: 16,
  tracks: [
    {
      inst: 'flute',
      notes: [
        'A4 . . . C5 . . . E5 . . . D5 . C5 .', 'E5 . . . . . . . . . . . - - - -',
        'F5 . . . E5 . . . C5 . . . A4 . . .', 'G4 . . . B4 . . . D5 . . . . . . .',
        'A5 . . . G5 . E5 . . . D5 . E5 . . .', 'C5 . . . . . . . A4 . . . . . . .',
        'D5 . . . F5 . A5 . . . G5 . F5 . . .', 'E5 . . . . . . . G#4 . . . B4 . . .',
      ].join(' '),
    },
    ...[0, 1, 2].map((v) => ({ inst: 'strings', notes: padVoice(SELECT_CHORDS, v) })),
    { inst: 'chug', notes: onBars(SELECT_CHORDS, () => true, (c) => chugBar(GTR_ROOT[c])) },
    { inst: 'gtr', notes: onBars(SELECT_CHORDS, (i) => i === 7, (c) => hold(GTR_ROOT[c])) },
    { inst: 'bass', notes: onBars(SELECT_CHORDS, () => true, (c) => bassBar(BASS_ROOT[c])) },
    { inst: 'koto', notes: SELECT_CHORDS.map(kotoBar).join(' ') },
  ],
  drums: Array.from({ length: 8 }, (_, i) => (i % 4 === 0
    ? 'kct - h - s - h k - k h - s - h h'
    : i === 7 ? 'k - h - s - h k - k s - s s s s' : 'k - h - s - h k - k h - s - h h')).join(' '),
};

// ---- um tema de luta para cada país (tocam no cenário do país do adversário) --------------------
// Baterias comuns (16 passos): A = rock pulsante, B = dobrado, FILL = virada de caixa.
const ROCK_A = 'k - h - s - h - k - h k s - h h';
const ROCK_B = 'k h h h s h k h k h k h s h h h';
const FILL = 'k - h - s - h - s s s s s s s s';

// Brasil: três temas originais com clima de comício, um para cada lutador brasileiro. Todos com
// base de luta: bumbo e caixa marcando forte, guitarra pesada desde o início e andamento acima de 150.
const BR_LULA = build({
  // lambadão de luta: teclado na melodia, guitarra dedilhada ligeira, baixo em oitavas,
  // bumbo em todos os tempos e palma no contratempo, guitarra pesada por baixo. Ré maior.
  gain: 1.75, bpm: 168, key: 'D', mode: 'major', prog: [1, 4, 5, 1, 6, 4, 5, 1], crowd: true,
  melody: {
    inst: 'synth', oct: 4, vol: 1.2,
    bars: ['3 5 1\' 5 3\' . 2\' 1\'', '1\' 6 4 6 1\' . 2\' 1\'', '2\' 7 5 7 2\' . 4\' 2\'', '3\' . 1\' . 5 . - -',
      '3\' 1\' 6 1\' 3\' . 4\' 3\'', '4\' 1\' 6 1\' 4\' . 3\' 1\'', '2\' 5 7 2\' 5\' . 4\' 2\'', '1\' . 3\' . 1\' . - -'],
  },
  bass: { pat: '0 - 3 - 0 - 3 - 0 - 3 - 0 - 3 -' },
  pad: { inst: 'accordion', pat: 'x - - x - - x - x - - x - - x -', vol: 0.35 },
  lines: [
    { inst: 'cavaco', pat: '0 1 2 3 2 1 2 3 0 1 2 3 2 1 2 3', vol: 0.85 },
    { inst: 'chug', oct: 2, pat: '0 - 0 - 0 - 0 - 0 - 0 - 0 - 0 -', vol: 0.75 },
  ],
  drumsA: 'k h x h s h x h k h x h s h x h',
  drumsB: 'k m x h s m x h k m x h s m x m',
  fill: 'k - x - s - x - s s s s s s s s',
});

const BR_BOLSONARO = build({
  // piseiro de luta: sanfona de teclado na melodia, grave sintético pulando, bumbo reto e caixa
  // no 2 e no 4, guitarra pesada em colcheias. Sol maior.
  gain: 1.15, bpm: 158, key: 'G', mode: 'major', prog: [1, 5, 6, 4, 1, 5, 4, 5], crowd: true,
  melody: {
    inst: 'accordion', oct: 3, vol: 1.2,
    bars: ['5 . 3 . 5 1\' . -', '7 . 5 . 7 2\' . -', '1\' . 6 . 1\' 3\' . 2\'', '1\' . 6 4 6 . - -',
      '3\' . 2\' 1\' 5 . 1\' 3\'', '2\' . 7 5 7 . 2\' 5\'', '4\' . 3\' 1\' 6 . 1\' 4\'', '2\' . . . 5 . - -'],
  },
  bass: { inst: 'sub', oct: 1, pat: '0 - - 2 - - 0 - 0 - - 2 - - 0 -' },
  lines: [
    { inst: 'synth', pat: '- - x - - - x - - - x - - - x -', voices: 3, vol: 0.4 },
    { inst: 'chug', oct: 2, pat: '0 - 0 - 0 - 0 - 0 - 0 - 0 - 0 -', vol: 0.8 },
  ],
  drumsA: 'k - h - ks - h - k - h - ks - h h',
  drumsB: 'k h h h ks h h h k h h h ks h ks h',
  fill: FILL,
});

const BR_FLAVIO = build({
  // brega funk de paredão em ritmo de luta: batida sincopada com palma, grave de 808,
  // sintetizador em stabs e guitarra pesada. Si menor.
  gain: 1.15, bpm: 152, key: 'B', mode: 'minor', prog: [1, 1, 6, 7, 1, 1, 6, 5], crowd: true, double: 'glead', doubleVol: 0.75,
  melody: {
    inst: 'synth', oct: 3, vol: 1.15,
    bars: ['1\' - 1\' - 3\' - 1\' -', '5 - 7 1\' - 7 5 -', '6 - 1\' - 3\' - 1\' 6', '7 - 2\' - 4\' . . -',
      '5\' - 4\' 3\' 1\' - 3\' -', '5 - 7 - 1\' . . -', '3\' - 1\' 6 1\' - 3\' -', '2\' - 7 - 5 . . -'],
  },
  bass: { inst: 'sub', oct: 1, pat: '0 - - 0 - - 0 - - 0 - - 0 - 2 -' },
  lines: [
    { inst: 'synth', oct: 3, pat: '- 1 - - 2 - - 1 - 1 - - 2 - 1 -', vol: 0.45 },
    { inst: 'chug', oct: 2, pat: '0 - - 0 - - 0 - - 0 - - 0 - 0 -', vol: 0.8 },
  ],
  drumsA: 'k - h k - h xs h - k h - xs - k h',
  drumsB: 'k h h k x h xs h k k h h xs h k x',
  fill: 'k - x k - x s s s s s s s s s s',
});

export const SONGS = {
  title: TITLE,
  select: SELECT,

  'stage-br': BR_LULA,
  'stage-br-lula': BR_LULA,
  'stage-br-bolsonaro': BR_BOLSONARO,
  'stage-br-flavio': BR_FLAVIO,

  // Argentina: tango-rock. Bandoneon, piano em stabs, guitarra pesada na parte B. Ré menor harmônico.
  'stage-ar': build({
    gain: 1.2, bpm: 150, key: 'D', mode: 'harmMinor', prog: [1, 4, 5, 1, 4, 1, 5, 1],
    melody: {
      inst: 'accordion', oct: 4, vol: 1.2,
      bars: ['5 . . 3 1 . 3 5', '6 . . 5 4 . 6 1\'', '7 . . 2\' 7 . 5 7', '1\' . . 5 3 . 1 3',
        '6 . 4 6 1\' . 6 4', '5 . 3 5 1\' . 7 1\'', '2\' . 7 6 5 . 7 2\'', '1\' . . . 1 . . .'],
    },
    bass: { pat: '0 - - 0 2 - - - 0 - - 0 2 - 2 -' },
    pad: { inst: 'piano', pat: 'x - - . x - - . x - - . x - x .', vol: 0.75 },
    lines: [{ inst: 'chug', oct: 2, pat: '0 - - 0 - - 0 - 0 - - 0 - 0 0 -', }],
    drumsA: 'k - h x s - x h k - h x s - x x',
    drumsB: 'k h h x k h x h k h h x k h x x',
    fill: FILL,
  }),

  // EUA: rock de arena. Metais em fanfarra, guitarra em power chords, caixa marcial. Mi maior.
  'stage-us': build({
    gain: 1.2, bpm: 160, key: 'E', mode: 'major', prog: [1, 1, 4, 5, 6, 4, 5, 5],
    melody: {
      inst: 'brass', oct: 4, vol: 1.1,
      bars: ['5 . . 1\' 3\' . 5\' 3\'', '2\' . 1\' 7 5 . 3 5', '4\' . 3\' 1\' 6 . 1\' 3\'', '2\' . 7 5 7 . 2\' 4\'',
        '3\' . . 1\' 6 . 1\' 3\'', '4\' . 3\' 1\' 6 . 4 6', '5 . 7 2\' 5\' . 4\' 2\'', '5\' . . . 7 . 2\' .'],
    },
    bass: { pat: '0 - 0 - 0 - 0 - 0 - 0 - 0 - 0 -' },
    pad: { inst: 'strings', pat: 'hold', vol: 0.6 },
    lines: [{ inst: 'chug', oct: 2, pat: '0 - 0 - 0 - 0 - 0 - 0 - 0 - 0 -' }],
    drumsA: ROCK_A,
    drumsB: ROCK_B,
    fill: FILL,
  }),

  // Paraguai: polca paraguaia acelerada em 6/8, harpa e violão sobre bateria de rock. Ré maior.
  'stage-py': build({
    gain: 1.5, bpm: 156, key: 'D', mode: 'major', spb: 12, prog: [1, 1, 5, 5, 1, 4, 5, 1],
    melody: {
      inst: 'harp', oct: 4, vol: 1.25,
      bars: ['3 5 1\' 3\' 1\' 5', '3\' 1\' 5 3 5 1\'', '7 2\' 5\' 4\' 2\' 7', '5 7 2\' 7 5 .', '1\' 3\' 5\' 3\' 1\' 5', '6 4 6 1\' 6 4',
        '5 7 2\' 7 5 7', '1\' 5 3 5 1\' .'],
    },
    bass: { pat: '0 - - 2 - - 0 - - 2 - -' },
    lines: [
      { inst: 'harp', pat: '0 - 1 - 2 - 3 - 2 - 1 -', vol: 0.55 },
      { inst: 'cavaco', pat: '1 - 2 - 3 - 1 - 2 - 3 -', vol: 0.7 },
      { inst: 'chug', oct: 2, pat: '0 - 0 0 - 0 0 - 0 0 - 0', vol: 0.8 },
    ],
    drumsA: 'k - h s - h k h h s - h',
    drumsB: 'k h h s h h k h k s h s',
    fill: 'k - s s - s s s s s s s',
  }),

  // China: erhu e guzheng sobre taiko, gongo e bateria de rock. Ré maior (pentatônica).
  'stage-cn': build({
    gain: 1.05, bpm: 150, key: 'D', mode: 'major', prog: [1, 6, 4, 5, 1, 6, 4, 5],
    melody: {
      inst: 'erhu', oct: 4, vol: 1.2,
      bars: ['5 . 6 5 3 . 2 3', '6 . 5 3 2 . 3 5', '6 . 1\' 6 5 . 3 5', '5 . 6 . 5 . 3 2',
        '3 . 5 6 1\' . 6 5', '6 . 1\' 2\' 3\' . 2\' 1\'', '6 . 5 3 2 . 3 5', '6 . 5 . 3 . 2 .'],
    },
    bass: { pat: '0 - 0 - 0 - 0 - 0 - 0 - 2 - 2 -' },
    pad: { inst: 'strings', pat: 'hold', vol: 0.5 },
    lines: [
      { inst: 'guzheng', pat: '0 1 2 4 3 2 1 2 0 1 2 4 3 2 1 2', vol: 0.8 },
      { inst: 'chug', oct: 2, pat: '0 - 0 - 0 0 - 0 0 - 0 - 0 0 - 0', vol: 0.85 },
    ],
    drumsA: ['ktg - h - s - h - kt - h t s - h h', 'kt - h - s - h - kt - h t s - h h'],
    drumsB: 'kt h h h s h k h kt h k h s h h h',
    fill: 't - t - s - t t s s s s t t t t',
  }),

  // Rússia: balalaica veloz, coro grave e guitarra pesada. Lá menor harmônico.
  'stage-ru': build({
    gain: 1.2, bpm: 160, key: 'A', mode: 'harmMinor', prog: [1, 4, 5, 1, 1, 4, 5, 1],
    melody: {
      inst: 'balalaika', oct: 3, vol: 1.15,
      bars: ['1\' . 7 1\' 3\' . 1\' 5', '6 . 4 6 1\' . 6 4', '7 . 5 7 2\' . 7 5', '1\' . 3\' 5\' 3\' . 1\' 7',
        '3\' . 3\' 2\' 1\' . 7 1\'', '4\' . 6\' 4\' 6 . 4 6', '7 . 7 1\' 2\' . 3\' 2\'', '1\' . . 7 1\' . . .'],
    },
    bass: { pat: '0 - 0 - 2 - 0 - 0 - 0 - 2 - 0 -' },
    pad: { inst: 'choir', pat: 'hold', vol: 0.9 },
    lines: [{ inst: 'chug', oct: 2, pat: '0 - - 0 - - 0 - 0 - - 0 - - 0 -' }],
    drumsA: 'k - h - s - h k k - h - s - h h',
    drumsB: 'k h k h s h k h k h k h s h s s',
    fill: FILL,
  }),

  // Israel: clarinete de klezmer, oud e darbuka sobre bateria de rock. Mi frígio dominante.
  'stage-il': build({
    gain: 1.35, bpm: 158, key: 'E', mode: 'phrygDom', prog: [1, 2, 1, 2, 1, 4, 2, 1],
    melody: {
      inst: 'clarinet', oct: 4, vol: 1.15,
      bars: ['5 . 3 5 1\' . 2\' 1\'', '6 . 4 6 2\' . 1\' 2\'', '3\' . 2\' 1\' 5 . 3 5', '6 . 4 2 4 . 6 2\'',
        '5\' . 3\' 1\' 3\' . 5 3', '4\' . 6\' 4\' 1\' . 6 4', '2\' . 1\' 7 6 . 4 6', '5 . 3 . 1 . . .'],
    },
    bass: { inst: 'bass', pat: '0 - - 0 - 0 - - 2 - - 0 - 0 - -' },
    pad: { inst: 'strings', pat: 'hold', vol: 0.5 },
    lines: [
      { inst: 'oud', pat: '- - 1 - - 2 - - 1 - - 2 - 1 - -', vol: 0.8 },
      { inst: 'chug', oct: 2, pat: '0 - - 0 - 0 - - 0 - - 0 - 0 - -', vol: 0.85 },
    ],
    drumsA: 'kd h e h sd h e e kd h e h sd h e e',
    drumsB: 'kd h e h sd h e e kd h e h sd h e e',
    fill: 'kd - e - s - e e s s s s s s s s',
  }),

  // Coreia do Norte: marcha militar acelerada. Metais, cordas, caixa, tímpano e guitarra. Sol maior.
  'stage-kp': build({
    gain: 1.15, bpm: 150, key: 'G', mode: 'major', prog: [1, 1, 4, 5, 1, 4, 5, 1],
    melody: {
      inst: 'brass', oct: 3, vol: 1.1,
      bars: ['5 . 1\' . 3\' . 1\' 5', '5\' . 3\' . 1\' . 5 .', '6\' . 4\' . 1\' . 4\' .', '5\' . 2\' . 7 . 2\' 5\'',
        '1\'\' . 5\' . 3\' . 5\' .', '6\' . 4\' . 6\' . 1\'\' .', '2\' . 5\' . 7 . 2\' .', '1\' . . 5 1\' . . .'],
    },
    bass: { pat: '0 - 2 - 0 - 2 - 0 - 2 - 0 - 2 -' },
    pad: { inst: 'strings', pat: 'hold', vol: 0.7 },
    lines: [
      { inst: 'brass', pat: '- - x - - - x - - - x - - - x -', voices: 3, vol: 0.4 },
      { inst: 'chug', oct: 2, pat: '0 - 0 - 0 - 0 - 0 - 0 - 0 - 0 -', vol: 0.85 },
    ],
    drumsA: 'kt - r r s - r r kt - r r s - r s',
    drumsB: 'kt r h r s r h r kt r h r s r s s',
    fill: 't - r r s - s s s s s s s s s s',
  }),
};
