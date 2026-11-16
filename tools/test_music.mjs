// Valida as partituras: tamanho das faixas, notas em faixa audível e instrumentos conhecidos.
//   node tools/test_music.mjs
import { SONGS, midi } from '../site/worldfight/js/music.js';

const INSTRUMENTS = new Set(['flute', 'strings', 'choir', 'chug', 'gtr', 'bass', 'brass', 'accordion', 'erhu', 'clarinet',
  'balalaika', 'koto', 'harp', 'guzheng', 'cavaco', 'oud', 'piano', 'glead', 'synth', 'sub']);
const DRUMS = new Set('kshoctumdexrgw');
let problems = 0;
const fail = (m) => { problems++; console.log('  FALHA:', m); };

for (const [name, song] of Object.entries(SONGS)) {
  const want = song.bars * song.spb;
  const seconds = (song.bars * song.spb * 60) / song.bpm / (song.spb === 12 ? 3 : 4);
  const notesPerTrack = [];
  for (const tr of song.tracks) {
    if (!INSTRUMENTS.has(tr.inst)) fail(`${name}: instrumento desconhecido ${tr.inst}`);
    const toks = tr.notes.trim().split(/\s+/);
    if (toks.length !== want) fail(`${name}/${tr.inst}: ${toks.length} passos (esperado ${want})`);
    const nums = toks.filter((t) => t !== '-' && t !== '.').map(midi);
    if (nums.some((n) => n < 24 || n > 108)) fail(`${name}/${tr.inst}: nota fora de 24-108: ${nums.filter((n) => n < 24 || n > 108)}`);
    if (!nums.length && !toks.every((t) => t === '-' || t === '.')) fail(`${name}/${tr.inst}: sem notas numéricas`);
    notesPerTrack.push(`${tr.inst}:${nums.length ? Math.min(...nums) + '-' + Math.max(...nums) : '—'}`);
  }
  const drums = song.drums.trim().split(/\s+/);
  if (drums.length !== want) fail(`${name}/bateria: ${drums.length} passos (esperado ${want})`);
  for (const tok of drums) for (const ch of tok) if (tok !== '-' && !DRUMS.has(ch)) fail(`${name}: peça de bateria desconhecida "${ch}"`);
  console.log(`${name.padEnd(9)} ${String(song.bpm).padStart(3)} bpm  ${String(song.bars).padStart(2)} compassos  ${seconds.toFixed(1).padStart(5)} s  ${notesPerTrack.join('  ')}`);
}
console.log(problems ? `\n${problems} problema(s)` : '\npartituras ok');
process.exit(problems ? 1 : 0);
