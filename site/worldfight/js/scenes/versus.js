import { Sound } from '../audio.js';
import { bindControls } from '../controls.js';
import { COUNTRIES, FIGHTERS, FONT, H, W, arcadeText } from '../data.js';
import { Net } from '../net.js';
import { addMuteToggle, addScanlines, blink, say, showNetLost } from '../ui.js';

const byId = (id) => FIGHTERS.find((f) => f.id === id);

// Tela "VS": os dois retratos entram pelas laterais e o VS bate no meio.
export class VersusScene extends Phaser.Scene {
  constructor() { super('versus'); }

  create(data) {
    // o Phaser reaproveita a mesma cena a cada luta: estes estados precisam voltar ao zero,
    // senão na 2ª visita a tela achava que já estava saindo e ficava parada no VS
    this.ready = false;
    this.leaving = false;
    this.mode = data.mode;
    const left = byId(data.p1), right = byId(data.p2);
    this.cameras.main.fadeIn(200, 0, 0, 0);

    const g = this.add.graphics();
    g.fillStyle(0x7a0b0b, 1).fillPoints([{ x: 0, y: 0 }, { x: W / 2 + 90, y: 0 }, { x: W / 2 - 90, y: H }, { x: 0, y: H }], true);
    g.fillStyle(0x0b1f7a, 1).fillPoints([{ x: W / 2 + 90, y: 0 }, { x: W, y: 0 }, { x: W, y: H }, { x: W / 2 - 90, y: H }], true);
    g.lineStyle(10, 0xffd63a, 1).lineBetween(W / 2 + 90, 0, W / 2 - 90, H);

    const place = (fighter, side) => {
      const img = this.add.image(side ? W + 40 : -40, H - 110, `portrait-${fighter.id}`).setOrigin(side ? 1 : 0, 1).setFlipX(side === 1);
      img.setScale(Math.min(520 / img.height, 620 / img.width));
      this.tweens.add({ targets: img, x: side ? W : 0, duration: 420, ease: 'Back.easeOut', delay: 150 + side * 120 });
      const x = side ? W - 40 : 40;
      this.add.text(x, H - 92, fighter.name, arcadeText(30, '#ffffff')).setOrigin(side ? 1 : 0, 0);
      this.add.text(x, H - 46, COUNTRIES[fighter.country].name, { fontFamily: FONT, fontSize: '14px', color: '#ffd63a' }).setOrigin(side ? 1 : 0, 0);
    };
    place(left, 0);
    place(right, 1);
    this.time.delayedCall(150, () => Sound.sfx('whoosh'));

    const vs = this.add.text(W / 2, H / 2 - 40, 'VS', arcadeText(120, '#ffd63a', { stroke: '#7a0b0b', strokeThickness: 18 }))
      .setOrigin(0.5).setScale(4).setAlpha(0);
    this.tweens.add({
      targets: vs, scale: 1, alpha: 1, duration: 300, delay: 700, ease: 'Expo.easeIn',
      onComplete: () => {
        Sound.sfx('vs');
        say(this, 'versus', 80);
        this.cameras.main.flash(300, 255, 255, 255);
        this.cameras.main.shake(300, 0.015);
        this.add.rectangle(W / 2, H / 2 + 92, 360, 52, 0x000000, 0.75).setStrokeStyle(2, 0xffd63a);
        const ready = this.add.text(W / 2, H / 2 + 92, 'PREPARE-SE!', arcadeText(20, '#ffffff')).setOrigin(0.5);
        blink(this, ready, 450, 250);
        this.ready = true;
        this.time.delayedCall(1900, () => { this.wantGo = true; go(); });
      },
    });

    addScanlines(this, 0.12);
    const mute = addMuteToggle(this);
    const exit = (sceneKey, payload) => {
      if (this.leaving) return;
      this.leaving = true;
      Sound.sfx('menu');
      this.cameras.main.fadeOut(300, 0, 0, 0);
      this.cameras.main.once('camerafadeoutcomplete', () => this.scene.start(sceneKey, payload));
    };
    // online: leva junto a semente e o cenário sorteados pelo 1P
    const payload = { mode: this.mode, p1: data.p1, p2: data.p2, ladder: data.ladder, seed: data.seed, stage: data.stage };
    const go = () => {
      if (this.ready && this.loaded) exit('fight', payload);
    };
    this.netLostShown = false;
    if (this.mode === 'online') Net.listen(this, null, (why) => showNetLost(this, why));
    // a cena é reaproveitada entre lutas: o sinal "pode ir" da luta anterior não vale aqui
    this.wantGo = false;
    this.loadFighters([data.p1, data.p2], () => { if (this.wantGo) go(); });
    bindControls(this, 'solo', (_p, action) => {
      if (action === 'mute') return mute.toggle();
      if (action === 'confirm') go();
      if (action === 'back' && this.ready && this.mode !== 'online') exit('select', { mode: this.mode });
      return undefined;
    });
    this.input.on('pointerdown', (_ptr, over) => { if (!over.length) go(); });

    // vigia: com os lutadores carregados, se a passagem automática não acontecer, força a ida para a luta
    const watchdog = window.setInterval(() => {
      if (!this.loaded || this.leaving || !this.scene.isActive()) return;
      window.clearInterval(watchdog);
      this.ready = true;
      go();
      window.setTimeout(() => { if (this.scene.isActive()) this.scene.start('fight', payload); }, 1500);
    }, 6000);
    this.events.once('shutdown', () => window.clearInterval(watchdog));
  }

