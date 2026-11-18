// Som do World Fighter: efeitos gravados em MP3 (reserva sintetizada com WebAudio); música em MP3 (com reserva sintetizada).
// As partituras ficam em music.js; aqui ficam os instrumentos, a bateria e o sequenciador.
// O navegador só libera áudio depois de um toque/tecla: chame Sound.unlock() nesse momento.

import { SONGS, parseDrums, parseTrack } from './music.js';
import { SFX_FILES } from './sfx-list.js';

// Efeitos gravados (MP3, Mixkit) em assets/sfx/<nome>-<n>.mp3, com variações sorteadas; enquanto não
// carregam (ou se faltarem), toca o efeito sintetizado de mesmo nome. Volume relativo de cada um:
const SFX_GAIN = {
  punch: 0.85, kick: 1, block: 0.6, whiff: 0.32, special: 0.6, boom: 0.85, ko: 1, fall: 0.75,
  land: 0.35, jump: 0.22, slam: 0.9, vs: 0.85,
  hurt: 0.8, scream: 0.95, // vozes de dor: hurt-<lutador>, scream-<lutador>
};

const STEP_AHEAD = 0.12; // segundos agendados à frente pelo sequenciador

// Músicas gravadas (MP3) por tela e fase. Kevin MacLeod (incompetech.com), licença CC BY 4.0 — créditos na
// tela-título e em CREDITOS.txt. Sem arquivo para o nome pedido, toca a trilha sintetizada de music.js.
const MP3 = {
  title: 'title', select: 'select', 'stage-us': 'stage-us', 'stage-br': 'stage-br-lula',
  'stage-br-lula': 'stage-br-lula', 'stage-br-bolsonaro': 'stage-br-bolsonaro', 'stage-br-flavio': 'stage-br-flavio',
  'stage-ar': 'stage-ar', 'stage-py': 'stage-py', 'stage-cn': 'stage-cn', 'stage-kp': 'stage-kp',
  'stage-ru': 'stage-ru', 'stage-il': 'stage-il',
};
const MP3_GAIN = 0.55;
const freq = (n) => 440 * Math.pow(2, (n - 69) / 12);

class SoundEngine {
  constructor() {
    this.ctx = null;
    // o jogo sempre começa com som ligado (2026-11-15); o SOM: OFF vale só até fechar a página
    this.muted = false;
    try { localStorage.removeItem('wf-muted'); } catch (e) { /* sem storage */ }
    // iPhone/iPad: sem isto, a chave de silencioso do aparelho cala o som do jogo
    try { if (navigator.audioSession) navigator.audioSession.type = 'playback'; } catch (e) { /* navegador sem suporte */ }
    this.song = null;
    this.timer = null;
  }

  unlock() {
    if (!this.ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      this.ctx = new AC();
      const comp = this.ctx.createDynamicsCompressor();
      comp.threshold.value = -14;
      comp.ratio.value = 4;
      comp.connect(this.ctx.destination);
      this.master = this.ctx.createGain();
      this.master.gain.value = this.muted ? 0 : 0.6;
      this.master.connect(comp);
      this.musicBus = this.ctx.createGain();
      this.musicBus.gain.value = 0.5;
      this.musicBus.connect(this.master);
      this.sfxBus = this.ctx.createGain();
      this.sfxBus.gain.value = 0.7;
      this.sfxBus.connect(this.master);
      this.pulse = this.makePulse(0.25);
      this.noise = this.makeNoise();
      this.reverb = this.ctx.createConvolver();
      this.reverb.buffer = this.makeImpulse(2.2);
      this.reverb.connect(this.musicBus);
      this.distCurve = this.makeDistortion(30);
      this.loadSamples();
      // aba em segundo plano: pausa o áudio para a música não sair picotada
      document.addEventListener('visibilitychange', () => {
        if (document.hidden) this.ctx.suspend();
        else this.ctx.resume();
      });
    }
    if (this.ctx.state === 'suspended') this.ctx.resume();
  }

  get ready() { return !!this.ctx; }

  toggleMute() {
    this.muted = !this.muted;
    if (this.master) this.master.gain.setTargetAtTime(this.muted ? 0 : 0.6, this.ctx.currentTime, 0.02);
    return this.muted;
  }

  makePulse(duty) {
    const n = 32, real = new Float32Array(n), imag = new Float32Array(n);
    for (let k = 1; k < n; k++) {
      real[k] = Math.sin(2 * Math.PI * k * duty) / (k * Math.PI);
      imag[k] = (1 - Math.cos(2 * Math.PI * k * duty)) / (k * Math.PI);
    }
    return this.ctx.createPeriodicWave(real, imag);
  }

