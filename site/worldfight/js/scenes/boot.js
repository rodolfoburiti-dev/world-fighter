import { Sound } from '../audio.js';
import { COMBAT_VOICES } from '../combat-voices.js';
import { ALL_FIGHTERS, FIGHTERS, FONT, W, H, arcadeText } from '../data.js';
import { STAGE_IMAGES } from '../stages.js';
import { addScanlines, blink } from '../ui.js';

// falas do locutor durante a luta (tools/gerar_locutor.py, LUTA)
const ANNOUNCER = ['round1', 'round2', 'round3', 'round4', 'round5', 'roundfinal', 'fight', 'ko', 'perfect',
  'timeover', 'draw', 'wins', 'youwin', 'youlose', 'champion'];

const BLOCKS = 24;

// Tela de carregamento estilo placa de fliperama: barra em blocos, depois "insira uma ficha".
export class BootScene extends Phaser.Scene {
  constructor() { super('boot'); }

  preload() {
    this.cameras.main.setBackgroundColor('#000000');
    this.add.text(W / 2, 200, 'WORLD FIGHTER', arcadeText(40)).setOrigin(0.5);
    this.add.text(W / 2, 252, 'PLAYGROUND ARCADE SYSTEM', { fontFamily: FONT, fontSize: '12px', color: '#6f7cff' }).setOrigin(0.5);
    const loading = this.add.text(W / 2, 360, 'CARREGANDO', { fontFamily: FONT, fontSize: '16px', color: '#ffffff' }).setOrigin(0.5);
    blink(this, loading, 700, 300);

    const bw = 22, gap = 4, total = BLOCKS * (bw + gap) - gap;
    const x0 = W / 2 - total / 2, y0 = 392;
    this.add.rectangle(W / 2, y0 + 12, total + 16, 40).setStrokeStyle(3, 0x6f7cff);
    const blocks = [];
    for (let i = 0; i < BLOCKS; i++) {
      blocks.push(this.add.rectangle(x0 + i * (bw + gap) + bw / 2, y0 + 12, bw, 24, 0x1a1f55));
    }
    const pct = this.add.text(W / 2, 450, '0%', { fontFamily: FONT, fontSize: '14px', color: '#ffd63a' }).setOrigin(0.5);

    this.load.on('progress', (v) => {
      const lit = Math.round(v * BLOCKS);
      blocks.forEach((b, i) => {
        // amarelo -> laranja -> vermelho ao longo da barra
        const c = i < BLOCKS / 3 ? 0xffd63a : i < (2 * BLOCKS) / 3 ? 0xff8a1f : 0xff3b2f;
        b.setFillStyle(i < lit ? c : 0x1a1f55);
      });
      pct.setText(`${Math.round(v * 100)}%`);
    });
    this.load.once('complete', () => { loading.destroy(); pct.setText('100%'); });

    // a hospedagem guarda arquivos por 30 dias: o envio carimba a versão no endereço (?v=...)
    const stamp = window.WF_VERSION && !window.WF_VERSION.startsWith('__') ? `?v=${window.WF_VERSION}` : '';
    const v = (path) => path + stamp;
    this.load.setPath('assets/');
    this.load.image('title', v('title.webp'));
    this.load.image('map', v('map.webp'));
    for (const f of ALL_FIGHTERS) {
      this.load.image(`tile-${f.id}`, v(`tiles/${f.id}.webp`));
      this.load.image(`portrait-${f.id}`, v(`portraits/${f.id}.webp`));
      // as animações de luta (pesadas) são carregadas só na tela VS, para os dois lutadores da luta
    }
    this.load.json('anim-meta', v('anims/meta.json'));
    for (const cc of STAGE_IMAGES) this.load.image(`stage-${cc}`, v(`stages/${cc}.webp`));
    // falas do locutor (se algum arquivo faltar, o jogo segue sem aquela fala)
    for (const id of [...FIGHTERS.map((f) => f.id), 'versus', 'title']) {
      this.load.audio(`voice-${id}`, v(`voice/${id}.mp3`));
    }
    // fala de vitória própria de alguns lutadores (FIGHTERS[].winVoice)
    for (const f of ALL_FIGHTERS.filter((x) => x.winVoice)) this.load.audio(`voice-win-${f.id}`, v(`voice/win-${f.id}.mp3`));
    this.load.audio('voice-boss-moraes', v('voice/boss-moraes.mp3')); // grito do Xandão ao cair no chão
    // anúncios da luta (inglês, como no fliperama), cada um com duas tomadas
    for (const id of ANNOUNCER) {
      this.load.audio(`voice-${id}`, v(`voice/${id}.mp3`));
      this.load.audio(`voice-${id}-2`, v(`voice/${id}-2.mp3`));
    }
    for (const clips of Object.values(COMBAT_VOICES)) {
      for (const clip of clips) this.load.audio(clip, v(`voice/combate/${clip}.mp3`));
    }
    addScanlines(this);
  }

  create() {
    const coin = this.add.text(W / 2, 560, 'APERTE ENTER OU TOQUE NA TELA', arcadeText(18, '#ffffff')).setOrigin(0.5);
    const coinBlink = blink(this, coin, 1000, 450);
    this.add.text(W / 2, H - 40, '© 2026 PLAYGROUND · PARÓDIA DE HUMOR', { fontFamily: FONT, fontSize: '10px', color: '#5a6090' }).setOrigin(0.5);

    let done = false;
    const insertCoin = () => {
      if (done) return;
      done = true;
      Sound.unlock();
      Sound.sfx('coin');
      coinBlink.remove();
      coin.setAlpha(1).setText('CRÉDITO 01').setColor('#ffd63a');
      this.time.delayedCall(800, () => {
        this.cameras.main.fadeOut(250, 0, 0, 0);
        // convite do jogo online (?sala=1234): vai direto para a sala
        const sala = new URLSearchParams(location.search).get('sala');
        if (sala) history.replaceState(null, '', location.pathname);
        this.cameras.main.once('camerafadeoutcomplete', () => (
          sala && /^\d{4}$/.test(sala) ? this.scene.start('online', { join: sala }) : this.scene.start('title')));
      });
    };
    this.input.keyboard.on('keydown', insertCoin);
    this.input.on('pointerdown', insertCoin);
    if (this.input.gamepad) this.input.gamepad.on('down', insertCoin);
  }
}
