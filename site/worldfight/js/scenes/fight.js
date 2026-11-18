import { Sound } from '../audio.js';
import { COMBAT_VOICES } from '../combat-voices.js';
import { bindControls } from '../controls.js';
import { ALL_FIGHTERS, BOSS, COUNTRIES, FIGHTERS, FONT, H, ORB, W, arcadeText, bossUnlocked, unlockBoss } from '../data.js';
import { CpuBrain } from '../fight/ai.js';
import { ATTACKS, FPS, FightSim, GETUP_FRAMES, HP_MAX, INTRO_FRAMES } from '../fight/sim.js';
import { GROUND_Y, addStage, stageFor } from '../stages.js';
import { Net, packInput, unpackInput } from '../net.js';
import { TouchControls } from '../touch-controls.js';
import { addMuteToggle, addScanlines, say, showNetLost } from '../ui.js';

const STEP_MS = 1000 / FPS;
const FALL_S = 0.5;   // duração da animação de queda (segundos)
const KO_S = 0.72;    // queda desenhada com quique (lançado, cai de lado, quica e fica esparramado)
const BOUNCE_PX = 26; // altura do quique (o quadro do quique sobe e volta ao chão)
const GETUP_S = GETUP_FRAMES / FPS; // levantar dura o mesmo que o estado 'getup' do motor
const SPRITE_H = 300;
const VOICE_GAP_MS = 2400;
const FIGHTER_VOICE_GAP_MS = 5200;
const hex = (n) => `#${n.toString(16).padStart(6, '0')}`;
const byId = (id) => ALL_FIGHTERS.find((f) => f.id === id);
// Online: atraso de entrada (quadros). Cada comando vale NET_DELAY quadros depois de apertado — tempo para
// chegar ao outro lado sem a luta parar. 4 quadros = 67 ms, imperceptível para a maioria das pessoas.
const NET_DELAY = 4;
const NET_STALL_MS = 400;   // parou esperando o outro lado por mais que isto: mostra "AGUARDANDO"
const SYNC_EVERY = 120;     // a cada 2 s os dois lados conferem se a luta continua idêntica
const WIN_POSE_FPS = 9;      // comemoração desenhada (ex.: o "L" do Molusculo): quadros por segundo
// Fim da luta de quem tem comemoração própria: "K.O." → nome + "wins!" do locutor → comemoração com a fala
// de vitória → tela de resultado. Tempos (ms) contados do fim do último round.
// Entrada do chefe final (quadros do motor, 60 por segundo): desce voando de toga, joga a toga fora e cai no chão.
const BOSS_INTRO = 330;
const BOSS_ENTRY = { fly: 96, grab: 132, toss: 156, land: 168, rise: 200, done: 222 };
const FINALE = { name: 1500, wins: 2600, pose: 3600, voice: 3900, result: 7400 };

// Teclas por jogador. No modo Arcade o 1P aceita setas e WASD; no Versus cada um tem o seu lado.
function keyMaps(mode) {
  const K = Phaser.Input.Keyboard.KeyCodes;
  if (mode === 'versus') {
    return [
      { left: [K.A], right: [K.D], up: [K.W], down: [K.S], punch: [K.J], kick: [K.K], block: [K.L] },
      { left: [K.LEFT], right: [K.RIGHT], up: [K.UP], down: [K.DOWN], punch: [K.NUMPAD_ONE, K.COMMA], kick: [K.NUMPAD_TWO, K.PERIOD], block: [K.NUMPAD_THREE, K.FORWARD_SLASH] },
    ];
  }
  return [{ left: [K.A, K.LEFT], right: [K.D, K.RIGHT], up: [K.W, K.UP], down: [K.S, K.DOWN], punch: [K.J, K.Z], kick: [K.K, K.X], block: [K.L, K.C] }, null];
}

export class FightScene extends Phaser.Scene {
  constructor() { super('fight'); }

  create(data) {
    try {
      this.build(data);
    } catch (err) {
      // nunca travar calado: mostra o erro e deixa voltar para a seleção
      console.error(err);
      Sound.stop(0.1);
      this.add.rectangle(W / 2, H / 2, W, H, 0x000000, 0.9).setDepth(200);
      this.add.text(W / 2, H / 2 - 40, 'ERRO AO INICIAR A LUTA', arcadeText(28, '#ff5a3a')).setOrigin(0.5).setDepth(201);
      this.add.text(W / 2, H / 2 + 10, String(err && err.message || err).slice(0, 90), { fontFamily: FONT, fontSize: '11px', color: '#ffffff' }).setOrigin(0.5).setDepth(201);
      this.add.text(W / 2, H / 2 + 60, 'TOQUE OU APERTE ENTER PARA VOLTAR', { fontFamily: FONT, fontSize: '12px', color: '#ffd63a' }).setOrigin(0.5).setDepth(201);
      const back = () => this.scene.start('select', { mode: data.mode || 'arcade' });
      this.input.keyboard.once('keydown', back);
      this.input.once('pointerdown', back);
    }
  }

  build(data) {
    this.mode = data.mode || 'arcade';
    this.online = this.mode === 'online';
    this.ladder = data.ladder || { beaten: [] };
    this.defs = [byId(data.p1), byId(data.p2)];
    // online: o cenário vem sorteado pelo 1P, para os dois verem o mesmo
    const pick = this.mode === 'arcade' ? this.defs[1]
      : this.online ? this.defs[data.stage ? 1 : 0] : Phaser.Utils.Array.GetRandom(this.defs);
    this.cc = pick.country;
    this.stage = stageFor(pick);
    this.acc = 0;
    this.timeScale = 1;
    this.paused = false;
    this.menu = null;
    this.matchOver = false;
    this.leaving = false;
    this.newRoundAt = null;
    this.fadeAt = null;
    this.finale = null;
    this.netLostShown = false;
    this.quitUi = null;
    this.restarting = false;
    this.attackVoice = null;
    this.nextVoiceAt = 0;
    this.fighterVoices = this.defs.map(({ id }) => ({
      clips: (COMBAT_VOICES[id] ?? []).filter((clip) => this.cache.audio.exists(clip)),
      index: 0,
      nextAt: 0,
    }));
    this.cameras.main.fadeIn(300, 0, 0, 0);

    addStage(this, this.stage);
    this.add.rectangle(W / 2, H / 2, W, H, 0x000000, 0.12).setDepth(1);
    this.buildFighters();
    this.buildHud();
    this.fx = this.add.graphics().setDepth(30);
    this.orbTexture();
    this.projSprites = new Map();

    const seed = this.online ? data.seed >>> 0 : (Date.now() ^ (Math.random() * 1e9)) >>> 0;
    // chefe final: mais forte, aguenta mais e tem abertura longa para a entrada voando (só no Arcade)
    // (o Xandão escolhido por um jogador, depois de desbloqueado, luta com força normal)
    this.bossIdx = this.mode === 'arcade' && this.defs[1].boss ? 1 : -1;
    this.bossLanded = false;
    this.sim = this.bossIdx < 0 ? new FightSim({ seed }) : new FightSim({
      seed, power: [1, BOSS.power], armor: [1, BOSS.armor], introFrames: BOSS_INTRO,
    });
    this.ai = this.mode === 'arcade' ? new CpuBrain(1, this.bossIdx === 1 ? 1 : Math.min(0.9, 0.15 + 0.09 * this.ladder.beaten.length)) : null;

    this.setupInput();
    if (this.online) this.setupNet();
    addScanlines(this, 0.1);
    this.mute = addMuteToggle(this, (muted) => { if (muted) this.stopAttackVoice(); });
    this.startRound();

    // tema do cenário; no Brasil, o tema do lutador brasileiro "dono da casa"
    const music = pick.country === 'br' ? `stage-br-${pick.id}` : `stage-${this.cc}`;
    this.time.delayedCall(500, () => Sound.play(music));
    this.events.once('shutdown', () => {
      this.stopAttackVoice();
      Sound.stop(0.2);
      this.input.keyboard.removeAllKeys?.(true);
    });
  }

