// Testa o motor de luta sem navegador: CPU x CPU em várias sementes.
//   node tools/test_sim.mjs
import { CpuBrain } from '../site/worldfight/js/fight/ai.js';
import { FightSim, HP_MAX, BOUNDS } from '../site/worldfight/js/fight/sim.js';

let problems = 0;
const fail = (msg) => { problems++; console.log('  FALHA:', msg); };

function play(seed, lv0, lv1) {
  const sim = new FightSim({ seed });
  const ais = [new CpuBrain(0, lv0), new CpuBrain(1, lv1)];
  const stats = { frames: 0, rounds: 0, ko: 0, time: 0, draws: 0, hits: 0, blocks: 0, specials: 0, knockdowns: 0, jumps: 0 };
  let guard = 0;
  while (guard++ < 60 * 60 * 12) {
    const events = sim.step([ais[0].next(sim), ais[1].next(sim)]);
    stats.frames++;
    for (const f of sim.fighters) {
      if (![f.x, f.y, f.vx, f.vy, f.hp].every(Number.isFinite)) fail(`número inválido (seed ${seed}) ${JSON.stringify(f)}`);
      if (f.hp < 0 || f.hp > HP_MAX) fail(`hp fora do limite: ${f.hp}`);
      if (f.x < BOUNDS.left - 0.01 || f.x > BOUNDS.right + 0.01) fail(`fora do palco: ${f.x}`);
      if (f.y < -0.01) fail(`abaixo do chão: ${f.y}`);
    }
    for (const e of events) {
      if (e.t === 'hit') { e.blocked ? stats.blocks++ : stats.hits++; if (e.kind === 'sweep') stats.knockdowns++; }
      if (e.t === 'special') stats.specials++;
      if (e.t === 'jump') stats.jumps++;
      if (e.t === 'roundEnd') {
        stats.rounds++;
        if (e.winner < 0) stats.draws++;
        e.reason === 'ko' ? stats.ko++ : stats.time++;
      }
    }
    if (sim.phase === 'ended') {
      const [a, b] = sim.fighters;
      if (a.wins >= 2 || b.wins >= 2) return { ...stats, wins: [a.wins, b.wins] };
      sim.newRound();
    }
  }
  fail(`luta sem fim (seed ${seed})`);
  return { ...stats, wins: [0, 0] };
}

const rows = [];
for (let seed = 1; seed <= 60; seed++) rows.push(play(seed, 0.2 + (seed % 5) * 0.2, 0.2 + ((seed + 2) % 5) * 0.2));
const sum = (k) => rows.reduce((s, r) => s + r[k], 0);
const rounds = sum('rounds');
console.log(`lutas: ${rows.length}  rounds: ${rounds}  (média ${(rounds / rows.length).toFixed(1)} por luta)`);
console.log(`duração média do round: ${(sum('frames') / rounds / 60).toFixed(1)} s`);
console.log(`terminam em KO: ${((100 * sum('ko')) / rounds).toFixed(0)}%   por tempo: ${((100 * sum('time')) / rounds).toFixed(0)}%   empates: ${sum('draws')}`);
console.log(`golpes que acertaram: ${sum('hits')}   defendidos: ${sum('blocks')}   magias: ${sum('specials')}   rasteiras: ${sum('knockdowns')}   pulos: ${sum('jumps')}`);
const p1 = rows.filter((r) => r.wins[0] >= 2).length;
console.log(`vitórias do lado esquerdo: ${p1}/${rows.length}`);

// determinismo: mesma semente => mesmo resultado
const a = JSON.stringify(play(7, 0.5, 0.5));
const b = JSON.stringify(play(7, 0.5, 0.5));
if (a !== b) fail('simulação não determinística');
else console.log('determinismo: ok (mesma semente, mesma luta)');

console.log(problems ? `\n${problems} problema(s)` : '\ntudo certo');
process.exit(problems ? 1 : 0);
