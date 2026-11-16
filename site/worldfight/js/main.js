import { FONT, H, W } from './data.js';
import { BootScene } from './scenes/boot.js';
import { FightScene } from './scenes/fight.js';
import { OnlineScene } from './scenes/online.js';
import { SelectScene } from './scenes/select.js';
import { TitleScene } from './scenes/title.js';
import { VersusScene } from './scenes/versus.js';

// A fonte precisa estar carregada antes do Phaser desenhar o primeiro texto.
try { await document.fonts.load(`16px ${FONT}`); } catch (e) { /* segue com a fonte padrão */ }

window.game = new Phaser.Game({
  type: Phaser.AUTO,
  parent: 'game',
  width: W,
  height: H,
  backgroundColor: '#000000',
  scale: { mode: Phaser.Scale.FIT, autoCenter: Phaser.Scale.CENTER_BOTH },
  input: { gamepad: true },
  scene: [BootScene, TitleScene, OnlineScene, SelectScene, VersusScene, FightScene],
});

// Celular e tablet: tela cheia (sem barra do navegador) e deitado. O navegador só deixa entrar em tela
// cheia depois de um toque, então tenta a cada toque enquanto não estiver em tela cheia — o primeiro é o
// "TOQUE NA TELA" da abertura; se a pessoa sair (gesto de voltar), o próximo toque volta.
// iPhone não tem tela cheia para páginas: lá vale "Adicionar à Tela de Início" (meta tags no index.html).
const mobile = matchMedia('(pointer: coarse)').matches || navigator.maxTouchPoints > 1;
if (mobile) {
  const root = document.documentElement;
  const enter = root.requestFullscreen || root.webkitRequestFullscreen;
  const isFull = () => document.fullscreenElement || document.webkitFullscreenElement;
  const goFull = () => {
    if (!enter || isFull()) return;
    try {
      const p = enter.call(root, { navigationUI: 'hide' });
      Promise.resolve(p).then(() => screen.orientation?.lock?.('landscape')).catch(() => {});
    } catch (e) { /* navegador sem tela cheia */ }
  };
  document.addEventListener('touchend', goFull, { passive: true });
  document.addEventListener('click', goFull);
}
