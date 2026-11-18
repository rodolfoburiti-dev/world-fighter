// Motor de luta do World Fighter: simulação pura, determinística e sem Phaser.
// Roda em passos fixos de 1/60 s; a única aleatoriedade vem do gerador com semente (sim.rand()),
// para que dois computadores calculem exatamente a mesma luta (base do multiplayer futuro).
// Coordenadas: x em pixels da tela; y = altura dos pés acima do chão (0 = no chão).

export const FPS = 60;
export const HP_MAX = 1000;
export const ROUND_FRAMES = 99 * FPS; // 99 s, como no fliperama
export const INTRO_FRAMES = 170;
export const END_FRAMES = 170;
export const BOUNDS = { left: 130, right: 1150 };

const GRAVITY = 0.85;
const JUMP_V = 17;
const WALK_F = 3.6;
const WALK_B = 2.9;
const JUMP_VX = 4.4;
const BODY_HALF = 58;
const STAND_H = 300;
const CROUCH_H = 160;
const MIN_DIST = 165;
const DOWN_FRAMES = 42;
export const GETUP_FRAMES = 26; // tempo para levantar (a animação de levantada usa o mesmo)
const SPECIAL_COOLDOWN = 130;
const PROJECTILE_SPEED = 8;
const BLOCK_CHIP = 0.1;
// todo dano é multiplicado por este fator (2026-11-12: 0,6 para as lutas durarem mais)
export const DAMAGE_SCALE = 0.6;

// su = início, act = ativo, rec = recuperação (frames). x0/x1 = alcance à frente do centro;
// y0/y1 = altura acima dos pés do atacante. hs/bs = stun no acerto/na defesa; kb = empurrão.
export const ATTACKS = {
  punch:   { su: 5, act: 3, rec: 11, dmg: 95,  x0: 20, x1: 170, y0: 170, y1: 265, hs: 16, bs: 10, kb: 5, stop: 4 },
  kick:    { su: 9, act: 4, rec: 17, dmg: 140, x0: 20, x1: 195, y0: 90,  y1: 270, hs: 22, bs: 14, kb: 9, stop: 6 },
  cpunch:  { su: 8, act: 4, rec: 15, dmg: 125, x0: 20, x1: 190, y0: 140, y1: 255, hs: 20, bs: 13, kb: 8, stop: 6 }, // soco forte (baixo + soco)
  sweep:   { su: 9, act: 4, rec: 19, dmg: 115, x0: 20, x1: 215, y0: 0,   y1: 70,  hs: 0,  bs: 12, kb: 6, stop: 7, low: true, knockdown: true }, // chute baixo (baixo + chute)
  jpunch:  { su: 3, act: 0, rec: 0,  dmg: 105,  x0: 20, x1: 160, y0: 120, y1: 250, hs: 18, bs: 11, kb: 5, stop: 4, air: true },
  jkick:   { su: 4, act: 0, rec: 0,  dmg: 125, x0: 20, x1: 185, y0: 40,  y1: 190, hs: 20, bs: 13, kb: 7, stop: 5, air: true },
  special: { su: 14, act: 1, rec: 28, dmg: 0,  x0: 0,  x1: 0,   y0: 0,   y1: 0,   hs: 0,  bs: 0,  kb: 0, stop: 0, projectile: true },
};

const PROJECTILE = { dmg: 170, hs: 24, bs: 14, kb: 9, chip: 15, radius: 30, height: 150, stop: 6 };
const ACTIONABLE = new Set(['idle', 'walk', 'crouch']);

export const NEUTRAL = Object.freeze({ left: false, right: false, up: false, down: false, block: false, punch: false, kick: false });

function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function makeFighter(index) {
  return {
    index, x: index === 0 ? 450 : 830, y: 0, vx: 0, vy: 0, face: index === 0 ? 1 : -1,
    hp: HP_MAX, state: 'idle', t: 0, crouch: false, atk: null, stun: 0, hitstop: 0,
    bufPunch: 0, bufKick: 0, hist: [], cool: 0, airUsed: false, blocking: false, invuln: 0, wins: 0,
  };
}

export class FightSim {
  // power: multiplica o dano que cada lado causa; armor: multiplica o dano que cada lado recebe
  // (o chefe final bate mais forte e aguenta mais). introFrames: abertura do 1º round (entrada do chefe).
  constructor({ seed = 1, power = [1, 1], armor = [1, 1], introFrames = INTRO_FRAMES } = {}) {
    this.rand = mulberry32(seed);
    this.power = power;
    this.armor = armor;
    this.introFirst = introFrames;
    this.wins = [0, 0];
    this.frame = 0;
    this.newRound();
  }

