import { Sound } from '../audio.js';
import { bindControls } from '../controls.js';
import { ALL_FIGHTERS, BOSS, COUNTRIES, FIGHTERS, FONT, H, MAP_SRC_W, W, arcadeText, roster } from '../data.js';
import { Net } from '../net.js';
import { addMuteToggle, addScanlines, say, showNetLost } from '../ui.js';

const GAP = 6;
const GRID_Y = 404;
// grade: 5x2 com os 10 lutadores; 6x2 (miniaturas menores) quando o Xandão está desbloqueado
const gridFor = (n) => (n > 10 ? { cols: 6, tw: 116, th: 105 } : { cols: 5, tw: 128, th: 116 });
const MAP = { x: W / 2, y: 214, w: 560, h: 280 };
const MAP_SRC_H = MAP_SRC_W / 2;
const PORTRAIT_H = 470, PORTRAIT_MAX_W = 560, PORTRAIT_BOTTOM = 608;
const TIME_LIMIT = 30;
const COLORS = { p1: 0xff3030, p2: 0x2f8bff, cpu: 0xe0e0e0 };

const mapPoint = (country) => ({
  x: MAP.x - MAP.w / 2 + COUNTRIES[country].x * (MAP.w / MAP_SRC_W),
  y: MAP.y - MAP.h / 2 + COUNTRIES[country].y * (MAP.h / MAP_SRC_H),
});
const hex = (n) => `#${n.toString(16).padStart(6, '0')}`;

// Seleção de lutadores no molde do Street Fighter II: mapa-múndi, retratos grandes
// frente a frente, grade com cursores 1P/2P piscando, cronômetro e, no arcade,
// a roleta do adversário seguida do avião voando até o país dele.
export class SelectScene extends Phaser.Scene {
  constructor() { super('select'); }

  create(data) {
    this.mode = data.mode || 'arcade';
    this.online = this.mode === 'online';
    this.locked = false;
    this.netLostShown = false;
    this.bossTest = !!data.bossTest; // link de teste (?chefe): depois da escolha, luta direto contra o chefe
    this.roster = roster();
    const g = gridFor(this.roster.length);
    this.cols = g.cols;
    this.tw = g.tw;
    this.th = g.th;
    this.gridX = W / 2 - (g.cols * g.tw + (g.cols - 1) * GAP) / 2;
    this.cameras.main.fadeIn(300, 0, 0, 0);

    const bg = this.add.graphics();
    bg.fillGradientStyle(0x0d1478, 0x0d1478, 0x02031c, 0x02031c, 1).fillRect(0, 0, W, H);

    this.players = [
      { id: 0, cursor: 0, confirmed: false, active: true, cpu: false, color: COLORS.p1, tag: '1P' },
      { id: 1, cursor: 4, confirmed: false, active: this.mode !== 'arcade', cpu: false, color: COLORS.p2, tag: '2P', ghostId: null },
    ];
    // online: cada aparelho controla só o seu lado (1P quem criou a sala, 2P quem entrou)
    this.me = this.online ? this.players[Net.side] : this.players[0];
    if (this.online) this.players[1 - Net.side].remote = true;

    this.buildPortraits();
    this.buildMap();
    this.buildGrid();
    this.buildHud();
    this.players.forEach((p) => this.buildCursor(p));
    this.players.forEach((p) => p.active && this.refresh(p, false));
    if (this.mode === 'arcade') this.showWaitingCpu();

    addScanlines(this, 0.14);
    const mute = addMuteToggle(this);
    bindControls(this, this.mode === 'versus' ? 'versus' : 'solo', (player, action) => {
      if (action === 'mute') return mute.toggle();
      this.handle(this.online ? this.me : this.players[player], action);
    });
    if (this.online) Net.listen(this, (d) => this.onNet(d), (why) => showNetLost(this, why));
    this.time.addEvent({ delay: 1000, loop: true, callback: () => this.tickTimer() });
    Sound.play('select');
  }

  // ---- montagem da tela ----------------------------------------------------
  buildPortraits() {
    for (const p of this.players) {
      const right = p.id === 1;
      p.baseX = right ? W : 0;
      p.portrait = this.add.image(p.baseX, PORTRAIT_BOTTOM, `portrait-${this.roster[0].id}`)
        .setOrigin(right ? 1 : 0, 1).setFlipX(right).setVisible(false).setDepth(1);
      p.flash = this.add.image(p.baseX, PORTRAIT_BOTTOM, `portrait-${this.roster[0].id}`)
        .setOrigin(right ? 1 : 0, 1).setFlipX(right).setAlpha(0).setDepth(1.5)
        .setBlendMode(Phaser.BlendModes.ADD);
    }
  }