  // Avião da tela de seleção (como no Street Fighter II): o ronco do jato durante todo o voo, começando junto
  // com o avião e acabando quando ele pousa, com o assobio da turbina e o som indo de um lado para o outro.
  // pan: -1 = voa para a esquerda, 1 = para a direita, 0 = no meio. dur = duração do voo (s).
  plane(pan = 0, dur = 2.4) {
    if (!this.ctx) return;
    this.jet(this.ctx.currentTime + 0.01, dur, pan);
  }

  jet(t, dur, pan) {
    const c = this.ctx;
    const end = t + dur;
    const out = c.createGain();
    // entra na hora (o avião já está no ar), segura forte o voo inteiro e some no pouso
    out.gain.setValueAtTime(0.0001, t);
    out.gain.linearRampToValueAtTime(0.75, t + 0.06);
    out.gain.linearRampToValueAtTime(0.9, t + dur * 0.5);
    out.gain.linearRampToValueAtTime(0.75, end - 0.35);
    out.gain.linearRampToValueAtTime(0.0001, end);
    let node = out;
    if (c.createStereoPanner && pan) {
      const p = c.createStereoPanner();
      p.pan.setValueAtTime(-0.7 * pan, t);
      p.pan.linearRampToValueAtTime(0.7 * pan, end);
      out.connect(p);
      node = p;
    }
    node.connect(this.sfxBus);
    // oscilação lenta do ronco (a turbulência do jato)
    const lfo = c.createOscillator();
    lfo.frequency.value = 5.5;
    lfo.start(t);
    lfo.stop(end + 0.05);
    const noise = (filterType, f, q, vol, wobble) => {
      const src = c.createBufferSource();
      src.buffer = this.noise;
      src.loop = true;
      const bq = c.createBiquadFilter();
      bq.type = filterType;
      bq.Q.value = q;
      bq.frequency.setValueAtTime(f, t);
      bq.frequency.linearRampToValueAtTime(f * 1.15, t + dur * 0.5);
      bq.frequency.linearRampToValueAtTime(f * 0.8, end);
      if (wobble) {
        const lg = c.createGain();
        lg.gain.value = wobble;
        lfo.connect(lg).connect(bq.frequency);
      }
      const g = c.createGain();
      g.gain.value = vol;
      src.connect(bq).connect(g).connect(out);
      src.start(t, Math.random() * 0.5);
      src.stop(end + 0.05);
    };
    noise('lowpass', 520, 0.8, 1.2, 60);     // ronco grave do motor
    noise('bandpass', 1500, 1.1, 0.7, 180);  // sopro do jato
    // assobio da turbina, firme durante o voo e descendo no pouso
    for (const [type, f, vol] of [['sawtooth', 1150, 0.045], ['triangle', 1720, 0.05]]) {
      const o = c.createOscillator();
      o.type = type;
      o.frequency.setValueAtTime(f, t);
      o.frequency.linearRampToValueAtTime(f * 1.04, t + dur * 0.5);
      o.frequency.linearRampToValueAtTime(f * 0.8, end);
      const bq = c.createBiquadFilter();
      bq.type = 'bandpass';
      bq.frequency.value = f;
      bq.Q.value = 1.4;
      const g = c.createGain();
      g.gain.value = vol;
      o.connect(bq).connect(g).connect(out);
      o.start(t);
      o.stop(end + 0.05);
    }
    // grave do motor
    const sub = c.createOscillator();
    sub.type = 'sine';
    sub.frequency.setValueAtTime(62, t);
    sub.frequency.linearRampToValueAtTime(52, end);
    const sg = c.createGain();
    sg.gain.value = 0.3;
    sub.connect(sg).connect(out);
    sub.start(t);
    sub.stop(end + 0.05);
  }

  makeNoise() {
    const len = this.ctx.sampleRate;
    const buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    return buf;
  }