  newRound() {
    const keep = this.fighters ? this.fighters.map((f) => f.wins) : [0, 0];
    this.fighters = [makeFighter(0), makeFighter(1)];
    this.fighters.forEach((f, i) => { f.wins = keep[i]; });
    this.projectiles = [];
    this.timer = ROUND_FRAMES;
    this.phase = 'intro';
    this.phaseT = 0;
    this.result = null;
    this.events = [];
  }

  emit(ev) { this.events.push(ev); }

  // inputs: [in0, in1], cada um { left, right, up, down, block, punch, kick }; punch/kick = apertou neste frame
  step(inputs) {
    this.events = [];
    this.frame++;
    this.phaseT++;
    const [a, b] = this.fighters;
    const canAct = this.phase === 'fight';

    this.updateFighter(a, b, canAct ? inputs[0] : NEUTRAL, canAct);
    this.updateFighter(b, a, canAct ? inputs[1] : NEUTRAL, canAct);
    this.separate(a, b);
    this.resolveAttacks(a, b);
    this.resolveAttacks(b, a);
    this.updateProjectiles();

    if (this.phase === 'intro' && this.phaseT >= (this.frame <= this.introFirst + 1 ? this.introFirst : INTRO_FRAMES)) this.setPhase('fight');
    else if (this.phase === 'fight') {
      this.timer--;
      if (a.hp <= 0 || b.hp <= 0) this.endRound(a.hp <= 0 && b.hp <= 0 ? -1 : a.hp <= 0 ? 1 : 0, 'ko');
      else if (this.timer <= 0) this.endRound(a.hp === b.hp ? -1 : a.hp > b.hp ? 0 : 1, 'time');
    } else if (this.phase === 'koTime' && this.phaseT >= END_FRAMES) this.setPhase('ended');
    return this.events;
  }

  setPhase(phase) {
    this.phase = phase;
    this.phaseT = 0;
    this.emit({ t: 'phase', phase });
  }

  endRound(winner, reason) {
    const perfect = winner >= 0 && this.fighters[winner].hp === HP_MAX;
    this.result = { winner, reason, perfect };
    if (winner >= 0) this.fighters[winner].wins++;
    this.projectiles = [];
    this.setPhase('koTime');
    this.emit({ t: 'roundEnd', winner, reason, perfect });
  }

  // ---- lutador ------------------------------------------------------------
  updateFighter(f, o, inp, canAct) {
    if (f.invuln > 0) f.invuln--;
    if (f.cool > 0) f.cool--;
    if (f.hitstop > 0) { f.hitstop--; return; }

    const fwd = f.face === 1 ? inp.right : inp.left;
    const back = f.face === 1 ? inp.left : inp.right;
    f.hist.push({ down: inp.down, fwd });
    if (f.hist.length > 32) f.hist.shift();
    f.bufPunch = inp.punch ? 7 : Math.max(0, f.bufPunch - 1);
    f.bufKick = inp.kick ? 7 : Math.max(0, f.bufKick - 1);
    f.t++;

    const airborne = f.y > 0 || f.vy > 0;
    f.blocking = false;

    // física no ar
    if (airborne) {
      f.vy -= GRAVITY;
      f.y += f.vy;
      f.x += f.vx;
      if (f.y <= 0) {
        f.y = 0;
        f.vy = 0;
        this.land(f);
      }
    } else {
      f.x += f.vx;
    }
    f.x = Math.min(BOUNDS.right, Math.max(BOUNDS.left, f.x));

    switch (f.state) {
      case 'idle': case 'walk': case 'crouch':
        if (!canAct) { f.vx = 0; f.state = 'idle'; f.crouch = false; break; }
        this.groundControl(f, o, inp, fwd, back);
        break;
      case 'jump':
        if (canAct) this.airControl(f, inp);
        break;
      case 'attack':
        this.advanceAttack(f);
        break;
      case 'hit': case 'blockstun':
        f.vx *= 0.82;
        if (f.state === 'blockstun' && (inp.block || back)) f.blocking = true;
        if (--f.stun <= 0) this.toIdle(f);
        break;
      case 'down':
        if (f.y === 0 && f.vy === 0) {
          f.vx *= 0.8;
          if (f.t >= DOWN_FRAMES && f.hp > 0) { f.state = 'getup'; f.t = 0; f.invuln = GETUP_FRAMES + 8; }
        }
        break;
      case 'getup':
        if (f.t >= GETUP_FRAMES) this.toIdle(f);
        break;
      case 'ko':
        f.vx *= 0.85;
        break;
      case 'win':
        break;
      default:
        break;
    }

    if (this.phase === 'koTime' && f.hp > 0 && ACTIONABLE.has(f.state) && f.y === 0) {
      f.state = 'win';
      f.t = 0;
      f.vx = 0;
    }
  }