  // ---- montagem --------------------------------------------------------------
  buildFighters() {
    this.sprites = [];
    this.shadows = [];
    this.views = [];
    const allMeta = this.cache.json.get('anim-meta');
    this.defs.forEach((d, i) => {
      // animações do pacote de personagens: atlas com todos os quadros, pés alinhados na origem
      const meta = allMeta[d.id];
      const img = this.add.sprite(0, GROUND_Y, `anim-${d.id}`, 'idle_0').setOrigin(0.5, meta.originY).setDepth(10 + i);
      img.setScale((SPRITE_H * (d.size || 1)) / meta.bodyH); // size: ajuste de proporção por lutador (data.js)
      img.baseScale = img.scaleX;
      img.fid = d.id;
      img.meta = meta;
      img.bodyHalf = (meta.bodyW * img.baseScale) / 2;
      this.shadows.push(this.add.ellipse(0, GROUND_Y + 4, img.bodyHalf * 1.7, 24, 0x000000, 0.4).setDepth(5));
      this.sprites.push(img);
      this.views.push({ state: 'idle', f0: 0, trail: HP_MAX, flashUntil: 0 });
    });
  }

  buildHud() {
    this.hudGfx = this.add.graphics().setDepth(50);
    this.names = [];
    this.stars = [[], []];
    this.defs.forEach((d, i) => {
      const right = i === 1;
      const portrait = this.add.image(right ? W - 60 : 60, 42, `tile-${d.id}`).setDisplaySize(84, 74).setDepth(51);
      this.add.rectangle(portrait.x, portrait.y, 88, 78).setStrokeStyle(3, 0xc9d4ff).setDepth(51);
      this.names.push(this.add.text(right ? W - 112 : 112, 64, d.name, arcadeText(16, '#ffffff')).setOrigin(right ? 1 : 0, 0).setDepth(51));
      for (let k = 0; k < 2; k++) {
        const x = right ? W - 122 - k * 26 : 122 + k * 26;
        this.stars[i].push(this.add.star(x, 100, 5, 5, 11, 0x333344).setDepth(51));
      }
    });
    this.timerBox = this.add.rectangle(W / 2, 42, 92, 70, 0x000010, 0.9).setStrokeStyle(3, 0xc9d4ff).setDepth(51);
    this.timerText = this.add.text(W / 2, 44, '99', arcadeText(34, '#ffffff')).setOrigin(0.5).setDepth(52); // trocado no 1º quadro pelo tempo do round
    this.banner = this.add.text(W / 2, H * 0.34, '', arcadeText(76)).setOrigin(0.5).setDepth(60).setVisible(false);
    this.subBanner = this.add.text(W / 2, H * 0.34 + 74, '', arcadeText(26, '#ffffff')).setOrigin(0.5).setDepth(60).setVisible(false);
    const touch = this.sys.game.device.input.touch;
    const hint = touch
      ? 'X SOCO   A CHUTE   B DEFESA   Y ESPECIAL   ·   BAIXO+X SOCO FORTE   BAIXO+A RASTEIRA'
      : this.mode === 'versus'
        ? '1P: A/D  W  S  J K L      2P: SETAS  1 2 3'
        : 'A/D ANDAR  W PULAR  S AGACHAR  J SOCO  S+J SOCO FORTE  K CHUTE  S+K RASTEIRA  L DEFESA  BAIXO,FRENTE+J ESPECIAL';
    const tip = this.add.text(W / 2, H - 22, hint, { fontFamily: FONT, fontSize: '10px', color: '#ffffff', stroke: '#000', strokeThickness: 4 })
      .setOrigin(0.5).setDepth(51);
    this.tweens.add({ targets: tip, alpha: 0, delay: 7000, duration: 800 });
  }

  orbTexture() {
    if (this.textures.exists('orb')) return;
    const g = this.make.graphics({ x: 0, y: 0 }, false);
    for (let r = 48; r > 0; r -= 4) g.fillStyle(0xffffff, 0.06 + (1 - r / 48) * 0.22).fillCircle(48, 48, r);
    g.generateTexture('orb', 96, 96);
    g.destroy();
  }

  // ---- entrada ---------------------------------------------------------------
  setupInput() {
    this.maps = keyMaps(this.mode);
    this.keys = [];
    this.pending = [{ punch: false, kick: false }, { punch: false, kick: false }];
    this.touch = { left: false, right: false, up: false, down: false };
    this.touchBlock = false;
    this.touchMacro = [];
    this.padPrev = [{}, {}];
    const kb = this.input.keyboard;
    this.maps.forEach((map, p) => {
      if (!map) return;
      const keys = {};
      for (const [action, codes] of Object.entries(map)) {
        keys[action] = codes.map((code) => kb.addKey(code, true));
        kb.addCapture(codes);
      }
      for (const key of keys.punch) key.on('down', () => { this.pending[p].punch = true; });
      for (const key of keys.kick) key.on('down', () => { this.pending[p].kick = true; });
      this.keys[p] = keys;
    });
    kb.on('keydown-P', () => this.togglePause());
    kb.on('keydown-Q', () => {
      if (this.quitUi) this.quitOnline();
      else if (this.paused) this.leave('select', { mode: this.mode });
    });
    bindControls(this, 'solo', (_p, action) => {
      if (action === 'mute') return this.mute.toggle();
      if (this.menu) return this.menuInput(action);
      if (action === 'back') this.togglePause();
      return undefined;
    });
    if (this.sys.game.device.input.touch) this.buildTouch();
  }

  // celular: direcional 360° à esquerda e botões do Xbox à direita (js/touch-controls.js).
  // X soco · A chute · B defesa (segurar) · Y especial. Baixo + X = soco forte, baixo + A = rasteira.
  buildTouch() {
    const p1 = this.pending[0];
    this.touchPad = new TouchControls(this, [
      { id: 'Y', label: 'ESPECIAL', press: () => { this.touchMacro = [{ down: true }, { down: true }, { fwd: true, punch: true }]; } },
      { id: 'X', label: 'SOCO', press: () => { p1.punch = true; } },
      { id: 'B', label: 'DEFESA', press: () => { this.touchBlock = true; }, release: () => { this.touchBlock = false; } },
      { id: 'A', label: 'CHUTE', press: () => { p1.kick = true; } },
    ], { onPause: () => this.togglePause() });
    this.touch = this.touchPad.state;
  }

  // o botão ESPECIAL faz o comando do teclado (baixo, frente + soco) em três quadros seguidos
  applyTouchMacro(input) {
    const m = this.touchMacro.shift();
    const face = this.sim.fighters[0].face;
    input.up = false;
    input.down = !!m.down;
    input.right = !!m.fwd && face === 1;
    input.left = !!m.fwd && face === -1;
    if (m.punch) input.punch = true;
  }

