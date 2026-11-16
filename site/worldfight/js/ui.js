import { Sound } from './audio.js';
import { FONT, W, H } from './data.js';

// Linhas de varredura de monitor CRT por cima de tudo.
export function addScanlines(scene, alpha = 0.18) {
  if (!scene.textures.exists('scanline')) {
    const g = scene.make.graphics({ x: 0, y: 0 }, false);
    g.fillStyle(0x000000, 1).fillRect(0, 0, 4, 2);
    g.generateTexture('scanline', 4, 4);
    g.destroy();
  }
  return scene.add.tileSprite(W / 2, H / 2, W, H, 'scanline').setAlpha(alpha).setDepth(1000);
}

// Indicador "SOM ON/OFF" no canto (clique ou tecla M).
export function addMuteToggle(scene, onChange) {
  const label = () => (Sound.muted ? 'SOM: OFF (M)' : 'SOM: ON (M)');
  const t = scene.add.text(W - 12, 10, label(), { fontFamily: FONT, fontSize: '10px', color: '#9fb4ff' })
    .setOrigin(1, 0).setDepth(1001).setInteractive({ useHandCursor: true });
  const toggle = () => {
    Sound.unlock();
    const muted = Sound.toggleMute();
    t.setText(label());
    onChange?.(muted);
  };
  t.on('pointerdown', toggle);
  return { toggle };
}

// Fala do locutor ("MOLÚSCULO!", "ROUND ONE!", "FIGHT!"...), respeitando o botão de som.
// Quando há uma segunda tomada gravada (voice-<id>-2), sorteia entre as duas.
export function say(scene, id, delay = 0) {
  let key = `voice-${id}`;
  if (Math.random() < 0.5 && scene.cache.audio.exists(`${key}-2`)) key = `${key}-2`;
  if (Sound.muted || !scene.cache.audio.exists(key)) return;
  scene.time.delayedCall(delay, () => scene.sound.play(key, { volume: 1 }));
}

// Jogo online: o outro jogador saiu ou a conexão caiu. Avisa e volta para a tela-título.
export function showNetLost(scene, reason) {
  if (!scene.scene.isActive() || scene.netLostShown) return;
  scene.netLostShown = true;
  Sound.sfx('cancel');
  scene.add.rectangle(W / 2, H / 2, W, H, 0x000000, 0.8).setDepth(2000).setInteractive();
  scene.add.text(W / 2, H / 2 - 24, reason === 'bye' ? 'O OPONENTE SAIU' : 'CONEXÃO PERDIDA', {
    fontFamily: FONT, fontSize: '34px', color: '#ff5a3a', stroke: '#000', strokeThickness: 8,
  }).setOrigin(0.5).setDepth(2001);
  scene.add.text(W / 2, H / 2 + 36, 'VOLTANDO AO MENU...', { fontFamily: FONT, fontSize: '14px', color: '#ffffff' })
    .setOrigin(0.5).setDepth(2001);
  scene.time.delayedCall(2600, () => {
    Sound.stop(0.3);
    scene.scene.start('title');
  });
}

// Pisca "de fliperama": fica aceso mais tempo do que apagado, para dar tempo de ler.
// Devolve { remove() }, que para de piscar e deixa o texto aceso.
export function blink(scene, target, onMs = 900, offMs = 400) {
  let lit = true;
  let timer = null;
  target.setAlpha(1);
  const flip = () => {
    lit = !lit;
    target.setAlpha(lit ? 1 : 0);
    timer = scene.time.delayedCall(lit ? onMs : offMs, flip);
  };
  timer = scene.time.delayedCall(onMs, flip);
  return {
    remove() {
      timer?.remove();
      timer = null;
      if (target.active) target.setAlpha(1);
    },
  };
}