  // Carrega só as animações dos dois lutadores desta luta (são pesadas), com barra de progresso,
  // e libera da memória as dos outros lutadores.
  loadFighters(ids, done) {
    this.loaded = false;
    for (const f of FIGHTERS) {
      if (!ids.includes(f.id) && this.textures.exists(`anim-${f.id}`)) this.textures.remove(`anim-${f.id}`);
    }
    const missing = [...new Set(ids)].filter((id) => !this.textures.exists(`anim-${id}`));
    if (!missing.length) { this.loaded = true; done(); return; }

    const y = H / 2 + 150;
    const barW = 420;
    const frame = this.add.rectangle(W / 2, y, barW + 10, 26, 0x000000, 0.8).setStrokeStyle(2, 0xffd63a).setDepth(20);
    const bar = this.add.rectangle(W / 2 - barW / 2, y, 1, 16, 0xffd63a).setOrigin(0, 0.5).setDepth(21);
    const label = this.add.text(W / 2, y + 30, 'CARREGANDO LUTADORES 0%', { fontFamily: FONT, fontSize: '11px', color: '#ffffff' })
      .setOrigin(0.5).setDepth(21);
    const stamp = window.WF_VERSION && !window.WF_VERSION.startsWith('__') ? `?v=${window.WF_VERSION}` : '';
    this.load.setPath('assets/');
    for (const id of missing) this.load.multiatlas(`anim-${id}`, `anims/${id}.json${stamp}`, 'assets/anims/');
    this.load.on('progress', (p) => {
      bar.width = Math.max(1, barW * p);
      label.setText(`CARREGANDO LUTADORES ${Math.round(p * 100)}%`);
    });
    this.load.once('loaderror', (file) => {
      label.setText('FALHA AO CARREGAR — TOQUE PARA TENTAR DE NOVO').setColor('#ff5a3a');
      this.input.once('pointerdown', () => this.scene.restart());
      console.error('falha ao carregar', file && file.src);
    });
    this.load.once('complete', () => {
      if (!missing.every((id) => this.textures.exists(`anim-${id}`))) return; // erro já mostrado
      this.loaded = true;
      frame.destroy();
      bar.destroy();
      label.destroy();
      done();
    });
    this.load.start();
  }
}