  buildMap() {
    this.add.rectangle(MAP.x, MAP.y, MAP.w + 16, MAP.h + 16, 0x000010).setDepth(2);
    this.add.image(MAP.x, MAP.y, 'map').setDisplaySize(MAP.w, MAP.h).setDepth(2);
    this.add.rectangle(MAP.x, MAP.y, MAP.w + 10, MAP.h + 10).setStrokeStyle(4, 0xc9d4ff).setDepth(2);
    for (const p of this.players) {
      p.marker = this.add.container(0, 0).setDepth(3).setVisible(false);
      const ring = this.add.circle(0, 0, 11).setStrokeStyle(4, p.color);
      const dot = this.add.circle(0, 0, 4, p.color);
      p.marker.add([ring, dot]);
      this.tweens.add({ targets: ring, scale: 1.8, alpha: 0.15, duration: 520, repeat: -1 });
    }
  }

  buildGrid() {
    const { tw, th } = this;
    this.tiles = this.roster.map((f, i) => {
      const { x, y } = this.tileCenter(i);
      this.add.rectangle(x, y, tw + 6, th + 6, 0x000000).setDepth(3);
      const img = this.add.image(x, y, `tile-${f.id}`).setDisplaySize(tw, th).setDepth(3)
        .setInteractive({ useHandCursor: true }).on('pointerdown', () => this.tapTile(i));
      this.add.rectangle(x, y, tw + 2, th + 2).setStrokeStyle(2, f.boss ? 0xff3b2f : 0x8a93c8).setDepth(3);
      const flash = this.add.rectangle(x, y, tw, th, 0xffffff).setAlpha(0).setDepth(3.5);
      return { img, flash };
    });
  }

  tileCenter(i) {
    return {
      x: this.gridX + (i % this.cols) * (this.tw + GAP) + this.tw / 2,
      y: GRID_Y + Math.floor(i / this.cols) * (this.th + GAP) + this.th / 2,
    };
  }

  // lutador sob o cursor (online: o do outro pode ser o Xandão mesmo que aqui ele não esteja liberado)
  fighterOf(p) {
    return p.ghostId ? ALL_FIGHTERS.find((f) => f.id === p.ghostId) : this.roster[p.cursor];
  }

  buildHud() {
    this.add.rectangle(W / 2, 36, 96, 56, 0x000010, 0.85).setStrokeStyle(3, 0xc9d4ff).setDepth(5);
    this.timerText = this.add.text(W / 2, 38, String(TIME_LIMIT), arcadeText(30, '#ffffff')).setOrigin(0.5).setDepth(5);
    this.timeLeft = TIME_LIMIT;

    this.add.text(W / 2, 382, 'SELECIONE O LUTADOR', arcadeText(22)).setOrigin(0.5).setDepth(5);

    for (const p of this.players) {
      const right = p.id === 1;
      const x = right ? W - 24 : 24;
      p.nameText = this.add.text(x, 620, '', arcadeText(24, '#ffffff')).setOrigin(right ? 1 : 0, 0).setDepth(5);
      p.countryText = this.add.text(x, 662, '', { fontFamily: FONT, fontSize: '12px', color: '#9fb4ff' })
        .setOrigin(right ? 1 : 0, 0).setDepth(5);
      p.tagText = this.add.text(x, 596, p.tag, arcadeText(14, hex(p.color))).setOrigin(right ? 1 : 0, 0).setDepth(5);
      p.tagText.setVisible(p.active);
    }

    const help = this.online
      ? `ONLINE · SALA ${Net.code} · VOCÊ É O ${this.me.tag} · SETAS + ENTER OU TOQUE 2X`
      : this.mode === 'versus'
        ? '1P: WASD + J      2P: SETAS + ENTER      TOQUE 2X PARA ESCOLHER'
        : 'SETAS: MOVER   ENTER: ESCOLHER   ESC: VOLTAR   TOQUE 2X PARA ESCOLHER';
    this.add.text(W / 2, 706, help, { fontFamily: FONT, fontSize: '9px', color: '#8088b0' }).setOrigin(0.5).setDepth(5);
  }

  buildCursor(p) {
    p.cursorGfx = this.add.graphics().setDepth(4);
    p.cursorLabel = this.add.text(0, 0, p.tag, arcadeText(12, hex(p.color))).setDepth(4.5);
    p.cursorGfx.setVisible(p.active);
    p.cursorLabel.setVisible(p.active);
    this.startBlink(p);
  }

  showWaitingCpu() {
    const p = this.players[1];
    p.nameText.setText('???');
    p.countryText.setText('DESAFIANTE');
  }