  pollPad(p) {
    const pads = navigator.getGamepads ? navigator.getGamepads() : [];
    const pad = pads[this.mode === 'versus' ? p : 0];
    if (!pad) return null;
    const b = (i) => !!pad.buttons[i]?.pressed;
    const ax = pad.axes[0] || 0;
    const ay = pad.axes[1] || 0;
    const now = {
      left: ax < -0.5 || b(14), right: ax > 0.5 || b(15), up: ay < -0.6 || b(12), down: ay > 0.6 || b(13),
      punch: b(0) || b(3), kick: b(2) || b(1), block: b(4) || b(5) || b(6) || b(7),
    };
    const prev = this.padPrev[p];
    if (now.punch && !prev.punch) this.pending[p].punch = true;
    if (now.kick && !prev.kick) this.pending[p].kick = true;
    this.padPrev[p] = now;
    return now;
  }

  humanInput(p) {
    const keys = this.keys[p];
    const pad = this.pads?.[p];
    const down = (action) => !!(keys && keys[action].some((k) => k.isDown)) || !!(pad && pad[action]) || (p === 0 && !!this.touch[action]);
    const input = {
      left: down('left'), right: down('right'), up: down('up'), down: down('down'),
      block: down('block') || (p === 0 && this.touchBlock),
      punch: this.pending[p].punch, kick: this.pending[p].kick,
    };
    this.pending[p].punch = false;
    this.pending[p].kick = false;
    if (p === 0 && this.touchMacro.length) this.applyTouchMacro(input);
    return input;
  }

  // ---- laço principal ----------------------------------------------------------
  update(_t, delta) {
    if (this.paused) return;
    this.pads = [this.pollPad(0), this.mode === 'versus' ? this.pollPad(1) : null];
    this.acc += Math.min(delta, 100) * this.timeScale;
    let steps = 0;
    while (this.acc >= STEP_MS && steps < 6) {
      let inputs;
      if (this.online) {
        if (this.matchOver) { this.acc = 0; break; } // fim da luta: os dois param no mesmo quadro
        inputs = this.netInputs();
        if (!inputs) { this.acc = Math.min(this.acc, STEP_MS); break; } // falta o comando do outro lado: espera
      } else {
        inputs = [this.humanInput(0), this.mode === 'versus' ? this.humanInput(1) : this.ai.next(this.sim)];
      }
      this.acc -= STEP_MS;
      steps++;
      this.handleEvents(this.sim.step(inputs));
      this.stepEffects();
      if (this.fadeAt != null && this.sim.frame >= this.fadeAt) { this.fadeAt = null; this.cameras.main.fadeOut(220, 0, 0, 0); }
      if (this.newRoundAt != null && this.sim.frame >= this.newRoundAt) this.beginNextRound();
      if (this.online && this.sim.frame % SYNC_EVERY === 0) this.sendSync();
    }
    if (this.online) this.netStatus();
    this.render();
  }

  // ---- eventos da simulação --------------------------------------------------------
  handleEvents(events) {
    for (const e of events) {
      switch (e.t) {
        case 'attack':
          if (e.kind !== 'special') Sound.sfx('whiff');
          this.playAttackVoice(e.p);
          break;
        case 'special': Sound.sfx('special'); break;
        case 'jump': Sound.sfx('jump'); this.dust(e.x, 5); break;
        case 'land': Sound.sfx('land'); this.dust(e.x, 7); break;
        case 'hit': this.onHit(e); break;
        case 'projectileHit': this.spark(e.x, GROUND_Y - e.y, e.blocked ? 0x9fc2ff : 0xffb12a, 1.6); Sound.sfx(e.blocked ? 'block' : 'boom'); break;
        case 'ko': this.onKo(e); break;
        case 'roundEnd': this.onRoundEnd(e); break;
        case 'phase': if (e.phase === 'ended') this.onRoundEnded(); break;
        default: break;
      }
    }
  }

  // Fala de vitória do lutador (voice/win-<id>.mp3, ex.: "Faz o L, meu filho!"): 1,2 s depois do fim do round,
  // logo após o "K.O." / "Time over" do locutor e enquanto ele faz a comemoração desenhada (animação "win").
  hasWinVoice(i) {
    return i >= 0 && this.cache.audio.exists(`voice-win-${this.defs[i].id}`);
  }

  winVoice(i, delay = 1200) {
    if (!this.hasWinVoice(i)) return;
    const key = `win-${this.defs[i].id}`;
    this.stopAttackVoice();
    const dur = this.cache.audio.get(`voice-${key}`)?.duration || 2.8;
    this.winVoiceUntil = this.time.now + delay + dur * 1000;
    say(this, key, delay);
  }

  // anúncio do resultado só depois da fala de vitória, para as vozes não se atropelarem
  afterWinVoice(ms) {
    return ms + Math.max(0, (this.winVoiceUntil || 0) - this.time.now);
  }

  playAttackVoice(player) {
    const now = this.time.now;
    const voice = this.fighterVoices[player];
    if (Sound.muted || this.leaving || !voice.clips.length ||
        now < this.nextVoiceAt || now < voice.nextAt || this.attackVoice?.isPlaying) return;

    this.stopAttackVoice();
    const sound = this.sound.add(voice.clips[voice.index], { volume: 0.7 });
    if (!sound.play()) {
      sound.destroy();
      return;
    }
    this.attackVoice = sound;
    sound.once('complete', () => this.stopAttackVoice());
    voice.index = (voice.index + 1) % voice.clips.length;
    voice.nextAt = now + FIGHTER_VOICE_GAP_MS;
    this.nextVoiceAt = now + VOICE_GAP_MS;
  }

  stopAttackVoice() {
    this.attackVoice?.destroy();
    this.attackVoice = null;
  }

  onHit(e) {
    const y = GROUND_Y - e.y;
    const heavy = e.power >= 130;
    this.views[e.target].flashUntil = this.sim.frame + (e.blocked ? 0 : 4);
    if (e.blocked) {
      Sound.sfx('block');
      this.spark(e.x, y, 0x9fc2ff, 0.9);
    } else {
      Sound.sfx(heavy || e.kind === 'kick' || e.kind === 'sweep' ? 'kick' : 'punch');
      // golpe forte (ou rasteira que derruba): quem apanhou geme; no nocaute o grito vem em onKo
      const hurt = this.sim.fighters[e.target];
      if ((heavy || e.kind === 'sweep') && hurt.hp > 0 && this.time.now >= (this.views[e.target].hurtAt || 0)) {
        this.views[e.target].hurtAt = this.time.now + 700;
        this.time.delayedCall(60, () => Sound.sfx(`hurt-${this.defs[e.target].id}`));
      }
      this.spark(e.x, y, heavy ? 0xff6a1a : 0xffe14a, heavy ? 1.5 : 1.1);
      this.cameras.main.shake(heavy ? 130 : 80, heavy ? 0.007 : 0.0035);
    }
  }

  onKo(e) {
    Sound.sfx('ko');
    // grito de quem foi nocauteado, como no fliperama
    if (e?.p != null) this.time.delayedCall(90, () => Sound.sfx(`scream-${this.defs[e.p].id}`));
    say(this, 'ko', 450);
    this.cameras.main.flash(260, 255, 255, 255);
    this.cameras.main.shake(380, 0.014);
    this.timeScale = 0.3;
    this.time.delayedCall(900, () => { this.timeScale = 1; });
    this.showBanner('K.O.!', { color: '#ff3b2f', hold: 1800 });
  }

