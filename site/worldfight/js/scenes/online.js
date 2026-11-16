import { Sound } from '../audio.js';
import { bindControls } from '../controls.js';
import { FONT, H, W, arcadeText } from '../data.js';
import { Net, inviteLink } from '../net.js';
import { addMuteToggle, addScanlines, blink } from '../ui.js';

const MENU = ['CRIAR SALA', 'ENTRAR NA SALA', 'VOLTAR'];
const KEYS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '⌫', '0', 'OK'];

// Sala do jogo online: criar (mostra o código e o link de convite) ou entrar (digita o código
// no teclado numérico da tela ou do computador). Conectou: os dois vão para a seleção de lutadores.
// Aberto com {join: '1234'} (link de convite ?sala=1234), já entra direto na sala.
export class OnlineScene extends Phaser.Scene {
  constructor() { super('online'); }

  create(data) {
    this.state = 'menu';
    this.choice = 0;
    this.digits = '';
    this.leaving = false;
    this.netLostShown = false;
    this.ui = [];
    this.cameras.main.fadeIn(250, 0, 0, 0);

    const bg = this.add.graphics();
    bg.fillGradientStyle(0x0d1478, 0x0d1478, 0x02031c, 0x02031c, 1).fillRect(0, 0, W, H);
    this.add.text(W / 2, 92, 'JOGAR ONLINE', arcadeText(48)).setOrigin(0.5);
    this.sub = this.add.text(W / 2, 150, 'LUTE CONTRA UM AMIGO EM OUTRO CELULAR OU COMPUTADOR', { fontFamily: FONT, fontSize: '12px', color: '#9fb4ff' }).setOrigin(0.5);

    addScanlines(this, 0.12);
    const mute = addMuteToggle(this);
    bindControls(this, 'solo', (_p, action) => {
      if (action === 'mute') return mute.toggle();
      return this.onAction(action);
    });
    const onDigit = (e) => {
      const m = /^(?:Digit|Numpad)(\d)$/.exec(e.code);
      if (m && this.state === 'join') this.typeKey(m[1]);
    };
    this.input.keyboard.on('keydown', onDigit);
    this.events.once('shutdown', () => this.input.keyboard.off('keydown', onDigit));

    Sound.play('select');
    if (data && data.join && /^\d{4}$/.test(data.join)) {
      this.digits = data.join;
      this.showJoin();
      this.connect();
    } else {
      this.showMenu();
    }
  }

  clearUi() {
    this.ui.forEach((o) => o.destroy());
    this.ui = [];
    this.blinker?.remove();
    this.blinker = null;
  }

  button(x, y, label, onTap, size = 22, color = '#ffffff') {
    const t = this.add.text(x, y, label, arcadeText(size, color)).setOrigin(0.5).setInteractive({ useHandCursor: true });
    t.on('pointerdown', () => { Sound.unlock(); onTap(); });
    this.ui.push(t);
    return t;
  }

  // ---- menu ------------------------------------------------------------------------
  showMenu() {
    this.clearUi();
    this.state = 'menu';
    this.items = MENU.map((label, i) => {
      const t = this.button(W / 2, 290 + i * 86, label, () => { this.choice = i; this.pickMenu(); }, 26);
      t.on('pointerover', () => { this.choice = i; this.paintMenu(); });
      return t;
    });
    this.arrow = this.add.text(0, 0, '>', arcadeText(26)).setOrigin(0.5);
    this.ui.push(this.arrow);
    this.ui.push(this.add.text(W / 2, 610, 'QUEM CRIA A SALA É O 1P · QUEM ENTRA É O 2P', { fontFamily: FONT, fontSize: '11px', color: '#8088b0' }).setOrigin(0.5));
    this.ui.push(this.add.text(W / 2, 640, 'É PRECISO ESTAR CONECTADO À INTERNET', { fontFamily: FONT, fontSize: '11px', color: '#8088b0' }).setOrigin(0.5));
    this.paintMenu();
  }

  paintMenu() {
    this.items.forEach((t, i) => t.setColor(i === this.choice ? '#ffd63a' : '#ffffff'));
    const it = this.items[this.choice];
    this.arrow.setPosition(it.x - it.width / 2 - 34, it.y);
  }

