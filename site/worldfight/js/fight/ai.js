// IA do CPU: lê o estado da simulação e devolve botões, como se fosse um jogador.
// Usa só sim.rand() (com semente), então a luta continua determinística.

import { ATTACKS, NEUTRAL } from './sim.js';

// level: 0 (fácil) a 1 (difícil)
export class CpuBrain {
  constructor(index, level = 0.3) {
    this.index = index;
    this.level = level;
    this.hold = { ...NEUTRAL };
    this.until = 0;
  }

  // devolve o input deste frame: botões de direção mantidos; punch/kick só no frame em que são decididos
  think(sim) {
    const me = sim.fighters[this.index];
    const foe = sim.fighters[1 - this.index];
    const frame = sim.frame;
    const L = this.level;
    const out = { ...this.hold, punch: false, kick: false };

    // reação à ameaça: defende se o oponente está atacando perto
    const dist = Math.abs(foe.x - me.x);
    const foeAttacking = foe.state === 'attack' && foe.atk && !ATTACKS[foe.atk.kind].projectile;
    const incoming = sim.projectiles.some((p) => p.owner !== this.index && Math.abs(p.x - me.x) < 300 && Math.sign(p.vx) === Math.sign(me.x - p.x));
    if (me.state === 'idle' || me.state === 'walk' || me.state === 'crouch' || me.state === 'blockstun') {
      if ((foeAttacking && dist < 270 && sim.rand() < 0.12 + 0.38 * L) || (incoming && sim.rand() < 0.2 + 0.4 * L)) {
        const block = { ...NEUTRAL, block: true, down: foe.atk && ATTACKS[foe.atk.kind].low };
        this.hold = block;
        this.until = frame + 8 + Math.floor(sim.rand() * 6);
        return { ...block };
      }
    }

    if (frame < this.until) return out;

    // nova decisão a cada 10-25 frames (mais rápido quanto mais difícil)
    const wait = Math.round(26 - 14 * L + sim.rand() * 8);
    this.until = frame + wait;
    const toward = foe.x > me.x ? 'right' : 'left';
    const away = toward === 'right' ? 'left' : 'right';
    const next = { ...NEUTRAL };
    const roll = sim.rand();

    if (me.state === 'jump' || me.y > 0) { this.hold = next; return { ...next, punch: sim.rand() < 0.5, kick: sim.rand() < 0.3 }; }
    if (me.state === 'hit' || me.state === 'down' || me.state === 'getup' || me.state === 'ko' || me.state === 'win') {
      this.hold = next;
      return { ...next };
    }

    if (dist > 460) {
      if (me.cool === 0 && roll < 0.14 + 0.14 * L) {
        // meia-lua: baixo, baixo+frente, soco
        this.hold = { ...NEUTRAL, down: true };
        this.script = [
          { ...NEUTRAL, down: true },
          { ...NEUTRAL, down: true, [toward]: true },
          { ...NEUTRAL, [toward]: true, punch: true },
        ];
        this.scriptAt = frame;
        this.until = frame + 6;
        return { ...NEUTRAL, down: true };
      }
      if (roll < 0.1) next.up = true, next[toward] = true;
      else next[toward] = true;
    } else if (dist > 290) {
      if (roll < 0.55) next[toward] = true;
      else if (roll < 0.75) { next.kick = true; }
      else if (roll < 0.82 + 0.05 * L) { next.up = true; next[toward] = true; }
      else if (roll < 0.92) next[away] = true;
    } else if (dist > 215) {
      if (roll < 0.3) { return this.pulse(next, 'punch'); }
      if (roll < 0.55) { return this.pulse(next, 'kick'); }
      if (roll < 0.7) { next.down = true; return this.pulse(next, 'kick'); }
      if (roll < 0.9) next[toward] = true;
      else next[away] = true;
    } else {
      if (roll < 0.4) return this.pulse(next, 'punch');
      if (roll < 0.65) return this.pulse(next, 'kick');
      if (roll < 0.75) { next.down = true; return this.pulse(next, 'punch'); }
      if (roll < 0.82) { next.down = true; return this.pulse(next, 'kick'); }
      if (roll < 0.88) { next.block = true; next[away] = true; }
      else next[away] = true;
    }
    this.hold = { ...next, punch: false, kick: false };
    return { ...next };
  }

  pulse(base, button) {
    this.hold = { ...base, punch: false, kick: false };
    this.until += 6;
    return { ...base, [button]: true };
  }

  // executa a "meia-lua" em passos (chamado pelo think via script)
  scriptedInput(sim) {
    if (!this.script) return null;
    const i = Math.floor((sim.frame - this.scriptAt) / 5);
    if (i >= this.script.length) { this.script = null; return null; }
    const step = this.script[i];
    // punch só no primeiro frame do último passo
    if (step.punch && (sim.frame - this.scriptAt) % 5 !== 0) return { ...step, punch: false };
    return { ...step };
  }

  next(sim) {
    const scripted = this.scriptedInput(sim);
    if (scripted) return scripted;
    return this.think(sim);
  }
}