  onRoundEnd(e) {
    if (e.reason === 'time') {
      this.showBanner(e.winner < 0 ? 'EMPATE' : 'TEMPO!', { hold: 1500 });
      say(this, e.winner < 0 ? 'draw' : 'timeover');
    }
    const w = e.winner;
    const celebrates = w >= 0 && !!this.sprites[w].meta.anims.win;
    // última luta de quem tem comemoração própria: anúncio do vencedor primeiro, a pose depois (ver FINALE)
    if (celebrates && this.sim.fighters[w].wins >= 2) {
      const now = this.time.now;
      // o resultado só entra depois que a fala de vitória termina (cada lutador tem a sua duração)
      const voiceMs = (this.cache.audio.get(`voice-win-${this.defs[w].id}`)?.duration || 2.8) * 1000;
      this.finale = { w, poseAt: now + FINALE.pose, resultAt: now + Math.max(FINALE.result, FINALE.voice + voiceMs + 500) };
      this.time.delayedCall(FINALE.name, () => this.showBanner(this.defs[w].name, { sub: 'VENCEU!', hold: FINALE.pose - FINALE.name - 300, scaleFrom: 2 }));
      say(this, this.defs[w].id, FINALE.name);
      say(this, 'wins', FINALE.wins);
      if (e.perfect) this.time.delayedCall(FINALE.voice, () => this.showBanner('PERFEITO!', { color: '#ffffff', hold: 1500 }));
      this.winVoice(w, FINALE.voice);
      this.updateStars();
      return;
    }
    this.finale = null;
    if (e.perfect) {
      this.time.delayedCall(1500, () => this.showBanner('PERFEITO!', { color: '#ffffff', hold: 1500 }));
      if (!this.hasWinVoice(w)) say(this, 'perfect', 1550); // com fala de vitória, só o letreiro
    }
    this.winVoice(w);
    this.updateStars();
  }

  onRoundEnded() {
    const [a, b] = this.sim.fighters;
    if (a.wins >= 2 || b.wins >= 2) {
      this.matchOver = true;
      const wait = this.finale ? Math.max(500, this.finale.resultAt - this.time.now) : 500;
      this.time.delayedCall(wait, () => this.showResult());
      return;
    }
    // o round novo começa num quadro fixo do motor (não no fim do escurecimento da tela, que varia de
    // aparelho para aparelho): assim, no online, os dois lados reiniciam exatamente no mesmo quadro
    this.fadeAt = this.sim.frame;
    this.newRoundAt = this.fadeAt + 14;
  }

  beginNextRound() {
    this.newRoundAt = null;
    this.sim.newRound();
    this.projSprites.forEach((s) => s.destroy());
    this.projSprites.clear();
    this.views.forEach((v) => { v.trail = HP_MAX; v.state = 'idle'; });
    this.cameras.main.fadeIn(220, 0, 0, 0);
    this.startRound();
  }

  // ---- rounds e letreiros -------------------------------------------------------------
  startRound() {
    this.stopAttackVoice();
    const [a, b] = this.sim.fighters;
    const n = a.wins + b.wins + 1;
    this.updateStars();
    const final = a.wins === 1 && b.wins === 1;
    // 1º round contra o chefe: o anúncio do round espera a entrada voando terminar
    const entry = this.bossIdx >= 0 && n === 1;
    const intro = entry ? BOSS_INTRO : INTRO_FRAMES;
    const roundAt = entry ? (BOSS_ENTRY.done / FPS) * 1000 + 150 : 350;
    if (entry) this.bossEntryStart();
    this.time.delayedCall(roundAt, () => this.showBanner(final ? 'ROUND FINAL' : `ROUND ${n}`, { hold: 1300 }));
    say(this, final ? 'roundfinal' : `round${n}`, roundAt + 30);
    const fightAt = (intro / FPS) * 1000 - 700;
    this.time.delayedCall(fightAt, () => {
      say(this, 'fight');
      this.nextVoiceAt = Math.max(this.nextVoiceAt || 0, this.time.now + 1200); // fala de combate só depois do "Fight!"
      this.showBanner('LUTEM!', { color: '#ffffff', hold: 900, scaleFrom: 3 });
    });
  }

  // ---- chefe final: entrada voando ---------------------------------------------------------------
  bossEntryStart() {
    if (!this.sprites[this.bossIdx].meta.anims.intro) return;
    Sound.sfx('whoosh');
    this.showBanner('DESAFIO FINAL', { color: '#ff3b2f', hold: 1500, scaleFrom: 1.6 });
  }

  // quadro e altura do chefe durante a entrada do 1º round (null = já está lutando normalmente)
  bossEntryPose(s) {
    const m = this.sprites[this.bossIdx].meta.anims.intro;
    if (!m || s.frame > BOSS_ENTRY.done || s.fighters[0].wins + s.fighters[1].wins > 0) return null;
    const k = s.frame;
    const E = BOSS_ENTRY;
    const hover = -95;
    if (k < E.fly) { // desce voando, a toga balançando
      const p = k / E.fly;
      return { frame: `intro_${Math.floor(k / 8) % 2}`, dy: -560 + (560 + hover) * (1 - (1 - p) * (1 - p)) };
    }
    if (k < E.grab) return { frame: 'intro_2', dy: hover };
    if (k < E.toss) return { frame: 'intro_3', dy: hover };
    if (k < E.land) { // cai no chão
      const p = (k - E.toss) / (E.land - E.toss);
      return { frame: 'intro_3', dy: hover * (1 - p * p) };
    }
    if (!this.bossLanded) {
      this.bossLanded = true;
      Sound.sfx('slam');
      say(this, 'boss-moraes', 250);
      this.cameras.main.shake(320, 0.016);
      this.dust(s.fighters[this.bossIdx].x, 12);
    }
    if (k < E.rise) return { frame: 'intro_4', dy: 0 };
    return { frame: `intro_${Math.min(m.frames - 1, 5)}`, dy: 0 };
  }

  showBanner(text, { color = '#ffd63a', hold = 1200, scaleFrom = 2.4, sub = '' } = {}) {
    this.banner.setText(text).setColor(color).setVisible(true).setAlpha(1).setScale(scaleFrom);
    this.tweens.killTweensOf(this.banner);
    this.tweens.add({ targets: this.banner, scale: 1, duration: 260, ease: 'Back.easeOut' });
    this.tweens.add({ targets: this.banner, alpha: 0, delay: hold, duration: 250, onComplete: () => this.banner.setVisible(false) });
    this.subBanner.setVisible(!!sub).setText(sub).setAlpha(1);
    if (sub) this.tweens.add({ targets: this.subBanner, alpha: 0, delay: hold, duration: 250 });
  }

  updateStars() {
    this.sim.fighters.forEach((f, i) => this.stars[i].forEach((s, k) => s.setFillStyle(k < f.wins ? 0xffd63a : 0x333344)));
  }

  // ---- efeitos ---------------------------------------------------------------------------
  spark(x, y, color, scale = 1) {
    const star = this.add.star(x, y, 8, 8 * scale, 36 * scale, color).setDepth(40).setBlendMode(Phaser.BlendModes.ADD);
    const core = this.add.circle(x, y, 16 * scale, 0xffffff).setDepth(41).setBlendMode(Phaser.BlendModes.ADD);
    this.tweens.add({ targets: star, scale: 1.7, alpha: 0, angle: 40, duration: 220, onComplete: () => star.destroy() });
    this.tweens.add({ targets: core, scale: 0.2, alpha: 0, duration: 160, onComplete: () => core.destroy() });
    for (let i = 0; i < 6; i++) {
      const a = (Math.PI * 2 * i) / 6 + Math.random() * 0.5;
      const bit = this.add.circle(x, y, 3 + Math.random() * 3, color).setDepth(40);
      this.tweens.add({ targets: bit, x: x + Math.cos(a) * 70 * scale, y: y + Math.sin(a) * 70 * scale, alpha: 0, duration: 260, onComplete: () => bit.destroy() });
    }
  }