  land(f) {
    this.emit({ t: 'land', p: f.index, x: f.x });
    if (f.state === 'jump' || (f.state === 'attack' && f.atk && ATTACKS[f.atk.kind].air)) {
      f.vx = 0;
      this.toIdle(f);
    } else if (f.state === 'down') {
      f.t = 0; // começa a contar o tempo caído a partir do pouso
    }
  }

  toIdle(f) {
    f.state = 'idle';
    f.t = 0;
    f.atk = null;
    f.crouch = false;
  }

  facing(f, o) {
    if (o.x !== f.x) f.face = o.x > f.x ? 1 : -1;
  }

  groundControl(f, o, inp, fwd, back) {
    this.facing(f, o);
    f.crouch = false;

    if (f.bufPunch > 0 && f.cool === 0 && this.specialMotion(f)) {
      f.bufPunch = 0;
      this.startAttack(f, 'special');
      return;
    }
    if (f.bufKick > 0) {
      f.bufKick = 0;
      this.startAttack(f, inp.down ? 'sweep' : 'kick');
      return;
    }
    if (f.bufPunch > 0) {
      f.bufPunch = 0;
      this.startAttack(f, inp.down ? 'cpunch' : 'punch');
      return;
    }
    if (inp.up) {
      f.vy = JUMP_V;
      f.vx = fwd ? f.face * JUMP_VX : back ? -f.face * JUMP_VX * 0.8 : 0;
      f.state = 'jump';
      f.t = 0;
      f.airUsed = false;
      this.emit({ t: 'jump', p: f.index, x: f.x });
      return;
    }
    if (inp.down) {
      f.state = 'crouch';
      f.crouch = true;
      f.vx = 0;
      f.blocking = inp.block || back;
      return;
    }
    if (fwd !== back) {
      f.state = 'walk';
      f.vx = fwd ? f.face * WALK_F : -f.face * WALK_B;
    } else {
      f.state = 'idle';
      f.vx = 0;
    }
    f.blocking = inp.block || back;
  }

  airControl(f, inp) {
    if (f.airUsed) return;
    if (f.bufKick > 0) { f.bufKick = 0; this.startAttack(f, 'jkick'); f.airUsed = true; }
    else if (f.bufPunch > 0) { f.bufPunch = 0; this.startAttack(f, 'jpunch'); f.airUsed = true; }
  }

  specialMotion(f) {
    // baixo, depois frente, e então soco (o soco já está no buffer)
    const h = f.hist;
    let sawDown = false;
    for (let i = 0; i < h.length; i++) {
      if (!sawDown && h[i].down) sawDown = true;
      else if (sawDown && h[i].fwd) return true;
    }
    return false;
  }

  startAttack(f, kind) {
    f.state = 'attack';
    f.atk = { kind, t: 0, hit: false };
    f.t = 0;
    const def = ATTACKS[kind];
    if (!def.air) f.vx = 0;
    f.crouch = false; // os golpes das animações são todos em pé
    if (kind === 'special') f.hist = [];
    this.emit({ t: 'attack', p: f.index, kind, x: f.x });
  }

  advanceAttack(f) {
    const atk = f.atk;
    const def = ATTACKS[atk.kind];
    if (!def.air) f.vx = 0;
    atk.t++;
    if (def.projectile && atk.t === def.su) {
      f.cool = SPECIAL_COOLDOWN;
      this.projectiles.push({ owner: f.index, x: f.x + f.face * 110, y: f.y + PROJECTILE.height, vx: f.face * PROJECTILE_SPEED, t: 0 });
      this.emit({ t: 'special', p: f.index, x: f.x, face: f.face });
    }
    if (!def.air && atk.t >= def.su + def.act + def.rec) this.toIdle(f);
  }

  separate(a, b) {
    const dx = b.x - a.x;
    if (Math.abs(dx) >= MIN_DIST || Math.abs(a.y - b.y) > 150) return;
    const dir = dx === 0 ? (a.index === 0 ? 1 : -1) : Math.sign(dx);
    const push = (MIN_DIST - Math.abs(dx)) / 2;
    a.x -= dir * push;
    b.x += dir * push;
    for (const f of [a, b]) f.x = Math.min(BOUNDS.right, Math.max(BOUNDS.left, f.x));
    // encurralado: o outro cede o espaço que faltou
    const gap = Math.abs(b.x - a.x);
    if (gap < MIN_DIST) {
      if (a.x <= BOUNDS.left || b.x >= BOUNDS.right) {
        if (a.x <= BOUNDS.left) b.x = a.x + MIN_DIST; else a.x = b.x - MIN_DIST;
      }
    }
  }

  // ---- acertos -------------------------------------------------------------
  hurtbox(f) {
    const h = f.crouch && f.y === 0 ? CROUCH_H : STAND_H;
    return { x0: f.x - BODY_HALF, x1: f.x + BODY_HALF, y0: f.y, y1: f.y + h };
  }

