import { Sound } from '../audio.js';
import { bindControls } from '../controls.js';
import { FONT, W, H, arcadeText } from '../data.js';
import { addMuteToggle, addScanlines, blink, say } from '../ui.js';

const MENU = [
  { label: 'ARCADE 1P', mode: 'arcade' },
  { label: 'VERSUS 2P', mode: 'versus' },
  { label: 'ONLINE', mode: 'online' },
];
const MENU_Y = 664;
const MENU_GAP = 70;

// Logo batendo na tela com clarão e tremor, "APERTE START" piscando e depois o menu.
export class TitleScene extends Phaser.Scene {
  constructor() { super('title'); }

  create() {
    this.cameras.main.setBackgroundColor('#000000');
    this.phase = 'intro';
    this.choice = 0;

    const art = this.add.image(W / 2, H / 2, 'title').setDisplaySize(W, H);
    const finalScale = art.scaleX;
    art.setScale(finalScale * 1.6).setAlpha(0);

    // faixa de brilho que atravessa o logo de tempos em tempos
    const shine = this.add.rectangle(-200, H / 2, 70, H * 1.6, 0xffffff, 0.22)
      .setAngle(20).setBlendMode(Phaser.BlendModes.ADD).setVisible(false);

    this.band = this.add.rectangle(W / 2, MENU_Y, W, 64, 0x000000, 0.7).setVisible(false);
    this.press = this.add.text(W / 2, MENU_Y, 'APERTE START', arcadeText(26)).setOrigin(0.5).setVisible(false);
    this.items = MENU.map((m, i) =>
      this.add.text(0, MENU_Y, m.label, arcadeText(16, m.mode ? '#ffffff' : '#666a88'))
        .setOrigin(0.5).setVisible(false).setInteractive({ useHandCursor: true })
        .on('pointerover', () => this.phase === 'menu' && this.move(i - this.choice))
        .on('pointerdown', () => { if (this.phase === 'menu') { this.choice = i; this.pick(); } }));
    // itens lado a lado, centralizados
    const total = this.items.reduce((sum, t) => sum + t.width, 0) + MENU_GAP * (MENU.length - 1);
    let x = W / 2 - total / 2;
    for (const t of this.items) { t.x = x + t.width / 2; x += t.width + MENU_GAP; }
    this.arrow = this.add.text(0, 0, '>', arcadeText(16)).setOrigin(0.5).setVisible(false);
    // licença CC BY 4.0 das músicas: crédito visível
    this.add.text(W / 2, H - 22, 'MÚSICAS: KEVIN MACLEOD (INCOMPETECH.COM) · LICENÇA CC BY 4.0', { fontFamily: FONT, fontSize: '8px', color: '#6c74a0' })
      .setOrigin(0.5, 1).setDepth(10);
    this.add.text(W / 2, H - 8, '© 2026 PLAYGROUND · PARÓDIA DE HUMOR · PERSONAGENS FICTÍCIOS · NÃO OFICIAL', { fontFamily: FONT, fontSize: '9px', color: '#8088b0' })
      .setOrigin(0.5, 1).setDepth(10);

    this.time.delayedCall(250, () => Sound.sfx('whoosh'));
    this.tweens.add({
      targets: art, scale: finalScale, alpha: 1, duration: 380, delay: 250, ease: 'Expo.easeIn',
      onComplete: () => {
        Sound.sfx('slam');
        say(this, 'title', 250);
        this.cameras.main.flash(450, 255, 255, 255);
        this.cameras.main.shake(350, 0.012);
        this.time.delayedCall(700, () => Sound.play('title'));
        this.time.delayedCall(500, () => this.showPress());
        shine.setVisible(true);
        this.tweens.add({ targets: shine, x: W + 200, duration: 900, delay: 400, repeatDelay: 3200, repeat: -1 });
      },
    });

    addScanlines(this, 0.12);
    const mute = addMuteToggle(this);
    bindControls(this, 'solo', (_p, action) => {
      if (action === 'mute') return mute.toggle();
      if (this.phase === 'press' && action === 'confirm') return this.showMenu();
      if (this.phase !== 'menu') return;
      if (action === 'up' || action === 'left') this.move(-1);
      if (action === 'down' || action === 'right') this.move(1);
      if (action === 'confirm') this.pick();
      if (action === 'back') { Sound.sfx('cancel'); this.hideMenu(); }
    });
    this.input.on('pointerdown', (_ptr, over) => { if (this.phase === 'press' && !over.length) this.showMenu(); });
  }

  showPress() {
    this.phase = 'press';
    this.band.setVisible(true);
    this.items.forEach((t) => t.setVisible(false));
    this.arrow.setVisible(false);
    this.press.setVisible(true).setAlpha(1);
    this.pressBlink = blink(this, this.press, 1000, 450);
  }

  showMenu() {
    Sound.sfx('start');
    this.phase = 'menu';
    this.pressBlink?.remove();
    this.press.setVisible(false);
    this.items.forEach((t) => t.setVisible(true));
    this.arrow.setVisible(true);
    this.move(0);
  }

  hideMenu() { this.showPress(); }

  move(delta) {
    const next = (this.choice + delta + MENU.length) % MENU.length;
    if (delta !== 0 && next !== this.choice) Sound.sfx('menu');
    this.choice = next;
    this.items.forEach((t, i) => t.setColor(i === this.choice ? '#ffd63a' : MENU[i].mode ? '#ffffff' : '#666a88'));
    const item = this.items[this.choice];
    this.arrow.setPosition(item.x - item.width / 2 - 22, item.y);
  }

  pick() {
    const entry = MENU[this.choice];
    if (!entry.mode) {
      Sound.sfx('cancel');
      this.cameras.main.shake(150, 0.004);
      return;
    }
    this.phase = 'leaving';
    Sound.sfx('confirm');
    Sound.stop(0.5);
    this.tweens.add({ targets: this.items[this.choice], alpha: 0, duration: 60, yoyo: true, repeat: 4 });
    this.time.delayedCall(450, () => {
      this.cameras.main.fadeOut(350, 0, 0, 0);
      this.cameras.main.once('camerafadeoutcomplete', () => this.scene.start(entry.mode === 'online' ? 'online' : 'select', { mode: entry.mode }));
    });
  }
}
