// Полностью процедурный звук через WebAudio — без внешних аудиофайлов.
import { Settings } from './config.js';

export class AudioSys {
  constructor() {
    this.ctx = null;
    this.master = null;
    this.rainGain = null;
    this.underwater = false;
  }

  // Вызывается по первому клику пользователя (требование браузеров)
  init() {
    if (this.ctx) { this.ctx.resume(); return; }
    this.ctx = new (window.AudioContext || window.webkitAudioContext)();
    this.filter = this.ctx.createBiquadFilter();
    this.filter.type = 'lowpass';
    this.filter.frequency.value = 20000;
    this.master = this.ctx.createGain();
    this.master.gain.value = Settings.volume;
    this.master.connect(this.filter);
    this.filter.connect(this.ctx.destination);

    // буфер белого шума — основа большинства звуков
    const len = this.ctx.sampleRate * 2;
    this.noiseBuf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const d = this.noiseBuf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;

    // зацикленный шум дождя
    const rainSrc = this.ctx.createBufferSource();
    rainSrc.buffer = this.noiseBuf;
    rainSrc.loop = true;
    const rainFilter = this.ctx.createBiquadFilter();
    rainFilter.type = 'lowpass';
    rainFilter.frequency.value = 900;
    this.rainGain = this.ctx.createGain();
    this.rainGain.gain.value = 0;
    rainSrc.connect(rainFilter).connect(this.rainGain).connect(this.master);
    rainSrc.start();
  }

  setVolume(v) { if (this.master) this.master.gain.value = v; }

  setUnderwater(on) {
    if (!this.ctx || this.underwater === on) return;
    this.underwater = on;
    this.filter.frequency.setTargetAtTime(on ? 500 : 20000, this.ctx.currentTime, 0.1);
  }

  setRain(level) {
    if (this.rainGain) this.rainGain.gain.setTargetAtTime(level * 0.14, this.ctx.currentTime, 0.5);
  }