  // ---- estado ---------------------------------------------------------------
  startBlink(p) {
    p.blink?.remove();
    p.cursorGfx.setAlpha(1);
    p.blink = this.tweens.add({ targets: [p.cursorGfx, p.cursorLabel], alpha: 0.15, duration: 140, ease: 'Stepped', yoyo: true, repeat: -1 });
  }

  stopBlink(p) {
    p.blink?.remove();
    p.cursorGfx.setAlpha(1);
    p.cursorLabel.setAlpha(1);
  }

  drawCursor(p) {
    const { tw, th } = this;
    p.cursorGfx.clear();
    p.cursorLabel.setVisible(!p.ghostId && p.cursorGfx.visible);
    if (p.ghostId) return; // lutador que não está na grade deste aparelho: sem cursor, só retrato e nome
    const { x, y } = this.tileCenter(p.cursor);
    const other = this.players[1 - p.id];
    const shared = other.active && !other.ghostId && other.cursor === p.cursor;
    const inset = shared && p.id === 1 ? 7 : 0;
    p.cursorGfx.lineStyle(5, p.color, 1)
      .strokeRect(x - tw / 2 - 4 + inset, y - th / 2 - 4 + inset, tw + 8 - inset * 2, th + 8 - inset * 2);
    if (p.id === 0) p.cursorLabel.setOrigin(0, 1).setPosition(x - tw / 2 - 4, y - th / 2 - 6);
    else p.cursorLabel.setOrigin(1, 0).setPosition(x + tw / 2 + 4, y + th / 2 + 6);
  }

  refresh(p, animate = true) {
    const f = this.fighterOf(p);
    this.drawCursor(p);
    const other = this.players[1 - p.id];
    if (other.active) this.drawCursor(other);

    const key = `portrait-${f.id}`;
    for (const img of [p.portrait, p.flash]) {
      img.setTexture(key).setScale(1);
      img.setScale(Math.min(PORTRAIT_H / img.height, PORTRAIT_MAX_W / img.width));
    }
    p.portrait.setVisible(true);
    if (animate) {
      p.portrait.x = p.baseX + (p.id === 1 ? 70 : -70);
      p.portrait.setAlpha(0.3);
      this.tweens.add({ targets: p.portrait, x: p.baseX, alpha: 1, duration: 130, ease: 'Cubic.easeOut' });
    }

    p.nameText.setText(f.name).setFontSize(24);
    // nomes longos não podem invadir a grade de miniaturas: diminui a letra até caber
    for (let size = 23; p.nameText.width > this.gridX - 40 && size >= 14; size--) p.nameText.setFontSize(size);
    p.countryText.setText(COUNTRIES[f.country].name);
    p.tagText.setText(this.online ? `${p.tag} · ${p === this.me ? 'VOCÊ' : 'OPONENTE'}` : p.tag).setColor(hex(p.color)).setVisible(true);

    const pt = mapPoint(f.country);
    p.marker.setVisible(true);
    if (animate) this.tweens.add({ targets: p.marker, x: pt.x, y: pt.y, duration: 160, ease: 'Sine.easeOut' });
    else p.marker.setPosition(pt.x, pt.y);
  }

  // ---- entrada --------------------------------------------------------------
  handle(p, action) {
    if (this.locked || !p.active || p.cpu || p.remote) return;
    if (action === 'back') return this.back(p);
    if (p.confirmed) return;
    if (action === 'left') this.move(p, -1, 0);
    if (action === 'right') this.move(p, 1, 0);
    if (action === 'up') this.move(p, 0, -1);
    if (action === 'down') this.move(p, 0, 1);
    if (action === 'confirm') this.confirm(p);
  }

  tapTile(i) {
    if (this.locked) return;
    Sound.unlock();
    const p = this.online ? this.me : this.mode === 'versus' ? this.players.find((q) => !q.confirmed) : this.players[0];
    if (!p || p.confirmed) return;
    if (p.cursor === i) return this.confirm(p);
    p.cursor = i;
    p.ghostId = null;
    Sound.sfx('cursor');
    this.refresh(p);
    this.sendCursor(p);
  }

  move(p, dx, dy) {
    const cols = this.cols;
    const n = this.roster.length;
    const col = (p.cursor % cols + dx + cols) % cols;
    const row = (Math.floor(p.cursor / cols) + dy + 2) % 2;
    let i = row * cols + col;
    if (i >= n) i = dx ? row * cols + (dx > 0 ? 0 : (n - 1) % cols) : n - 1; // casa vazia da grade 6x2
    p.cursor = Math.min(i, n - 1);
    p.ghostId = null;
    Sound.sfx('cursor');
    this.refresh(p);
    this.sendCursor(p);
  }