  pickMenu() {
    Sound.sfx('confirm');
    if (this.choice === 0) this.createRoom();
    else if (this.choice === 1) { this.digits = ''; this.showJoin(); }
    else this.exit();
  }

  onAction(action) {
    if (this.leaving) return;
    if (this.state === 'menu') {
      if (action === 'up' || action === 'left') { this.choice = (this.choice + MENU.length - 1) % MENU.length; Sound.sfx('menu'); this.paintMenu(); }
      if (action === 'down' || action === 'right') { this.choice = (this.choice + 1) % MENU.length; Sound.sfx('menu'); this.paintMenu(); }
      if (action === 'confirm') this.pickMenu();
      if (action === 'back') this.exit();
    } else if (this.state === 'join') {
      if (action === 'confirm') this.typeKey('OK');
      if (action === 'back') { if (this.digits) this.typeKey('⌫'); else this.cancel(); }
    } else if (action === 'back') {
      this.cancel();
    }
  }

  // ---- criar sala ------------------------------------------------------------------
  async createRoom() {
    this.clearUi();
    this.state = 'host';
    const status = this.add.text(W / 2, 300, 'CRIANDO SALA...', arcadeText(20, '#ffffff')).setOrigin(0.5);
    this.ui.push(status);
    this.button(W / 2, 640, 'CANCELAR', () => this.cancel(), 18, '#ff8a6a');
    try {
      const code = await Net.host(() => this.connected());
      if (this.state !== 'host') return;
      status.destroy();
      this.ui.push(this.add.text(W / 2, 222, 'CÓDIGO DA SALA', { fontFamily: FONT, fontSize: '14px', color: '#9fb4ff' }).setOrigin(0.5));
      const big = this.add.text(W / 2, 300, code.split('').join(' '), arcadeText(84, '#ffd63a')).setOrigin(0.5);
      this.ui.push(big);
      this.ui.push(this.add.text(W / 2, 382, 'MANDE O CÓDIGO OU O LINK PARA SEU AMIGO', { fontFamily: FONT, fontSize: '13px', color: '#ffffff' }).setOrigin(0.5));
      const share = this.button(W / 2, 450, navigator.share ? 'COMPARTILHAR LINK' : 'COPIAR LINK', () => this.share(code, share), 20, '#7fe08a');
      const wait = this.add.text(W / 2, 540, 'AGUARDANDO OPONENTE...', arcadeText(18, '#ffffff')).setOrigin(0.5);
      this.ui.push(wait);
      this.blinker = blink(this, wait, 800, 400);
    } catch (err) {
      this.fail(status, err);
    }
  }