  dust(x, n) {
    for (let i = 0; i < n; i++) {
      const puff = this.add.circle(x + (Math.random() - 0.5) * 80, GROUND_Y - 2, 5 + Math.random() * 7, 0xe8e0d0, 0.55).setDepth(6);
      this.tweens.add({ targets: puff, x: puff.x + (Math.random() - 0.5) * 70, y: puff.y - 14 - Math.random() * 16, alpha: 0, scale: 1.8, duration: 380, onComplete: () => puff.destroy() });
    }
  }

  stepEffects() {
    const s = this.sim;
    for (const p of s.projectiles) {
      let orb = this.projSprites.get(p);
      if (!orb) {
        const [core, glow] = ORB[this.defs[p.owner].country] || ORB.us;
        orb = this.add.container(p.x, GROUND_Y - p.y).setDepth(25);
        orb.add([
          this.add.image(0, 0, 'orb').setTint(glow).setScale(1.7).setBlendMode(Phaser.BlendModes.ADD),
          this.add.image(0, 0, 'orb').setTint(core).setScale(0.9).setBlendMode(Phaser.BlendModes.ADD),
        ]);
        orb.colors = [core, glow];
        this.projSprites.set(p, orb);
      }
      orb.setPosition(p.x, GROUND_Y - p.y).setScale(1 + 0.12 * Math.sin(p.t * 0.6));
      if (p.t % 2 === 0) {
        const tr = this.add.circle(p.x - Math.sign(p.vx) * 24, GROUND_Y - p.y, 18, orb.colors[1], 0.45).setDepth(24).setBlendMode(Phaser.BlendModes.ADD);
        this.tweens.add({ targets: tr, alpha: 0, scale: 0.2, duration: 260, onComplete: () => tr.destroy() });
      }
    }
    for (const [p, sprite] of this.projSprites) {
      if (!s.projectiles.includes(p)) { sprite.destroy(); this.projSprites.delete(p); }
    }
  }

  // ---- desenho a cada quadro --------------------------------------------------------------------
  render() {
    const s = this.sim;
    const time = (s.frame * 1000) / FPS;
    this.fx.clear();
    s.fighters.forEach((f, i) => {
      const v = this.views[i];
      if (v.state !== f.state) { v.state = f.state; v.f0 = s.frame; v.fell = false; }
      const t = (s.frame - v.f0) / FPS;
      const spr = this.sprites[i];
      const pose = this.pose(f, v, t, time, s.frame, spr.bodyHalf);
      let frameName = this.frameFor(f, spr.meta, t, time);
      const entry = i === this.bossIdx ? this.bossEntryPose(s) : null;
      if (entry) { frameName = entry.frame; pose.dy += entry.dy; }
      if (spr.frame.name !== frameName) spr.setFrame(frameName);
      // corpo batendo no chão: no quadro "bate" da queda desenhada (o anterior ao quique)
      const ko = spr.meta.anims.ko;
      if ((f.state === 'down' || f.state === 'ko') && ko?.bounce != null && !v.fell && (t / KO_S) * ko.frames >= ko.bounce - 1) {
        v.fell = true;
        Sound.sfx('fall');
      }
      // a comemoração desenhada não espelha (o "L" do Molusculo ficaria ao contrário): o corpo já está de frente.
      // winFlip (data.js): gesto apontado para o derrotado (o polegar para baixo do Xandão) espelha normalmente
      spr.setFlipX(f.face === -1 && !(f.state === 'win' && spr.meta.anims.win && !this.defs[f.index].winFlip));
      spr.setPosition(f.x + pose.dx * f.face, GROUND_Y - f.y + pose.dy);
      spr.setScale(spr.baseScale * pose.sx, spr.baseScale * pose.sy);
      spr.setAngle(pose.lean * f.face);
      // lampejo branco do golpe (Phaser 4: setTintFill saiu; agora é tinta + modo FILL)
      if (s.frame < v.flashUntil) spr.setTint(0xffffff).setTintMode(Phaser.TintModes.FILL);
      else if (pose.tint) spr.setTint(pose.tint).setTintMode(Phaser.TintModes.MULTIPLY);
      else spr.clearTint().setTintMode(Phaser.TintModes.MULTIPLY);
      this.placeShadow(f, i, pose, t);
      this.drawSlash(f);
      // faixa vermelha do dano recente
      v.trail = Math.max(f.hp, v.trail - 4);
    });
    this.drawHud();
    this.timerText.setText(String(Math.max(0, Math.ceil(s.timer / FPS)))).setColor(s.timer < 10 * FPS ? '#ff5a3a' : '#ffffff');
  }

  // Quadro da animação para o estado atual. Nos golpes, o "quadro de impacto" da animação cai
  // exatamente nos quadros em que o golpe acerta no motor; antes dele, a preparação; depois, a volta.
  frameFor(f, m, t, time) {
    const anim = (name) => m.alias[name] || name;
    const count = (name) => m.anims[name].frames;
    const loop = (name, ms) => `${name}_${Math.floor(time / ms) % count(name)}`;
    switch (f.state) {
      case 'idle': return loop('idle', 110);
      case 'win': // comemoração própria (ex.: o "L" do Molusculo): toca uma vez e segura o último quadro
        if (m.anims.win) {
          // fim da luta: espera o anúncio do vencedor ("Molusculo… wins!") parado na guarda, depois comemora
          let tp = t;
          if (this.finale && this.finale.w === f.index) {
            tp = (this.time.now - this.finale.poseAt) / 1000;
            if (tp < 0) return loop('idle', 110);
          }
          const n = m.anims.win.frames;
          const k = Math.floor(tp * (this.defs[f.index].winFps || WIN_POSE_FPS)); // winFps: ritmo próprio (ex.: dança)
          // winLoop (data.js): comemoração que repete a partir desse quadro, ex.: a dancinha do Trumpete
          const from = this.defs[f.index].winLoop;
          if (from != null && k >= n) return `win_${from + ((k - from) % (n - from))}`;
          return `win_${Math.min(n - 1, k)}`;
        }
        return loop('idle', 110);
      case 'walk': return loop(f.vx * f.face >= 0 ? 'walkf' : 'walkb', 80);
      case 'crouch': return `crouch_${Math.min(m.anims.crouch.low, Math.floor(t * 40))}`;
      case 'blockstun': // defesa: braços na frente e o arco azul do impacto
        if (f.crouch || !m.anims.block) return f.crouch ? `crouch_${m.anims.crouch.low}` : 'idle_0';
        return `block_${Math.min(m.anims.block.frames - 2, 2 + Math.floor(t * 30))}`;
      case 'jump': {
        const n = count('jump');
        const p = Math.min(1, Math.max(0, (17 - f.vy) / 34)); // 0 = decolando, 1 = pousando
        return `jump_${1 + Math.round(p * (n - 3))}`;
      }
      case 'down': case 'ko': { // cai e fica deitado no último quadro
        if (!m.anims.ko) return 'idle_0';
        const span = m.anims.ko.bounce != null ? KO_S : FALL_S;
        return `ko_${Math.min(m.anims.ko.frames - 1, Math.floor((t / span) * m.anims.ko.frames))}`;
      }
      case 'getup': // levanta: animação própria quando existe; senão a queda ao contrário
        if (m.anims.getup) return `getup_${Math.min(m.anims.getup.frames - 1, Math.floor((t / GETUP_S) * m.anims.getup.frames))}`;
        if (m.anims.ko) return `ko_${Math.max(0, m.anims.ko.frames - 1 - Math.floor((t / GETUP_S) * m.anims.ko.frames))}`;
        return 'idle_0';
      case 'attack': break;
      default: return 'idle_0';
    }
    const def = ATTACKS[f.atk.kind];
    const name = anim({ punch: 'jab', cpunch: 'strong', kick: 'highkick', sweep: 'lowkick', special: 'special', jpunch: 'jab', jkick: 'highkick' }[f.atk.kind]);
    const a = m.anims[name];
    const k = a.impact;
    const n = a.frames;
    const at = f.atk.t;
    let idx;
    if (def.air) idx = at < def.su ? Math.floor((at / def.su) * k) : k;
    else if (at < def.su) idx = Math.floor((at / def.su) * k);
    else if (at < def.su + def.act) idx = k;
    else idx = Math.min(n - 1, k + 1 + Math.floor(((at - def.su - def.act) / def.rec) * (n - 1 - k)));
    return `${name}_${idx}`;
  }