  // ---- online: o cursor e a escolha do outro jogador chegam pela rede --------------------------
  sendCursor(p) {
    if (this.online && p === this.me) Net.send({ t: 'cursor', id: this.fighterOf(p).id });
  }

  onNet(d) {
    const other = this.players[1 - Net.side];
    if (d.t === 'cursor' && !other.confirmed) {
      this.placeRemote(other, d.id);
      this.refresh(other);
    } else if (d.t === 'pick') {
      this.placeRemote(other, d.id);
      this.refresh(other);
      this.confirm(other);
    } else if (d.t === 'unpick' && other.confirmed) {
      other.confirmed = false;
      this.startBlink(other);
    } else if (d.t === 'start') {
      this.startOnline(d);
    }
  }

  // o outro jogador escolheu pelo nome do lutador (as grades dos dois aparelhos podem ser diferentes)
  placeRemote(p, id) {
    const i = this.roster.findIndex((f) => f.id === id);
    p.ghostId = i < 0 ? id : null;
    if (i >= 0) p.cursor = i;
  }

  // o 1P (quem criou a sala) sorteia o cenário e a semente da luta; os dois lados usam os mesmos
  startOnline(d) {
    if (this.started) return;
    this.started = true;
    this.locked = true;
    Net.newMatch(d.m);
    this.time.delayedCall(1100, () => {
      Sound.stop(0.5);
      this.cameras.main.fadeOut(400, 0, 0, 0);
      this.cameras.main.once('camerafadeoutcomplete', () =>
        this.scene.start('versus', { mode: 'online', p1: d.p1, p2: d.p2, seed: d.seed, stage: d.stage, ladder: { beaten: [] } }));
    });
  }

  back(p) {
    if (p.confirmed) {
      p.confirmed = false;
      Sound.sfx('cancel');
      this.startBlink(p);
      if (this.online) Net.send({ t: 'unpick' });
      return;
    }
    if (!this.online && this.players.some((q) => q.confirmed)) return;
    this.locked = true;
    if (this.online) Net.leave();
    Sound.sfx('cancel');
    Sound.stop(0.4);
    this.cameras.main.fadeOut(300, 0, 0, 0);
    this.cameras.main.once('camerafadeoutcomplete', () => this.scene.start('title'));
  }

  confirm(p) {
    if (p.confirmed) return;
    p.confirmed = true;
    Sound.sfx('confirm');
    say(this, this.fighterOf(p).id, 120);
    this.stopBlink(p);
    this.cameras.main.shake(140, 0.006);
    const tile = this.tiles[p.cursor];
    tile.flash.setAlpha(0.95);
    this.tweens.add({ targets: tile.flash, alpha: 0, duration: 380 });
    p.flash.setPosition(p.baseX, PORTRAIT_BOTTOM).setAlpha(1);
    this.tweens.add({ targets: p.flash, alpha: 0, duration: 450, ease: 'Quad.easeIn' });
    this.tweens.add({ targets: p.nameText, scale: 1.15, duration: 90, yoyo: true });
    if (this.online && p === this.me) Net.send({ t: 'pick', id: this.fighterOf(p).id });
    this.afterConfirm();
  }

  afterConfirm() {
    const [p1, p2] = this.players;
    if (this.online) {
      if (p1.confirmed && p2.confirmed && Net.isHost && !this.started) {
        const d = { t: 'start', m: Net.match + 1, p1: this.fighterOf(p1).id, p2: this.fighterOf(p2).id,
          seed: (Math.random() * 2 ** 31) >>> 0, stage: Math.random() < 0.5 ? 0 : 1 };
        Net.send(d);
        this.startOnline(d);
      }
      return;
    }
    if (this.mode === 'arcade' && p1.confirmed && !p2.active && this.bossTest) this.goBossTest();
    else if (this.mode === 'arcade' && p1.confirmed && !p2.active) this.cpuRoulette();
    else if (p1.confirmed && p2.confirmed) this.goVersus();
  }

  tickTimer() {
    if (this.locked) return;
    this.timeLeft = Math.max(0, this.timeLeft - 1);
    this.timerText.setText(String(this.timeLeft));
    if (this.timeLeft <= 5) {
      this.timerText.setColor('#ff4a3a');
      Sound.sfx('tick');
    }
    if (this.timeLeft === 0) this.players.filter((p) => p.active && !p.cpu && !p.remote && !p.confirmed).forEach((p) => this.confirm(p));
  }