  isActive(f) {
    if (f.state !== 'attack' || !f.atk) return false;
    const def = ATTACKS[f.atk.kind];
    if (def.projectile) return false;
    if (def.air) return f.atk.t >= def.su && f.y > 0;
    return f.atk.t >= def.su && f.atk.t < def.su + def.act;
  }

  resolveAttacks(a, d) {
    if (a.hitstop > 0 || !this.isActive(a) || a.atk.hit || this.phase !== 'fight') return;
    const def = ATTACKS[a.atk.kind];
    const hb = a.face === 1
      ? { x0: a.x + def.x0, x1: a.x + def.x1 }
      : { x0: a.x - def.x1, x1: a.x - def.x0 };
    const box = { ...hb, y0: a.y + def.y0, y1: a.y + def.y1 };
    const hurt = this.hurtbox(d);
    if (d.invuln > 0 || d.state === 'down' || d.state === 'ko' || d.state === 'getup') return;
    if (box.x1 < hurt.x0 || box.x0 > hurt.x1 || box.y1 < hurt.y0 || box.y0 > hurt.y1) return;
    a.atk.hit = true;
    this.applyHit(a, d, def, { x: (Math.max(box.x0, hurt.x0) + Math.min(box.x1, hurt.x1)) / 2, y: (Math.max(box.y0, hurt.y0) + Math.min(box.y1, hurt.y1)) / 2 }, a.face, a.atk.kind);
  }

  canBlock(d, low) {
    if (d.y > 0) return false;
    if (!(ACTIONABLE.has(d.state) || d.state === 'blockstun')) return false;
    if (!d.blocking) return false;
    return !(low && !d.crouch);
  }

  applyHit(attacker, d, def, at, dirFace, kind) {
    const blocked = this.canBlock(d, def.low);
    const stop = def.stop;
    const mul = DAMAGE_SCALE * this.power[1 - d.index] * this.armor[d.index];
    if (blocked) {
      d.hp -= Math.max(1, Math.round(def.dmg * mul * BLOCK_CHIP));
      d.state = 'blockstun';
      d.stun = def.bs;
      d.vx = dirFace * def.kb * 0.7;
      d.atk = null;
      if (attacker) attacker.vx = attacker.y === 0 ? -dirFace * 1.5 : attacker.vx;
    } else {
      d.hp -= Math.round(def.dmg * mul);
      d.atk = null;
      d.crouch = false;
      if (def.knockdown || d.hp <= 0) this.knockDown(d, dirFace);
      else {
        d.state = 'hit';
        d.stun = def.hs;
        d.vx = dirFace * def.kb;
        d.t = 0;
      }
    }
    if (attacker) attacker.hitstop = stop;
    d.hitstop = stop;
    this.emit({ t: 'hit', x: at.x, y: at.y, kind, blocked, target: d.index, power: def.dmg, dir: dirFace });
    if (d.hp <= 0) {
      d.hp = 0;
      d.state = 'ko';
      this.emit({ t: 'ko', p: d.index });
    }
  }

  knockDown(d, dirFace) {
    d.state = 'down';
    d.t = 0;
    d.vy = d.y > 0 ? Math.min(d.vy, 0) - 3 : 9;
    d.y = Math.max(d.y, 0.01);
    d.vx = dirFace * 5.5;
  }

  // ---- projéteis -------------------------------------------------------------
  updateProjectiles() {
    for (const p of this.projectiles) {
      p.x += p.vx;
      p.t++;
      const d = this.fighters[1 - p.owner];
      const hurt = this.hurtbox(d);
      const hit = Math.abs(p.x - d.x) < BODY_HALF + PROJECTILE.radius
        && p.y + PROJECTILE.radius > hurt.y0 && p.y - PROJECTILE.radius < hurt.y1;
      if (this.phase === 'fight' && hit && d.invuln === 0 && !['down', 'ko', 'getup'].includes(d.state)) {
        const face = Math.sign(p.vx);
        const fake = { dmg: PROJECTILE.dmg, hs: PROJECTILE.hs, bs: PROJECTILE.bs, kb: PROJECTILE.kb, stop: PROJECTILE.stop, low: false };
        const blocked = this.canBlock(d, false);
        this.applyHit(null, d, blocked ? { ...fake, dmg: Math.round(PROJECTILE.chip / BLOCK_CHIP) } : fake, { x: p.x, y: p.y }, face, 'special');
        this.fighters[p.owner].hitstop = Math.max(this.fighters[p.owner].hitstop, 4);
        p.dead = true;
        this.emit({ t: 'projectileHit', x: p.x, y: p.y, blocked });
      } else if (p.x < -80 || p.x > 1360) p.dead = true;
    }
    this.projectiles = this.projectiles.filter((p) => !p.dead);
  }
}