  async share(code, btn) {
    const url = inviteLink(code);
    try {
      if (navigator.share) {
        await navigator.share({ title: 'World Fighter', text: `Bora lutar no World Fighter! Sala ${code}:`, url });
        return;
      }
      await navigator.clipboard.writeText(url);
      btn.setText('LINK COPIADO!');
    } catch (e) {
      btn.setText(url.replace(/^https?:\/\//, '')).setFontSize(12); // sem permissão: mostra o link
    }
  }

  // ---- entrar na sala --------------------------------------------------------------
  showJoin() {
    this.clearUi();
    this.state = 'join';
    this.ui.push(this.add.text(W / 2, 210, 'DIGITE O CÓDIGO DA SALA', { fontFamily: FONT, fontSize: '14px', color: '#9fb4ff' }).setOrigin(0.5));
    this.boxes = [0, 1, 2, 3].map((i) => {
      const x = W / 2 + (i - 1.5) * 92;
      this.ui.push(this.add.rectangle(x, 280, 76, 92, 0x000010, 0.85).setStrokeStyle(3, 0xc9d4ff));
      const t = this.add.text(x, 282, '', arcadeText(48, '#ffd63a')).setOrigin(0.5);
      this.ui.push(t);
      return t;
    });
    // teclado numérico na tela (celular e mouse)
    KEYS.forEach((k, i) => {
      const x = W / 2 + ((i % 3) - 1) * 112;
      const y = 384 + Math.floor(i / 3) * 74;
      const ok = k === 'OK';
      const r = this.add.rectangle(x, y, 100, 62, ok ? 0x1d6b2a : 0x101a5a, 0.95).setStrokeStyle(2, ok ? 0x7fe08a : 0x6f7cff)
        .setInteractive({ useHandCursor: true });
      r.on('pointerdown', () => { Sound.unlock(); this.typeKey(k); });
      this.ui.push(r);
      this.ui.push(this.add.text(x, y + 2, k, arcadeText(k === '⌫' ? 22 : 24, '#ffffff')).setOrigin(0.5));
    });
    this.status = this.add.text(W / 2, 682, '', { fontFamily: FONT, fontSize: '13px', color: '#ffffff' }).setOrigin(0.5);
    this.ui.push(this.status);
    this.button(130, 682, '< VOLTAR', () => this.cancel(), 14, '#9fb4ff');
    this.paintDigits();
  }

  paintDigits() {
    this.boxes.forEach((t, i) => t.setText(this.digits[i] || ''));
  }

  typeKey(k) {
    if (this.state !== 'join' || this.busy) return;
    if (k === '⌫') { this.digits = this.digits.slice(0, -1); Sound.sfx('cursor'); }
    else if (k === 'OK') { if (this.digits.length === 4) this.connect(); else Sound.sfx('cancel'); return; }
    else if (this.digits.length < 4) { this.digits += k; Sound.sfx('cursor'); }
    this.status.setText('').setColor('#ffffff');
    this.paintDigits();
    if (this.digits.length === 4) this.connect();
  }

  async connect() {
    if (this.busy) return;
    this.busy = true;
    this.status.setText('CONECTANDO...').setColor('#ffffff');
    try {
      await Net.join(this.digits);
      if (this.state !== 'join') { Net.close(); return; }
      this.connected();
    } catch (err) {
      this.busy = false;
      if (this.state !== 'join') return;
      Sound.sfx('cancel');
      const msg = err.message === 'nao-encontrada' ? 'SALA NÃO ENCONTRADA — CONFIRA O CÓDIGO'
        : err.message === 'sem-internet' ? 'SEM INTERNET — TENTE DE NOVO'
          : 'NÃO FOI POSSÍVEL CONECTAR — TENTE DE NOVO';
      this.status.setText(msg).setColor('#ff5a3a');
      this.digits = '';
      this.paintDigits();
    }
  }

  // ---- conectado -------------------------------------------------------------------
  connected() {
    if (this.leaving) return;
    this.leaving = true;
    this.state = 'done';
    this.clearUi();
    Sound.sfx('start');
    this.ui.push(this.add.text(W / 2, 330, 'CONECTADO!', arcadeText(54, '#7fe08a')).setOrigin(0.5));
    this.ui.push(this.add.text(W / 2, 400, Net.isHost ? 'VOCÊ É O 1P (ESQUERDA)' : 'VOCÊ É O 2P (DIREITA)', arcadeText(18, '#ffffff')).setOrigin(0.5));
    this.cameras.main.flash(250, 255, 255, 255);
    this.time.delayedCall(1300, () => {
      Sound.stop(0.4);
      this.cameras.main.fadeOut(300, 0, 0, 0);
      this.cameras.main.once('camerafadeoutcomplete', () => this.scene.start('select', { mode: 'online' }));
    });
  }

  fail(status, err) {
    Sound.sfx('cancel');
    status.setText(err && err.message === 'sem-internet' ? 'SEM INTERNET — TENTE DE NOVO' : 'NÃO FOI POSSÍVEL CRIAR A SALA').setColor('#ff5a3a');
  }

  cancel() {
    if (this.leaving) return;
    Net.close();
    this.busy = false;
    Sound.sfx('cancel');
    this.showMenu();
  }

  exit() {
    if (this.leaving) return;
    this.leaving = true;
    Net.close();
    Sound.sfx('cancel');
    Sound.stop(0.4);
    this.cameras.main.fadeOut(300, 0, 0, 0);
    this.cameras.main.once('camerafadeoutcomplete', () => this.scene.start('title'));
  }
}