  // ---- adversário da CPU (modo arcade) --------------------------------------
  cpuRoulette() {
    this.locked = true;
    const p1 = this.players[0];
    const cpu = this.players[1];
    Object.assign(cpu, { active: true, cpu: true, color: COLORS.cpu, tag: 'CPU' });
    cpu.cursorLabel.setText('CPU').setColor(hex(COLORS.cpu));
    cpu.cursorGfx.setVisible(true);
    cpu.cursorLabel.setVisible(true);
    cpu.marker.destroy();
    cpu.marker = this.add.container(0, 0, [this.add.circle(0, 0, 5, COLORS.cpu)]).setDepth(3);

    const pool = this.roster.map((_, i) => i).filter((i) => i !== p1.cursor && !this.roster[i].boss); // o chefe só no fim
    const target = Phaser.Utils.Array.GetRandom(pool);
    const hops = 16;
    let k = 0;
    const hop = () => {
      k++;
      cpu.cursor = k < hops ? Phaser.Utils.Array.GetRandom(pool.filter((i) => i !== cpu.cursor)) : target;
      Sound.sfx('cursor');
      this.refresh(cpu, k === hops);
      if (k < hops) this.time.delayedCall(55 + k * k * 1.6, hop);
      else this.time.delayedCall(350, () => this.flyPlane(this.fighterOf(p1).country, this.roster[target].country, () => this.confirm(cpu)));
    };
    this.time.delayedCall(500, hop);
  }

  flyPlane(fromCountry, toCountry, done) {
    const a = mapPoint(fromCountry), b = mapPoint(toCountry);
    const V = Phaser.Math.Vector2;
    const dist = Phaser.Math.Distance.Between(a.x, a.y, b.x, b.y);
    // viagens curtas (Brasil → Paraguai, Argentina...) sobem num arco mais alto, para o avião sair de cima das
    // bandeiras e ser visto; no mesmo país ele dá uma volta curta. Viagens longas continuam como sempre.
    const curve = dist < 30
      ? new Phaser.Curves.CubicBezier(new V(a.x, a.y), new V(a.x - 70, a.y - 120), new V(a.x + 70, a.y - 120), new V(b.x, b.y))
      : new Phaser.Curves.QuadraticBezier(new V(a.x, a.y), new V((a.x + b.x) / 2, Math.min(a.y, b.y) - Math.max(dist < 160 ? 120 : 50, dist * 0.35)), new V(b.x, b.y));
    const trail = this.add.graphics().setDepth(3.2);
    const plane = this.add.text(a.x, a.y, '✈', { fontFamily: 'sans-serif', fontSize: '26px', color: '#ffffff', stroke: '#000', strokeThickness: 4 })
      .setOrigin(0.5).setDepth(3.4);
    Sound.plane(dist < 30 ? 0 : Math.sign(b.x - a.x), 1.6); // ronco do jato do começo do voo até o pouso
    const state = { t: 0 };
    let lastDot = 0;
    this.tweens.add({
      targets: state, t: 1, duration: 1400, ease: 'Sine.easeInOut',
      onUpdate: () => {
        const pt = curve.getPoint(state.t);
        const tan = curve.getTangent(state.t);
        plane.setPosition(pt.x, pt.y).setRotation(Math.atan2(tan.y, tan.x));
        if (state.t - lastDot > 0.04) {
          lastDot = state.t;
          trail.fillStyle(0xffffff, 0.9).fillCircle(pt.x, pt.y, 2.5);
        }
      },
      onComplete: () => {
        this.tweens.add({ targets: plane, scale: 1.6, alpha: 0, duration: 250 });
        done();
      },
    });
  }

  // link de teste: vai para o desafio final como se já tivesse vencido todos os outros
  goBossTest() {
    this.locked = true;
    const me = this.fighterOf(this.players[0]).id;
    const beaten = FIGHTERS.filter((f) => f.id !== me).map((f) => f.id);
    this.time.delayedCall(1100, () => {
      Sound.stop(0.5);
      this.cameras.main.fadeOut(400, 0, 0, 0);
      this.cameras.main.once('camerafadeoutcomplete', () =>
        this.scene.start('versus', { mode: 'arcade', p1: me, p2: BOSS.id, ladder: { beaten } }));
    });
  }

  goVersus() {
    this.locked = true;
    const [p1, p2] = this.players;
    this.time.delayedCall(1100, () => {
      Sound.stop(0.5);
      this.cameras.main.fadeOut(400, 0, 0, 0);
      this.cameras.main.once('camerafadeoutcomplete', () =>
        this.scene.start('versus', { mode: this.mode, p1: this.fighterOf(p1).id, p2: this.fighterOf(p2).id, ladder: { beaten: [] } }));
    });
  }
}