  // Sombra no chão: acompanha o lutador, encolhe e clareia no pulo, se alonga quando ele cai.
  placeShadow(f, i, pose, t) {
    const sh = this.shadows[i];
    const half = this.sprites[i].bodyHalf;
    const air = Math.min(1, f.y / 240);
    // deitado: a sombra se alonga junto com o corpo (queda) e volta ao normal ao levantar
    const lying = f.state === 'down' || f.state === 'ko' ? Math.min(1, t / FALL_S)
      : f.state === 'getup' ? Math.max(0, 1 - t / GETUP_S) : 0;
    const reach = f.state === 'attack' && f.atk && (f.atk.kind === 'kick' || f.atk.kind === 'sweep') ? 0.3 : 0;
    const width = half * 1.7 * (1 - air * 0.5) * (1 + lying * 0.9 + reach);
    // luz vindo de cima e um pouco da esquerda: a sombra cai levemente para a direita
    // queda antiga: o corpo deitado se estende para trás; a queda desenhada com quique já vem centrada
    const back = this.sprites[i].meta.anims.ko?.bounce != null ? 0 : 0.8;
    const x = f.x + pose.dx * f.face + 14 - f.face * lying * half * back + f.face * reach * half * 0.5;
    sh.setPosition(x, GROUND_Y + 4).setSize(width, 24 * (1 - air * 0.35)).setAlpha(0.42 - air * 0.22);
  }

  pose(f, v, t, time, frame, half) {
    let dx = 0, dy = 0, sx = 1, sy = 1, lean = 0, tint = null;
    switch (f.state) {
      case 'idle': break;
      case 'walk': // quem não tem animação de andar (Lula) ganha o balanço do passo
        if (this.sprites[f.index].meta.noWalk) {
          dy = -Math.abs(Math.sin(time / 95)) * 9;
          lean = f.vx * f.face > 0 ? 4 : -3;
        }
        break;
      case 'crouch': break;
      case 'jump':
        lean = f.vx * f.face > 0 ? 9 : f.vx * f.face < 0 ? -9 : 0;
        break;
      case 'attack': ({ dx, lean } = this.attackPose(f)); break;
      case 'hit':
        dx = -(12 * Math.max(0, 1 - t / 0.25)) + (frame % 2 ? 2 : -2);
        lean = -11 * Math.max(0.3, 1 - t / 0.3);
        break;
      case 'blockstun': dx = -6; break; // a animação de defesa já mostra o bloqueio
      case 'down': case 'ko': case 'getup': { // a queda e a levantada vêm desenhadas (animação "ko")
        const ko = this.sprites[f.index].meta.anims.ko;
        if (ko && ko.bounce != null && f.state !== 'getup') { // quique: o quadro do quique sobe e volta ao chão
          const ft = (t / KO_S) * ko.frames;
          if (Math.floor(ft) === ko.bounce) dy = -Math.sin((ft - ko.bounce) * Math.PI) * BOUNCE_PX;
        }
        if (!ko) {
          const p = f.state === 'getup' ? Math.max(0, 1 - t / 0.4) : Math.min(1, t / 0.2);
          lean = -84 * p;
          dy = -half * Math.sin((Math.abs(lean) * Math.PI) / 180) * 0.88;
        }
        break;
      }
      case 'win': // sem comemoração desenhada, o lutador pula de alegria
        if (!this.sprites[f.index].meta.anims.win) dy = -Math.abs(Math.sin(t * 5)) * 16;
        break;
      default: break;
    }
    if (f.hitstop > 0 && f.state !== 'hit') dx += frame % 2 ? 2 : -2;
    return { dx, dy, sx, sy, lean, tint };
  }

  // O membro já se estende no quadro desenhado; aqui só o peso do corpo: avança no soco,
  // inclina para trás no chute (contrapeso) e vem para a frente na rasteira.
  attackPose(f) {
    const def = ATTACKS[f.atk.kind];
    const t = f.atk.t;
    const u = t < def.su ? -(t / def.su) : def.air ? 1 : Math.max(0, 1 - (t - def.su) / (def.act + def.rec));
    const fwd = Math.max(u, 0);
    const wind = Math.max(-u, 0);
    // as animações já trazem o movimento do corpo; aqui só um empurrão leve de peso
    switch (f.atk.kind) {
      case 'punch': case 'cpunch': case 'special': return { dx: 6 * fwd - 3 * wind, lean: 0 };
      case 'jpunch': case 'jkick': return { dx: 0, lean: 5 };
      default: return { dx: 4 * fwd, lean: 0 };
    }
  }

  // Risco branco curvo no alcance do golpe enquanto ele está ativo.
  drawSlash(f) {
    if (!this.sim.isActive(f)) return;
    const def = ATTACKS[f.atk.kind];
    const mid = GROUND_Y - (f.y + (def.y0 + def.y1) / 2);
    const cx = f.x + f.face * ((def.x0 + def.x1) / 2 - 30);
    const r = (def.x1 - def.x0) / 2 + 20;
    const a0 = f.face === 1 ? -1.0 : Math.PI - 0.6;
    const a1 = f.face === 1 ? 0.6 : Math.PI + 1.0;
    const low = !!def.low;
    // rastro discreto: o braço/perna desenhado é que mostra o golpe
    this.fx.lineStyle(low ? 6 : 8, 0xffffff, 0.28).beginPath().arc(cx, mid, r, a0, a1).strokePath();
  }

  drawHud() {
    const g = this.hudGfx;
    g.clear();
    this.sim.fighters.forEach((f, i) => {
      const v = this.views[i];
      const x0 = i === 0 ? 112 : 716;
      const w = 452;
      g.fillStyle(0x000000, 0.9).fillRect(x0 - 5, 17, w + 10, 38);
      g.fillStyle(0x3a0a00, 1).fillRect(x0, 22, w, 28);
      const bar = (amount, color) => {
        const ww = (w * amount) / HP_MAX;
        g.fillStyle(color, 1).fillRect(i === 0 ? x0 + w - ww : x0, 22, ww, 28);
      };
      bar(v.trail, 0xe0261c);
      bar(f.hp, f.hp < 250 ? 0xff7a1a : 0xffd63a);
      const ww = (w * f.hp) / HP_MAX;
      g.fillStyle(0xffffff, 0.28).fillRect(i === 0 ? x0 + w - ww : x0, 22, ww, 8);
      g.lineStyle(3, 0xc9d4ff, 1).strokeRect(x0 - 3, 19, w + 6, 34);
    });
  }

