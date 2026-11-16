// Traduz teclado e controles em ações por jogador: up/down/left/right/confirm/back.
//
// Modo "solo" (menus e arcade): setas ou WASD; Enter, Espaço ou J confirmam; Esc volta.
// Modo "versus": 1P = WASD + J/Espaço/F (Esc volta); 2P = setas + Enter/Numpad0/Numpad1 (Backspace volta).
// Controle 1 (Xbox etc.) é o 1P; controle 2 é o 2P.

const SOLO = {
  ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right',
  KeyW: 'up', KeyS: 'down', KeyA: 'left', KeyD: 'right',
  Enter: 'confirm', NumpadEnter: 'confirm', Space: 'confirm', KeyJ: 'confirm',
  Escape: 'back', Backspace: 'back',
};
const VERSUS_P1 = {
  KeyW: 'up', KeyS: 'down', KeyA: 'left', KeyD: 'right',
  KeyJ: 'confirm', Space: 'confirm', KeyF: 'confirm', Escape: 'back',
};
const VERSUS_P2 = {
  ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right',
  Enter: 'confirm', NumpadEnter: 'confirm', Numpad0: 'confirm', Numpad1: 'confirm', Backspace: 'back',
};
const PAD = { 12: 'up', 13: 'down', 14: 'left', 15: 'right', 0: 'confirm', 9: 'confirm', 1: 'back', 8: 'back' };

export function bindControls(scene, mode, handler) {
  const onKey = (e) => {
    if (e.repeat) return;
    if (e.code === 'KeyM') { handler(0, 'mute'); return; }
    let player = 0, action;
    if (mode === 'versus') {
      action = VERSUS_P1[e.code];
      if (!action) { action = VERSUS_P2[e.code]; player = 1; }
    } else {
      action = SOLO[e.code];
    }
    if (action) {
      e.preventDefault?.();
      handler(player, action);
    }
  };
  scene.input.keyboard.on('keydown', onKey);

  const onPad = (pad, button) => {
    const action = PAD[button.index];
    if (!action) return;
    handler(mode === 'versus' ? Math.min(pad.index, 1) : 0, action);
  };
  if (scene.input.gamepad) scene.input.gamepad.on('down', onPad);

  scene.events.once('shutdown', () => {
    scene.input.keyboard.off('keydown', onKey);
    if (scene.input.gamepad) scene.input.gamepad.off('down', onPad);
  });
}
