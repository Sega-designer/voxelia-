// Ввод: клавиатура, мышь (pointer lock), колесо.
import { Settings, clamp } from '../config.js';
import { Binds } from '../keybinds.js';

export class Input {
  constructor(canvas) {
    this.canvas = canvas;
    this.keys = new Set();
    this.mouseDX = 0;
    this.mouseDY = 0;
    this.buttons = new Set();
    this.locked = false;
    this.onWheel = null;
    this.onKey = null;

    document.addEventListener('keydown', (e) => {
      if (this.locked && (e.code === 'F3' || e.code === 'Tab' || Object.values(Binds).includes(e.code))) e.preventDefault();
      if (!e.repeat) {
        this.keys.add(e.code);
        if (this.onKey) this.onKey(e.code, e);
      }
    });
    document.addEventListener('keyup', (e) => this.keys.delete(e.code));
    window.addEventListener('blur', () => this.keys.clear());

    document.addEventListener('mousemove', (e) => {
      if (!this.locked) return;
      this.mouseDX += e.movementX;
      this.mouseDY += e.movementY;
    });
    document.addEventListener('mousedown', (e) => {
      if (this.locked) this.buttons.add(e.button);
    });
    document.addEventListener('mouseup', (e) => this.buttons.delete(e.button));
    document.addEventListener('contextmenu', (e) => e.preventDefault());
    document.addEventListener('wheel', (e) => {
      if (this.locked && this.onWheel) this.onWheel(Math.sign(e.deltaY));
    }, { passive: true });

    document.addEventListener('pointerlockchange', () => {
      this.locked = document.pointerLockElement === this.canvas;
      if (!this.locked) { this.keys.clear(); this.buttons.clear(); }
      if (this.onLockChange) this.onLockChange(this.locked);
    });
  }

  requestLock() {
    if (!this.locked) this.canvas.requestPointerLock();
  }

  releaseLock() {
    if (this.locked) document.exitPointerLock();
  }

  // Применить накопленное движение мыши к игроку
  applyLook(player) {
    const s = 0.0022 * Settings.sensitivity;
    player.yaw -= this.mouseDX * s;
    player.pitch = clamp(player.pitch - this.mouseDY * s, -Math.PI / 2 + 0.01, Math.PI / 2 - 0.01);
    this.mouseDX = 0;
    this.mouseDY = 0;
  }
}