  // ---- pausa e resultado ----------------------------------------------------------------------
  togglePause() {
    if (this.menu || this.leaving) return;
    if (this.online) { this.toggleQuitMenu(); return; } // online não pausa: a luta segue para o outro lado
    this.paused = !this.paused;
    if (this.paused) {
      this.stopAttackVoice();
      Sound.ctx?.suspend();
      this.pauseUi = [
        this.add.rectangle(W / 2, H / 2, W, H, 0x000000, 0.65).setDepth(90),
        this.add.text(W / 2, H / 2 - 30, 'PAUSADO', arcadeText(48)).setOrigin(0.5).setDepth(91),
      ];
      if (this.touchPad) {
        // no celular: toque em qualquer lugar continua; SAIR volta para a escolha de lutador
        this.touchPad.setEnabled(false);
        this.pauseUi[0].setInteractive().on('pointerdown', () => this.togglePause());
        const quit = this.add.text(W / 2, H / 2 + 110, 'SAIR DA LUTA', arcadeText(20, '#ffffff')).setOrigin(0.5).setDepth(91)
          .setInteractive({ useHandCursor: true });
        quit.on('pointerdown', () => { Sound.ctx?.resume(); this.leave('select', { mode: this.mode }); });
        this.pauseUi.push(
          this.add.text(W / 2, H / 2 + 40, 'TOQUE PARA CONTINUAR', { fontFamily: FONT, fontSize: '14px', color: '#ffffff' }).setOrigin(0.5).setDepth(91),
          quit,
        );
      } else {
        this.pauseUi.push(this.add.text(W / 2, H / 2 + 40, 'P / ESC: CONTINUAR      Q: SAIR', { fontFamily: FONT, fontSize: '14px', color: '#ffffff' }).setOrigin(0.5).setDepth(91));
      }
    } else {
      Sound.ctx?.resume();
      this.pauseUi?.forEach((o) => o.destroy());
      this.pauseUi = null;
      this.touchPad?.setEnabled(true);
    }
  }

  showResult() {
    this.stopAttackVoice();
    this.touchPad?.setEnabled(false);
    const [a, b] = this.sim.fighters;
    const winner = a.wins >= 2 ? 0 : 1;
    const w = this.defs[winner];
    const arcade = this.mode === 'arcade';
    const items = [];
    let title;
    let sub;
    if (arcade && winner === 0 && this.defs[1].boss) {
      // venceu o chefe final: zerou o jogo e libera o Xandão (guardado no navegador)
      const novo = !bossUnlocked();
      unlockBoss();
      title = 'VOCÊ ZEROU O JOGO!';
      say(this, 'champion', this.afterWinVoice(300));
      sub = novo ? 'XANDÃO DESBLOQUEADO! AGORA ELE APARECE NA SELEÇÃO' : `${w.name} DERROTOU O CHEFE FINAL · CAMPEÃO DO WORLD FIGHTER`;
      items.push({ label: 'VOLTAR AO MENU', run: () => this.leave('title') });
      this.celebrate();
    } else if (arcade && winner === 0) {
      this.ladder.beaten.push(this.defs[1].id);
      const rivals = FIGHTERS.filter((f) => f.id !== this.defs[0].id);
      const remaining = rivals.filter((f) => !this.ladder.beaten.includes(f.id));
      if (remaining.length === 0) {
        // venceu todos: falta o chefe final
        title = 'VOCÊ VENCEU TODOS!';
        say(this, 'youwin', this.afterWinVoice(300));
        sub = 'MAS AINDA FALTA O CHEFE FINAL...';
        items.push({ label: 'DESAFIO FINAL', run: () => this.leave('versus', { mode: this.mode, p1: this.defs[0].id, p2: BOSS.id, ladder: this.ladder }) });
      } else {
        title = 'VOCÊ VENCEU!';
        say(this, 'youwin', this.afterWinVoice(300));
        sub = `${this.ladder.beaten.length} DE ${rivals.length} ADVERSÁRIOS`;
        const next = Phaser.Utils.Array.GetRandom(remaining);
        items.push({ label: 'PRÓXIMA LUTA', run: () => this.leave('versus', { mode: this.mode, p1: this.defs[0].id, p2: next.id, ladder: this.ladder }) });
        items.push({ label: 'ESCOLHER LUTADOR', run: () => this.leave('select', { mode: this.mode }) });
      }
    } else if (arcade) {
      title = 'VOCÊ PERDEU';
      say(this, 'youlose', this.afterWinVoice(300));
      sub = `${w.name} VENCEU`;
      items.push({ label: 'TENTAR DE NOVO', run: () => this.leave('versus', { mode: this.mode, p1: this.defs[0].id, p2: this.defs[1].id, ladder: this.ladder }) });
      items.push({ label: 'ESCOLHER LUTADOR', run: () => this.leave('select', { mode: this.mode }) });
    } else if (this.online) {
      const won = winner === this.side;
      title = won ? 'VOCÊ VENCEU!' : 'VOCÊ PERDEU';
      say(this, won ? 'youwin' : 'youlose', this.afterWinVoice(300));
      sub = this.rematch.them ? 'O OPONENTE QUER REVANCHE!' : `${w.name} VENCEU`;
      items.push({ label: 'REVANCHE', run: () => this.askRematch() });
      items.push({ label: 'TROCAR LUTADOR', run: () => { Net.send({ t: 'reselect' }); this.leave('select', { mode: 'online' }); } });
      items.push({ label: 'SAIR', run: () => this.quitOnline() });
    } else {
      title = `${w.name} VENCEU!`;
      if (!this.finale) { // com a comemoração, o nome e o "wins!" já foram anunciados
        say(this, w.id, this.afterWinVoice(300));
        say(this, 'wins', this.afterWinVoice(1250));
      }
      sub = `JOGADOR ${winner + 1}`;
      items.push({ label: 'REVANCHE', run: () => this.leave('versus', { mode: this.mode, p1: this.defs[0].id, p2: this.defs[1].id }) });
      items.push({ label: 'ESCOLHER LUTADORES', run: () => this.leave('select', { mode: this.mode }) });
    }
    this.add.rectangle(W / 2, H / 2, W, H, 0x000000, 0.62).setDepth(90);
    this.add.text(W / 2, 170, title, arcadeText(54)).setOrigin(0.5).setDepth(91);
    this.resultSub = this.add.text(W / 2, 236, sub, { fontFamily: FONT, fontSize: '14px', color: '#ffffff' }).setOrigin(0.5).setDepth(91);
    // trava curta: quem está socando (J também confirma menus) não pula o resultado sem querer
    this.menu = { index: 0, items, texts: [], readyAt: this.time.now + 1200 };
    items.forEach((it, i) => {
      const t = this.add.text(W / 2, 330 + i * 52, it.label, arcadeText(22, '#ffffff')).setOrigin(0.5).setDepth(91).setInteractive({ useHandCursor: true });
      t.on('pointerover', () => { this.menu.index = i; this.paintMenu(); });
      t.on('pointerdown', () => { this.menu.index = i; this.menuInput('confirm'); });
      this.menu.texts.push(t);
    });
    this.paintMenu();
    Sound.sfx((this.online ? winner === this.side : winner === 0 || !arcade) ? 'start' : 'cancel');
  }

  // zerou o jogo: fogos de artifício na tela de resultado
  celebrate() {
    const colors = [0xffd63a, 0xff3b2f, 0x2f8bff, 0x7fe08a, 0xffffff];
    const burst = () => {
      if (!this.scene.isActive()) return;
      const x = 160 + Math.random() * (W - 320);
      const y = 90 + Math.random() * 220;
      const c = Phaser.Utils.Array.GetRandom(colors);
      for (let i = 0; i < 18; i++) {
        const a = (Math.PI * 2 * i) / 18;
        const dot = this.add.circle(x, y, 4, c).setDepth(95).setBlendMode(Phaser.BlendModes.ADD);
        this.tweens.add({ targets: dot, x: x + Math.cos(a) * 110, y: y + Math.sin(a) * 110 + 30, alpha: 0, duration: 900, ease: 'Quad.easeOut', onComplete: () => dot.destroy() });
      }
      Sound.sfx('boom');
    };
    for (let k = 0; k < 8; k++) this.time.delayedCall(300 + k * 550, burst);
  }

