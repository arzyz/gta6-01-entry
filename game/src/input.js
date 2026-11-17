// Keyboard & mouse, shaped the way the game loop wants them.
//
// Three channels come out of this module:
//   - held keys, read live each step (movement, driving, sprint, handbrake);
//   - one-shot presses, delivered as ACTION_* bit flags and consumed exactly once —
//     the main loop drains the queue a single time per frame and shares the flags out,
//     so a tap of E or P can neither be lost between frames nor fire twice;
//   - the mouse: position in canvas pixels, whether the button is held (pistol fire),
//     and a one-shot "clicked" flag (menu taps and fist punches).
// Losing window focus clears everything held and drops any queued presses, so Marco
// never keeps sprinting — or fires a stale punch — after the player alt-tabs back.

export const ACTION_CONFIRM = 1;
export const ACTION_PAUSE = 2;
export const ACTION_ENTER_CAR = 4;
export const ACTION_PUNCH = 8;
export const ACTION_WEAPON_1 = 16;
export const ACTION_WEAPON_2 = 32;
export const ACTION_MUTE = 64;
export const ACTION_CONTINUE = 128;

/** Keys that mean "held down" rather than "pressed once". */
const HELD_CODES = [
  'KeyW', 'KeyA', 'KeyS', 'KeyD',
  'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight',
  'ShiftLeft', 'ShiftRight', 'Space',
];

/** Key code -> the one-shot flag a press of it raises. */
const PRESS_FLAGS = {
  Enter: ACTION_CONFIRM,
  KeyP: ACTION_PAUSE,
  Escape: ACTION_PAUSE,
  KeyE: ACTION_ENTER_CAR,
  KeyF: ACTION_PUNCH,
  Digit1: ACTION_WEAPON_1,
  Digit2: ACTION_WEAPON_2,
  KeyM: ACTION_MUTE,
  KeyC: ACTION_CONTINUE,
};

export function createInput(canvas) {
  const held = new Set();
  const heldLookup = new Set(HELD_CODES);
  let pending = 0;
  let mouseX = 0;
  let mouseY = 0;
  let buttonDown = false;
  let clickQueued = false;

  function trackMouse(event) {
    const rect = canvas.getBoundingClientRect();
    mouseX = event.clientX - rect.left;
    mouseY = event.clientY - rect.top;
  }

  window.addEventListener('keydown', (event) => {
    if (heldLookup.has(event.code)) {
      held.add(event.code);
      event.preventDefault(); // keep arrows/space from scrolling the page
    }
    const flag = PRESS_FLAGS[event.code];
    if (flag !== undefined) {
      if (!event.repeat) pending |= flag;
      event.preventDefault();
    }
  });
  window.addEventListener('keyup', (event) => {
    held.delete(event.code);
  });
  window.addEventListener('blur', () => {
    // A key released while the tab is hidden never sends its keyup — and a press queued
    // before the switch should not fire on return. Drop the lot.
    held.clear();
    pending = 0;
    buttonDown = false;
    clickQueued = false;
  });
  canvas.addEventListener('pointermove', trackMouse);
  canvas.addEventListener('pointerdown', (event) => {
    buttonDown = true;
    clickQueued = true;
    trackMouse(event);
  });
  window.addEventListener('pointerup', () => {
    buttonDown = false;
  });

  return {
    /** Is this key code (e.g. 'KeyW') currently held down? */
    down(code) { return held.has(code); },
    /** Drain the one-shot ACTION_* flags raised since the previous call. */
    takeActions() {
      const flags = pending;
      pending = 0;
      return flags;
    },
    /** Mouse position in CSS pixels relative to the canvas corner. */
    mouse() { return { x: mouseX, y: mouseY }; },
    /** Is the mouse button held right now? (Sustained pistol fire.) */
    firing() { return buttonDown; },
    /** Drain the fresh-click flag (title-screen taps, fist punches). */
    takeClick() {
      const was = clickQueued;
      clickQueued = false;
      return was;
    },
  };
}