  makeImpulse(seconds) {
    const rate = this.ctx.sampleRate, len = Math.floor(rate * seconds);
    const buf = this.ctx.createBuffer(2, len, rate);
    for (let ch = 0; ch < 2; ch++) {
      const d = buf.getChannelData(ch);
      for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 3);
    }
    return buf;
  }

  makeDistortion(k) {
    const n = 2048, curve = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const x = (i * 2) / n - 1;
      curve[i] = ((1 + k) * x) / (1 + k * Math.abs(x));
    }
    return curve;
  }

  // ---- blocos de som -------------------------------------------------------
  env(t, dur, vol, attack = 0.005, release = 0.06) {
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + attack);
    g.gain.setValueAtTime(vol, t + Math.max(attack, dur - release));
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    return g;
  }

  tone({ f, f2, type = 'square', t = this.ctx.currentTime, dur = 0.1, vol = 0.3, bus = this.sfxBus, attack = 0.005, sustain = 0 }) {
    const osc = this.ctx.createOscillator();
    if (type === 'pulse') osc.setPeriodicWave(this.pulse); else osc.type = type;
    osc.frequency.setValueAtTime(f, t);
    if (f2) osc.frequency.exponentialRampToValueAtTime(f2, t + dur);
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + attack);
    if (sustain) g.gain.setValueAtTime(vol * sustain, t + dur * 0.6);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    osc.connect(g).connect(bus);
    osc.start(t);
    osc.stop(t + dur + 0.02);
  }

  burst({ t = this.ctx.currentTime, dur = 0.15, vol = 0.3, filter = 'bandpass', fq = 1800, fq2, q = 1, bus = this.sfxBus }) {
    const src = this.ctx.createBufferSource();
    src.buffer = this.noise;
    const bq = this.ctx.createBiquadFilter();
    bq.type = filter;
    bq.frequency.setValueAtTime(fq, t);
    if (fq2) bq.frequency.exponentialRampToValueAtTime(fq2, t + dur);
    bq.Q.value = q;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(bq).connect(g).connect(bus);
    src.start(t, Math.random() * 0.5);
    src.stop(t + dur + 0.02);
    return g;
  }

  osc(type, f, t, dur, detuneCents = 0) {
    const o = this.ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(f, t);
    o.detune.value = detuneCents;
    o.start(t);
    o.stop(t + dur + 0.05);
    return o;
  }

  // ---- instrumentos da trilha ------------------------------------------------
  // Guitarra: power chord (tônica, quinta, oitava) em dois osciladores desafinados, pela distorção.
  guitar(s, note, t, dur, muted) {
    const len = muted ? Math.min(dur, 0.11) : dur;
    const g = this.env(t, len, muted ? 0.5 : 0.42, 0.004, muted ? 0.05 : 0.12);
    g.connect(s.gtrIn);
    for (const iv of [0, 7, 12]) {
      for (const dt of [-8, 8]) this.osc('sawtooth', freq(note + iv), t, len, dt).connect(g);
    }
  }

  // Flauta tipo shakuhachi: escorrega para a nota, sopro de ruído e vibrato que cresce.
  flute(s, note, t, dur) {
    const f = freq(note);
    const o = this.ctx.createOscillator();
    o.type = 'triangle';
    o.frequency.setValueAtTime(f * 0.96, t);
    o.frequency.exponentialRampToValueAtTime(f, t + 0.07);
    if (dur > 0.3) {
      const lfo = this.ctx.createOscillator();
      lfo.frequency.value = 5.3;
      const depth = this.ctx.createGain();
      depth.gain.setValueAtTime(0, t);
      depth.gain.linearRampToValueAtTime(f * 0.014, t + Math.min(0.5, dur * 0.6));
      lfo.connect(depth).connect(o.frequency);
      lfo.start(t);
      lfo.stop(t + dur + 0.05);
    }
    o.start(t);
    o.stop(t + dur + 0.05);
    const lp = this.ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 2600;
    const g = this.env(t, dur, 0.34, 0.035, 0.12);
    o.connect(lp).connect(g);
    g.connect(s.bus);
    g.connect(s.send);
    const breath = this.burst({ t, dur: Math.min(dur, 0.25), vol: 0.07, fq: f * 2.2, q: 2, bus: s.bus });
    breath.connect(s.send);
  }

  strings(s, note, t, dur) {
    const lp = this.ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 1500;
    const g = this.env(t, dur, 0.05, 0.35, 0.4);
    for (const dt of [-9, 0, 9]) this.osc('sawtooth', freq(note), t, dur, dt).connect(lp);
    lp.connect(g);
    g.connect(s.bus);
    g.connect(s.send);
  }

  koto(s, note, t) {
    const dur = 0.5;
    const lp = this.ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.setValueAtTime(4200, t);
    lp.frequency.exponentialRampToValueAtTime(500, t + 0.3);
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.13, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    this.osc('sawtooth', freq(note), t, dur).connect(lp);
    lp.connect(g);
    g.connect(s.bus);
    g.connect(s.send);
  }

  bass(s, note, t, dur) {
    const lp = this.ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 650;
    const g = this.env(t, dur, 0.4, 0.004, 0.04);
    this.osc('sawtooth', freq(note), t, dur).connect(lp);
    lp.connect(g).connect(s.bus);
  }

  // Cordas dedilhadas (koto, harpa, guzheng, cavaquinho, oud, piano): ataque seco que fecha o filtro.
  pluck(s, note, t, p) {
    const f = freq(note);
    const lp = this.ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.setValueAtTime(p.cut, t);
    lp.frequency.exponentialRampToValueAtTime(p.end, t + p.dur * 0.7);
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(p.vol, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + p.dur);
    const o = this.osc(p.type, f, t, p.dur);
    if (p.bend) { // a corda "chega" na nota vindo de baixo
      o.frequency.setValueAtTime(f * Math.pow(2, p.bend / 12), t);
      o.frequency.exponentialRampToValueAtTime(f, t + 0.06);
    }
    o.connect(lp);
    if (p.partial) this.osc('sine', f * 2, t, p.dur).connect(lp);
    lp.connect(g);
    g.connect(s.bus);
    g.connect(s.send);
  }

  // Balalaica: a mesma nota repetida bem rápido (tremolo de palheta).
  balalaika(s, note, t, dur) {
    for (let at = t; at < t + dur - 0.01; at += 0.058) {
      this.pluck(s, note, at, { type: 'sawtooth', dur: 0.12, cut: 3600, end: 1000, vol: 0.085 });
    }
  }

  // Metais: ataque "mordido" (o filtro abre rápido) e sustentação firme.
  brass(s, note, t, dur) {
    const lp = this.ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.setValueAtTime(500, t);
    lp.frequency.linearRampToValueAtTime(2900, t + 0.06);
    lp.frequency.exponentialRampToValueAtTime(1800, t + 0.3);
    const g = this.env(t, dur, 0.2, 0.025, 0.07);
    for (const dt of [-7, 7]) this.osc('sawtooth', freq(note), t, dur, dt).connect(lp);
    lp.connect(g);
    g.connect(s.bus);
    g.connect(s.send);
  }

  // Acordeão / bandoneon: palheta dupla com tremolo de fole.
  accordion(s, note, t, dur) {
    const lp = this.ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 2300;
    const trem = this.ctx.createGain();
    trem.gain.value = 0.8;
    const lfo = this.ctx.createOscillator();
    lfo.frequency.value = 6.4;
    const depth = this.ctx.createGain();
    depth.gain.value = 0.2;
    lfo.connect(depth).connect(trem.gain);
    lfo.start(t);
    lfo.stop(t + dur + 0.05);
    this.osc('sawtooth', freq(note), t, dur, -6).connect(lp);
    this.osc('square', freq(note), t, dur, 6).connect(lp);
    const g = this.env(t, dur, 0.15, 0.03, 0.08);
    lp.connect(trem).connect(g);
    g.connect(s.bus);
    g.connect(s.send);
  }

  // Erhu: arco com deslize para a nota e vibrato largo.
  erhu(s, note, t, dur) {
    const f = freq(note);
    const o = this.ctx.createOscillator();
    o.type = 'sawtooth';
    o.frequency.setValueAtTime(f * 0.944, t);
    o.frequency.exponentialRampToValueAtTime(f, t + 0.09);
    const lfo = this.ctx.createOscillator();
    lfo.frequency.value = 5.6;
    const depth = this.ctx.createGain();
    depth.gain.setValueAtTime(0, t);
    depth.gain.linearRampToValueAtTime(f * 0.012, t + Math.min(0.35, dur * 0.7));
    lfo.connect(depth).connect(o.frequency);
    lfo.start(t);
    lfo.stop(t + dur + 0.05);
    o.start(t);
    o.stop(t + dur + 0.05);
    const bp = this.ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 1200;
    bp.Q.value = 0.9;
    const lp = this.ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 3200;
    const g = this.env(t, dur, 0.3, 0.05, 0.1);
    o.connect(bp).connect(lp).connect(g);
    g.connect(s.bus);
    g.connect(s.send);
  }

  // Clarinete de klezmer: onda quadrada suave com vibrato e um pouco de sopro.
  clarinet(s, note, t, dur) {
    const f = freq(note);
    const o = this.ctx.createOscillator();
    o.type = 'square';
    o.frequency.setValueAtTime(f * 0.97, t);
    o.frequency.exponentialRampToValueAtTime(f, t + 0.05);
    const lfo = this.ctx.createOscillator();
    lfo.frequency.value = 5.2;
    const depth = this.ctx.createGain();
    depth.gain.setValueAtTime(0, t);
    depth.gain.linearRampToValueAtTime(f * 0.01, t + Math.min(0.3, dur * 0.7));
    lfo.connect(depth).connect(o.frequency);
    lfo.start(t);
    lfo.stop(t + dur + 0.05);
    o.start(t);
    o.stop(t + dur + 0.05);
    const lp = this.ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 1700;
    const g = this.env(t, dur, 0.22, 0.04, 0.09);
    o.connect(lp).connect(g);
    g.connect(s.bus);
    g.connect(s.send);
    this.burst({ t, dur: Math.min(dur, 0.12), vol: 0.04, fq: f * 3, q: 1.5, bus: s.bus });
  }

  // Guitarra solo: nota única pela mesma distorção da base, com vibrato.
  guitarLead(s, note, t, dur) {
    const f = freq(note);
    const g = this.env(t, dur, 0.34, 0.01, 0.08);
    g.connect(s.gtrIn);
    const lfo = this.ctx.createOscillator();
    lfo.frequency.value = 5.8;
    const depth = this.ctx.createGain();
    depth.gain.setValueAtTime(0, t);
    depth.gain.linearRampToValueAtTime(f * 0.008, t + Math.min(0.3, dur * 0.7));
    lfo.connect(depth);
    lfo.start(t);
    lfo.stop(t + dur + 0.05);
    for (const dt of [-9, 9]) {
      const o = this.osc('sawtooth', f, t, dur, dt);
      depth.connect(o.frequency);
      o.connect(g);
    }
  }

  // Grave de 808: senoide que cai de tom no ataque e segura.
  sub(s, note, t, dur) {
    const f = freq(note);
    const o = this.osc('sine', f * 2, t, dur);
    o.frequency.exponentialRampToValueAtTime(f, t + 0.05);
    const g = this.env(t, Math.max(0.12, dur * 0.95), 0.75, 0.004, 0.06);
    o.connect(g).connect(s.bus);
  }

  // Coro grave: vozes de serra bem filtradas, ataque lento.
  choir(s, note, t, dur) {
    const lp = this.ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 820;
    const g = this.env(t, dur, 0.07, 0.3, 0.3);
    for (const dt of [-14, 0, 14]) this.osc('sawtooth', freq(note), t, dur, dt).connect(lp);
    lp.connect(g);
    g.connect(s.bus);
    g.connect(s.send);
  }

  drum(s, kind, t) {
    const bus = s.bus;
    switch (kind) {
      case 'k':
        this.tone({ f: 160, f2: 42, type: 'sine', t, dur: 0.22, vol: 1, bus });
        this.burst({ t, dur: 0.02, vol: 0.3, filter: 'highpass', fq: 3000, bus });
        break;
      case 's':
        this.burst({ t, dur: 0.16, vol: 0.5, fq: 1900, q: 0.7, bus }).connect(s.send);
        this.tone({ f: 200, f2: 150, type: 'triangle', t, dur: 0.09, vol: 0.35, bus });
        break;
      case 'h': this.burst({ t, dur: 0.04, vol: 0.14, filter: 'highpass', fq: 7500, bus }); break;
      case 'o': this.burst({ t, dur: 0.2, vol: 0.14, filter: 'highpass', fq: 7000, bus }); break;
      case 'c': this.burst({ t, dur: 1.3, vol: 0.22, filter: 'highpass', fq: 5000, bus }).connect(s.send); break;
      case 't': // taiko / tímpano: tambor grave e encorpado
        this.tone({ f: 95, f2: 52, type: 'sine', t, dur: 0.6, vol: 1, bus });
        this.burst({ t, dur: 0.18, vol: 0.45, filter: 'lowpass', fq: 450, bus }).connect(s.send);
        break;
      case 'u': // surdo de samba
        this.tone({ f: 100, f2: 62, type: 'sine', t, dur: 0.38, vol: 0.95, bus });
        this.burst({ t, dur: 0.1, vol: 0.3, filter: 'lowpass', fq: 500, bus });
        break;
      case 'm': // tamborim
        this.burst({ t, dur: 0.035, vol: 0.28, filter: 'highpass', fq: 4800, bus });
        this.tone({ f: 1900, f2: 1500, type: 'triangle', t, dur: 0.03, vol: 0.12, bus });
        break;
      case 'd': // darbuka grave (dum)
        this.tone({ f: 170, f2: 95, type: 'sine', t, dur: 0.24, vol: 0.85, bus });
        this.burst({ t, dur: 0.04, vol: 0.2, filter: 'lowpass', fq: 900, bus });
        break;
      case 'e': // darbuka aguda (tek)
        this.burst({ t, dur: 0.05, vol: 0.34, fq: 3600, q: 1.2, bus });
        this.tone({ f: 950, f2: 700, type: 'triangle', t, dur: 0.04, vol: 0.14, bus });
        break;
      case 'x': this.burst({ t, dur: 0.1, vol: 0.42, fq: 2400, q: 0.6, bus }).connect(s.send); break; // palma
      case 'r': this.burst({ t, dur: 0.06, vol: 0.2, fq: 2000, q: 0.8, bus }); break; // caixa leve
      case 'w': // torcida: ruído que cresce e some, como uma multidão gritando
        for (const [fq, vol] of [[900, 0.22], [2200, 0.12]]) {
          const src = this.ctx.createBufferSource();
          src.buffer = this.noise;
          src.loop = true;
          const bq = this.ctx.createBiquadFilter();
          bq.type = 'bandpass';
          bq.frequency.value = fq;
          bq.Q.value = 0.6;
          const g = this.ctx.createGain();
          g.gain.setValueAtTime(0.0001, t);
          g.gain.exponentialRampToValueAtTime(vol, t + 0.35);
          g.gain.exponentialRampToValueAtTime(0.0001, t + 2.2);
          src.connect(bq).connect(g).connect(bus);
          g.connect(s.send);
          src.start(t);
          src.stop(t + 2.3);
        }
        break;
      case 'g': // gongo
        [98, 147, 196].forEach((f, i) => this.tone({ f, type: 'sine', t, dur: 2.4 - i * 0.3, vol: 0.32 - i * 0.07, bus, attack: 0.01 }));
        break;
      default: break;
    }
  }

  // ---- efeitos -------------------------------------------------------------
  loadSamples() {
    this.samples = {};
    this.lastSample = {};
    const stamp = window.WF_VERSION || '1';
    for (const [name, count] of Object.entries(SFX_FILES)) {
      this.samples[name] = [];
      for (let n = 1; n <= count; n++) {
        fetch(`assets/sfx/${name}-${n}.mp3?v=${stamp}`)
          .then((r) => (r.ok ? r.arrayBuffer() : Promise.reject(r.status)))
          .then((data) => new Promise((ok, fail) => this.ctx.decodeAudioData(data, ok, fail)))
          .then((buf) => this.samples[name].push(buf))
          .catch(() => { /* sem o arquivo: fica o sintetizado */ });
      }
    }
  }

  // toca uma variação gravada (nunca a mesma duas vezes seguidas), com leve variação de tom
  playSample(name) {
    const set = this.samples?.[name];
    if (!set?.length) return false;
    let k = Math.floor(Math.random() * set.length);
    if (set.length > 1 && k === this.lastSample[name]) k = (k + 1) % set.length;
    this.lastSample[name] = k;
    const src = this.ctx.createBufferSource();
    src.buffer = set[k];
    src.playbackRate.value = 0.95 + Math.random() * 0.1;
    const g = this.ctx.createGain();
    g.gain.value = SFX_GAIN[name] ?? SFX_GAIN[name.split('-')[0]] ?? 0.8;
    src.connect(g).connect(this.sfxBus);
    src.start();
    return true;
  }

  sfx(name) {
    if (!this.ctx) return;
    if (this.playSample(name)) return;
    const t = this.ctx.currentTime;
    switch (name) {
      case 'coin':
        this.tone({ f: 988, type: 'square', t, dur: 0.08, vol: 0.25 });
        this.tone({ f: 1319, type: 'square', t: t + 0.08, dur: 0.35, vol: 0.25 });
        break;
      case 'cursor':
        this.tone({ f: 1046, type: 'pulse', t, dur: 0.05, vol: 0.2 });
        break;
      case 'menu':
        this.tone({ f: 660, f2: 990, type: 'pulse', t, dur: 0.08, vol: 0.2 });
        break;
      case 'cancel':
        this.tone({ f: 660, f2: 220, type: 'square', t, dur: 0.15, vol: 0.18 });
        break;
      case 'confirm': // soco + acorde de confirmação
        this.tone({ f: 160, f2: 45, type: 'sine', t, dur: 0.25, vol: 0.9 });
        this.burst({ t, dur: 0.18, vol: 0.6, fq: 2400, fq2: 400, q: 0.7 });
        [523, 659, 784, 1046].forEach((f, i) => this.tone({ f, type: 'pulse', t: t + 0.05 + i * 0.04, dur: 0.3, vol: 0.12 }));
        break;
      case 'start':
        [392, 523, 659, 784, 1046].forEach((f, i) => this.tone({ f, type: 'square', t: t + i * 0.06, dur: 0.18, vol: 0.18 }));
        break;
      case 'slam': // logo batendo na tela
        this.tone({ f: 110, f2: 30, type: 'sine', t, dur: 0.9, vol: 1 });
        this.tone({ f: 220, f2: 55, type: 'square', t, dur: 0.35, vol: 0.25 });
        this.burst({ t, dur: 1.4, vol: 0.7, filter: 'lowpass', fq: 6000, fq2: 200, q: 0.5 });
        break;
      case 'tick':
        this.tone({ f: 1760, type: 'square', t, dur: 0.04, vol: 0.12 });
        break;
      case 'plane':
        this.jet(t, 2.4, 0);
        break;
      case 'vs':
        this.tone({ f: 80, f2: 35, type: 'sine', t, dur: 1.2, vol: 1 });
        this.burst({ t, dur: 0.9, vol: 0.6, filter: 'lowpass', fq: 4000, fq2: 150 });
        [220, 277, 330, 440].forEach((f) => this.tone({ f, type: 'sawtooth', t, dur: 1.4, vol: 0.06, sustain: 0.8 }));
        break;
      case 'whoosh':
        this.burst({ t, dur: 0.35, vol: 0.4, fq: 600, fq2: 3000, q: 1.5 });
        break;
      // ---- luta ----
      case 'punch':
        this.tone({ f: 150, f2: 60, type: 'sine', t, dur: 0.14, vol: 0.9 });
        this.burst({ t, dur: 0.09, vol: 0.55, fq: 1700, q: 0.8 });
        break;
      case 'kick':
        this.tone({ f: 110, f2: 38, type: 'sine', t, dur: 0.22, vol: 1 });
        this.burst({ t, dur: 0.14, vol: 0.7, fq: 1100, fq2: 300, q: 0.7 });
        break;
      case 'block':
        this.tone({ f: 420, f2: 300, type: 'square', t, dur: 0.07, vol: 0.18 });
        this.burst({ t, dur: 0.07, vol: 0.4, filter: 'highpass', fq: 3500 });
        break;
      case 'whiff':
        this.burst({ t, dur: 0.14, vol: 0.2, fq: 900, fq2: 2600, q: 1.2 });
        break;
      case 'special':
        this.tone({ f: 180, f2: 900, type: 'sawtooth', t, dur: 0.4, vol: 0.22 });
        this.burst({ t, dur: 0.4, vol: 0.35, fq: 400, fq2: 3200, q: 2 });
        break;
      case 'boom':
        this.tone({ f: 80, f2: 30, type: 'sine', t, dur: 0.45, vol: 1 });
        this.burst({ t, dur: 0.35, vol: 0.7, filter: 'lowpass', fq: 3500, fq2: 200 });
        break;
      case 'ko':
        this.tone({ f: 70, f2: 22, type: 'sine', t, dur: 1.4, vol: 1 });
        this.tone({ f: 440, f2: 110, type: 'sawtooth', t, dur: 0.9, vol: 0.14 });
        this.burst({ t, dur: 1.2, vol: 0.7, filter: 'lowpass', fq: 5000, fq2: 120, q: 0.6 });
        break;
      case 'gong':
        [98, 147, 196, 294].forEach((f, i) => this.tone({ f, type: 'sine', t, dur: 2.2 - i * 0.25, vol: 0.5 - i * 0.07, attack: 0.01 }));
        this.burst({ t, dur: 0.6, vol: 0.4, filter: 'highpass', fq: 5000 });
        break;
      case 'jump':
        this.tone({ f: 300, f2: 620, type: 'triangle', t, dur: 0.09, vol: 0.12 });
        break;
      case 'land':
        this.burst({ t, dur: 0.07, vol: 0.28, filter: 'lowpass', fq: 700, q: 0.7 });
        break;
    }
  }

  // ---- música --------------------------------------------------------------
  play(name) {
    if (!this.ctx) return;
    if (this.song && this.song.name === name) return;
    this.stop();
    if (MP3[name] && !this.noFiles) { this.playFile(name); return; }
    const def = SONGS[name] || SONGS.select;
    const bus = this.ctx.createGain();
    bus.connect(this.musicBus);
    const send = this.ctx.createGain();
    send.gain.value = 0.35;
    send.connect(this.reverb);
    // cadeia da guitarra: distorção -> corta agudos ásperos -> volume
    const gtrIn = this.ctx.createGain();
    const shaper = this.ctx.createWaveShaper();
    shaper.curve = this.distCurve;
    shaper.oversample = '4x';
    const cab = this.ctx.createBiquadFilter();
    cab.type = 'lowpass';
    cab.frequency.value = 3200;
    const gtrOut = this.ctx.createGain();
    gtrOut.gain.value = 0.16;
    gtrIn.connect(shaper).connect(cab).connect(gtrOut).connect(bus);

    // cada faixa tem o seu volume: cabos próprios para o som direto, o reverb e a guitarra
    const tracks = def.tracks.map((tr) => {
      const mk = (dest) => { const g = this.ctx.createGain(); g.gain.value = tr.vol ?? 1; g.connect(dest); return g; };
      return { inst: tr.inst, notes: parseTrack(tr.notes), bus: mk(bus), send: mk(send), gtrIn: mk(gtrIn) };
    });

    this.song = {
      name, bus, send, tracks,
      stepDur: 60 / def.bpm / (def.spb === 12 ? 3 : 4),
      length: def.bars * def.spb,
      drums: parseDrums(def.drums),
      step: 0,
      next: this.ctx.currentTime + 0.05,
    };
    this.timer = setInterval(() => this.schedule(), 25);
    this.schedule();
  }

  // MP3 em loop, passando pelo mesmo canal de música (volume e mudo do jogo)
  playFile(name) {
    const el = new Audio(`assets/music/${MP3[name]}.mp3?v=${window.WF_VERSION || '1'}`);
    el.loop = true;
    el.preload = 'auto';
    const bus = this.ctx.createGain();
    bus.gain.value = 0;
    this.ctx.createMediaElementSource(el).connect(bus);
    bus.connect(this.musicBus);
    bus.gain.setTargetAtTime(MP3_GAIN, this.ctx.currentTime, 0.12);
    const song = { name, bus, el };
    this.song = song;
    el.play().catch(() => {
      // arquivo indisponível: cai na trilha sintetizada
      if (this.song !== song) return;
      this.song = null;
      bus.disconnect();
      this.noFiles = true;
      this.play(name);
      this.noFiles = false;
    });
  }

  stop(fade = 0.3) {
    if (!this.song) return;
    if (this.song.el) {
      const { bus, el } = this.song;
      bus.gain.setTargetAtTime(0, this.ctx.currentTime, fade / 3);
      setTimeout(() => { el.pause(); el.removeAttribute('src'); el.load(); bus.disconnect(); }, fade * 1000 + 200);
      this.song = null;
      return;
    }
    clearInterval(this.timer);
    const { bus, send } = this.song;
    bus.gain.setTargetAtTime(0, this.ctx.currentTime, fade / 3);
    send.gain.setTargetAtTime(0, this.ctx.currentTime, fade / 3);
    setTimeout(() => { bus.disconnect(); send.disconnect(); }, fade * 1000 + 200);
    this.song = null;
  }

  schedule() {
    const s = this.song;
    if (!s) return;
    while (s.next < this.ctx.currentTime + STEP_AHEAD) {
      this.playStep(s, s.step % s.length, s.next);
      s.next += s.stepDur;
      s.step++;
    }
  }

  voice(inst, tr, note, t, dur, d) {
    switch (inst) {
      case 'flute': this.flute(tr, note, t, dur * 0.97); break;
      case 'strings': this.strings(tr, note, t, dur); break;
      case 'choir': this.choir(tr, note, t, dur); break;
      case 'chug': this.guitar(tr, note, t, d, true); break;
      case 'gtr': this.guitar(tr, note, t, dur * 0.98, false); break;
      case 'bass': this.bass(tr, note, t, dur * 0.9); break;
      case 'brass': this.brass(tr, note, t, dur); break;
      case 'accordion': this.accordion(tr, note, t, dur); break;
      case 'erhu': this.erhu(tr, note, t, dur); break;
      case 'clarinet': this.clarinet(tr, note, t, dur); break;
      case 'balalaika': this.balalaika(tr, note, t, dur); break;
      case 'koto': this.pluck(tr, note, t, { type: 'sawtooth', dur: 0.5, cut: 4200, end: 500, vol: 0.13 }); break;
      case 'harp': this.pluck(tr, note, t, { type: 'triangle', dur: 1.0, cut: 5200, end: 900, vol: 0.2 }); break;
      case 'guzheng': this.pluck(tr, note, t, { type: 'sawtooth', dur: 0.8, cut: 5000, end: 700, vol: 0.13, bend: -0.8 }); break;
      case 'cavaco': this.pluck(tr, note, t, { type: 'square', dur: 0.14, cut: 3800, end: 1500, vol: 0.07 }); break;
      case 'oud': this.pluck(tr, note, t, { type: 'sawtooth', dur: 0.38, cut: 2200, end: 450, vol: 0.2 }); break;
      case 'piano': this.pluck(tr, note, t, { type: 'triangle', dur: 0.55, cut: 3800, end: 800, vol: 0.22, partial: true }); break;
      case 'glead': this.guitarLead(tr, note, t, dur); break;
      case 'synth': this.pluck(tr, note, t, { type: 'square', dur: Math.max(0.18, Math.min(dur, 0.4)), cut: 5200, end: 1400, vol: 0.13 }); break;
      case 'sub': this.sub(tr, note, t, dur); break;
      default: break;
    }
  }

  playStep(s, step, t) {
    const d = s.stepDur;
    for (const tr of s.tracks) {
      for (const e of tr.notes.get(step) || []) this.voice(tr.inst, tr, e.note, t, e.len * d, d);
    }
    for (const kind of s.drums.get(step) || []) this.drum(s, kind, t);
  }
}

export const Sound = new SoundEngine();
export { SONGS, SoundEngine };