  paintMenu() {
    this.menu.texts.forEach((t, i) => {
      t.setColor(i === this.menu.index ? '#ffd63a' : '#ffffff');
      t.setText((i === this.menu.index ? '> ' : '  ') + this.menu.items[i].label);
    });
  }

  menuInput(action) {
    const m = this.menu;
    if (!m || this.leaving || this.time.now < m.readyAt) return;
    if (action === 'up') { m.index = (m.index + m.items.length - 1) % m.items.length; Sound.sfx('menu'); this.paintMenu(); }
    if (action === 'down') { m.index = (m.index + 1) % m.items.length; Sound.sfx('menu'); this.paintMenu(); }
    if (action === 'confirm') { Sound.sfx('confirm'); m.items[m.index].run(); }
  }

  // ---- online --------------------------------------------------------------------------------------
  setupNet() {
    this.side = Net.side;
    this.netSent = 0;              // próximo quadro cujo comando local ainda não foi enviado
    this.netLocal = new Map();     // quadro -> meus comandos (já enviados)
    this.mySums = new Map();
    this.stallSince = 0;
    this.rematch = { me: false, them: false };
    this.desyncWarned = false;
    Net.listen(this, (d) => this.onNet(d), (why) => { this.touchPad?.setEnabled(false); showNetLost(this, why); });
    const youX = this.side === 1 ? W - 112 : 112;
    this.add.text(youX, 118, 'VOCÊ', arcadeText(12, '#ffd63a')).setOrigin(this.side === 1 ? 1 : 0, 0).setDepth(51);
    this.pingText = this.add.text(W / 2, 92, '', { fontFamily: FONT, fontSize: '8px', color: '#9fb4ff' }).setOrigin(0.5).setDepth(51);
    this.waitText = this.add.text(W / 2, H * 0.5, 'AGUARDANDO OPONENTE...', arcadeText(22, '#ffffff')).setOrigin(0.5).setDepth(80).setVisible(false);
  }

  // Comandos dos dois lados para o próximo quadro, ou null se o do outro lado ainda não chegou.
  netInputs() {
    const f = this.sim.frame;
    const batch = [];
    const first = this.netSent;
    while (this.netSent < f + NET_DELAY) {
      const b = packInput(this.humanInput(0));
      this.netLocal.set(this.netSent, b);
      batch.push(b);
      this.netSent++;
    }
    if (batch.length) Net.send({ t: 'in', m: Net.match, f: first, b: batch });
    const theirs = Net.inputs.get(f);
    if (theirs === undefined) {
      if (!this.stallSince) this.stallSince = performance.now();
      return null;
    }
    this.stallSince = 0;
    Net.inputs.delete(f);
    const mine = this.netLocal.get(f);
    this.netLocal.delete(f);
    const inputs = [];
    inputs[this.side] = unpackInput(mine);
    inputs[1 - this.side] = unpackInput(theirs);
    return inputs;
  }

  netStatus() {
    const stalled = this.stallSince && !this.matchOver && performance.now() - this.stallSince > NET_STALL_MS;
    this.waitText.setVisible(!!stalled && !this.netLostShown);
    if (Net.rtt) this.pingText.setText(`ONLINE · ${Math.round(Net.rtt)} MS`);
    // conferência de sincronia: o mesmo quadro tem que dar a mesma luta nos dois lados
    for (const [f, h] of this.mySums) {
      const other = Net.sums.get(f);
      if (other === undefined) continue;
      this.mySums.delete(f);
      Net.sums.delete(f);
      if (other !== h && !this.desyncWarned) {
        this.desyncWarned = true;
        console.warn('World Fighter online: as lutas divergiram no quadro', f, h, other);
      }
    }
  }

  sendSync() {
    const h = this.sim.fighters.map((q) => `${q.hp},${Math.round(q.x * 10)},${Math.round(q.y * 10)},${q.state},${q.wins}`).join('|');
    this.mySums.set(this.sim.frame, h);
    Net.send({ t: 'sum', m: Net.match, f: this.sim.frame, h });
  }

  onNet(d) {
    if (d.t === 'rematch') {
      this.rematch.them = true;
      if (this.resultSub && !this.rematch.me) this.resultSub.setText('O OPONENTE QUER REVANCHE!').setColor('#7fe08a');
      this.checkRematch();
    } else if (d.t === 'reselect') {
      this.leave('select', { mode: 'online' });
    } else if (d.t === 'start') {
      this.startOnline(d);
    }
  }

  askRematch() {
    if (this.rematch.me) return;
    this.rematch.me = true;
    Net.send({ t: 'rematch' });
    this.menu.items[0].label = 'AGUARDANDO OPONENTE...';
    this.paintMenu();
    this.checkRematch();
  }

  // revanche: quando os dois pedem, o 1P sorteia a nova luta (mesmos lutadores) e avisa o outro
  checkRematch() {
    if (!this.rematch.me || !this.rematch.them || !Net.isHost || this.restarting) return;
    const d = { t: 'start', m: Net.match + 1, p1: this.defs[0].id, p2: this.defs[1].id,
      seed: (Math.random() * 2 ** 31) >>> 0, stage: Math.random() < 0.5 ? 0 : 1 };
    Net.send(d);
    this.startOnline(d);
  }

  startOnline(d) {
    if (this.restarting) return;
    this.restarting = true;
    Net.newMatch(d.m);
    this.leave('versus', { mode: 'online', p1: d.p1, p2: d.p2, seed: d.seed, stage: d.stage, ladder: { beaten: [] } });
  }

  // online não tem pausa: ESC / P / botão de pausa abrem "sair da luta?" com a luta correndo atrás
  toggleQuitMenu() {
    if (this.quitUi) {
      this.quitUi.forEach((o) => o.destroy());
      this.quitUi = null;
      this.touchPad?.setEnabled(true);
      return;
    }
    this.touchPad?.setEnabled(false);
    const bg = this.add.rectangle(W / 2, H / 2, W, H, 0x000000, 0.55).setDepth(90).setInteractive();
    bg.on('pointerdown', () => this.toggleQuitMenu());
    const quit = this.add.text(W / 2, H / 2 + 50, 'SAIR DA LUTA', arcadeText(24, '#ff8a6a')).setOrigin(0.5).setDepth(91)
      .setInteractive({ useHandCursor: true });
    quit.on('pointerdown', () => this.quitOnline());
    this.quitUi = [
      bg,
      this.add.text(W / 2, H / 2 - 40, 'SAIR DA LUTA?', arcadeText(40)).setOrigin(0.5).setDepth(91),
      this.add.text(W / 2, H / 2 + 110, 'A LUTA CONTINUA · ESC / TOQUE FORA: VOLTAR · Q: SAIR', { fontFamily: FONT, fontSize: '11px', color: '#ffffff' }).setOrigin(0.5).setDepth(91),
      quit,
    ];
  }

  quitOnline() {
    Net.leave();
    this.leave('title');
  }

  leave(sceneKey, payload = {}) {
    if (this.leaving) return;
    this.leaving = true;
    this.stopAttackVoice();
    Sound.stop(0.4);
    this.cameras.main.fadeOut(350, 0, 0, 0);
    this.cameras.main.once('camerafadeoutcomplete', () => this.scene.start(sceneKey, payload));
  }
}