  burst({ dur = 0.12, vol = 0.4, freq = 800, freqEnd = 0, type = 'lowpass', q = 1, delay = 0 }) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime + delay;
    const src = this.ctx.createBufferSource();
    src.buffer = this.noiseBuf;
    src.playbackRate.value = 0.8 + Math.random() * 0.4;
    const f = this.ctx.createBiquadFilter();
    f.type = type; f.Q.value = q;
    f.frequency.setValueAtTime(freq, t);
    if (freqEnd) f.frequency.exponentialRampToValueAtTime(freqEnd, t + dur);
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    src.connect(f).connect(g).connect(this.master);
    src.start(t, Math.random());
    src.stop(t + dur + 0.05);
  }

  tone({ freq = 440, dur = 0.08, vol = 0.2, type = 'square', delay = 0 }) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime + delay;
    const o = this.ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    o.connect(g).connect(this.master);
    o.start(t); o.stop(t + dur + 0.05);
  }

  step(mat) {
    const v = 0.16 + Math.random() * 0.05;
    switch (mat) {
      case 'grass': this.burst({ dur: 0.07, vol: v, freq: 380 }); break;
      case 'sand':  this.burst({ dur: 0.1, vol: v, freq: 520 }); break;
      case 'snow':  this.burst({ dur: 0.09, vol: v, freq: 300 }); break;
      case 'wood':  this.burst({ dur: 0.06, vol: v, freq: 700 }); this.tone({ freq: 160, dur: 0.04, vol: 0.06, type: 'sine' }); break;
      default:      this.burst({ dur: 0.05, vol: v, freq: 1400, type: 'highpass' }); break;
    }
  }

  breakBlock(mat) {
    this.burst({ dur: 0.18, vol: 0.5, freq: mat === 'stone' ? 1000 : 500, freqEnd: 180 });
    this.tone({ freq: 120, dur: 0.08, vol: 0.12, type: 'sine' });
  }

  placeBlock() {
    this.burst({ dur: 0.08, vol: 0.35, freq: 620 });
    this.tone({ freq: 200, dur: 0.05, vol: 0.1, type: 'sine' });
  }

  jump() { this.burst({ dur: 0.05, vol: 0.1, freq: 500 }); }
  pop() {
    this.tone({ freq: 550, dur: 0.07, vol: 0.16, type: 'sine' });
    this.tone({ freq: 880, dur: 0.06, vol: 0.12, type: 'sine', delay: 0.05 });
  }
  hitAnimal() { this.burst({ dur: 0.09, vol: 0.3, freq: 650, freqEnd: 250 }); }
  munch() {
    this.burst({ dur: 0.09, vol: 0.25, freq: 900 });
    this.burst({ dur: 0.09, vol: 0.2, freq: 700, delay: 0.13 });
    this.burst({ dur: 0.09, vol: 0.18, freq: 800, delay: 0.26 });
  }
  animal(type) {
    switch (type) {
      case 'chicken':
        this.tone({ freq: 900 + Math.random() * 200, dur: 0.08, vol: 0.14, type: 'square' });
        this.tone({ freq: 760, dur: 0.07, vol: 0.1, type: 'square', delay: 0.11 });
        break;
      case 'pig':
        this.tone({ freq: 160, dur: 0.16, vol: 0.2, type: 'sawtooth' });
        this.tone({ freq: 115, dur: 0.12, vol: 0.16, type: 'sawtooth', delay: 0.15 });
        break;
      case 'sheep': // блеяние с вибрато
        for (let i = 0; i < 5; i++) {
          this.tone({ freq: i % 2 ? 430 : 470, dur: 0.07, vol: 0.14, type: 'sawtooth', delay: i * 0.06 });
        }
        break;
      case 'cow':
        this.tone({ freq: 170, dur: 0.45, vol: 0.22, type: 'sawtooth' });
        this.tone({ freq: 125, dur: 0.4, vol: 0.18, type: 'sawtooth', delay: 0.12 });
        break;
      case 'zombie': // низкий стон
        this.tone({ freq: 110, dur: 0.35, vol: 0.2, type: 'sawtooth' });
        this.tone({ freq: 85, dur: 0.45, vol: 0.18, type: 'sawtooth', delay: 0.2 });
        break;
      case 'skeleton': // костяной стук
        for (let i = 0; i < 4; i++) {
          this.burst({ dur: 0.04, vol: 0.14, freq: 1800, type: 'highpass', delay: i * 0.09 });
        }
        break;
    }
  }
  arrow() { this.burst({ dur: 0.14, vol: 0.2, freq: 2200, freqEnd: 500, type: 'bandpass', q: 3 }); }

  // --- оружие (Блок-Страйк) ---
  gunShot(type) {
    switch (type) {
      case 'ak':
        this.burst({ dur: 0.09, vol: 0.5, freq: 1600, freqEnd: 300 });
        this.tone({ freq: 130, dur: 0.06, vol: 0.28, type: 'square' });
        break;
      case 'awp':
        this.burst({ dur: 0.4, vol: 0.7, freq: 900, freqEnd: 110 });
        this.tone({ freq: 68, dur: 0.28, vol: 0.4, type: 'sine' });
        this.burst({ dur: 0.5, vol: 0.2, freq: 300, freqEnd: 80, delay: 0.08 }); // эхо
        break;
      case 'deagle':
        this.burst({ dur: 0.14, vol: 0.6, freq: 1250, freqEnd: 240 });
        this.tone({ freq: 95, dur: 0.09, vol: 0.3, type: 'square' });
        break;
      case 'knife':
        this.burst({ dur: 0.08, vol: 0.22, freq: 2600, freqEnd: 900, type: 'bandpass', q: 2 });
        break;
    }
  }
  knifeHit() { this.burst({ dur: 0.1, vol: 0.4, freq: 700, freqEnd: 250 }); }
  reloadSnd() {
    this.tone({ freq: 900, dur: 0.04, vol: 0.15, type: 'square' });
    this.tone({ freq: 600, dur: 0.05, vol: 0.15, type: 'square', delay: 0.25 });
    this.tone({ freq: 1100, dur: 0.04, vol: 0.15, type: 'square', delay: 0.55 });
  }
  emptyClick() { this.tone({ freq: 1400, dur: 0.03, vol: 0.15, type: 'square' }); }
  hitmark() { this.tone({ freq: 1150, dur: 0.045, vol: 0.2, type: 'square' }); }
  headshotDing() {
    this.tone({ freq: 1500, dur: 0.07, vol: 0.22, type: 'sine' });
    this.tone({ freq: 2100, dur: 0.09, vol: 0.18, type: 'sine', delay: 0.05 });
  }
  zoomClick() { this.tone({ freq: 800, dur: 0.03, vol: 0.1, type: 'square' }); }
  roundStartSnd() {
    this.tone({ freq: 520, dur: 0.1, vol: 0.2, type: 'square' });
    this.tone({ freq: 780, dur: 0.14, vol: 0.2, type: 'square', delay: 0.12 });
  }
  winSnd() {
    for (let i = 0; i < 3; i++) this.tone({ freq: 520 + i * 180, dur: 0.12, vol: 0.2, type: 'square', delay: i * 0.13 });
  }
  loseSnd() {
    for (let i = 0; i < 3; i++) this.tone({ freq: 500 - i * 120, dur: 0.16, vol: 0.2, type: 'sawtooth', delay: i * 0.15 });
  }
  deathSnd() {
    this.tone({ freq: 220, dur: 0.3, vol: 0.25, type: 'sawtooth' });
    this.tone({ freq: 140, dur: 0.35, vol: 0.2, type: 'sawtooth', delay: 0.1 });
  }
  land() { this.burst({ dur: 0.09, vol: 0.25, freq: 280 }); }
  splash() { this.burst({ dur: 0.35, vol: 0.4, freq: 950, freqEnd: 250 }); }
  uiClick() { this.tone({ freq: 700, dur: 0.04, vol: 0.12 }); }
  hurt() { this.tone({ freq: 220, dur: 0.12, vol: 0.2, type: 'sawtooth' }); this.tone({ freq: 160, dur: 0.14, vol: 0.15, type: 'sawtooth', delay: 0.08 }); }

  thunder(delay = 1) {
    if (!this.ctx) return;
    this.burst({ dur: 2.6, vol: 0.7, freq: 160, freqEnd: 45, delay });
    this.burst({ dur: 1.2, vol: 0.4, freq: 90, freqEnd: 40, delay: delay + 0.35 });
    const t = this.ctx.currentTime + delay;
    const o = this.ctx.createOscillator();
    o.type = 'sine'; o.frequency.setValueAtTime(48, t);
    o.frequency.exponentialRampToValueAtTime(28, t + 2);
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.25, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 2.4);
    o.connect(g).connect(this.master);
    o.start(t); o.stop(t + 2.5);
  }
}
