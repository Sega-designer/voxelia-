// Погода: ясно / дождь / гроза / туман + молнии.
import { lerp } from './config.js';

export const WEATHER = { CLEAR: 0, RAIN: 1, STORM: 2, FOG: 3 };
export const WEATHER_NAMES = ['Ясно', 'Дождь', 'Гроза', 'Туман'];

export class Weather {
  constructor(audio) {
    this.audio = audio;
    this.type = WEATHER.CLEAR;
    this.timer = 45 + Math.random() * 45;
    this.rain = 0;          // текущая интенсивность дождя 0..1
    this.fogFactor = 0;     // плотность тумана 0..1
    this.darkness = 0;      // затемнение неба 0..1
    this.flash = 0;         // вспышка молнии
    this.lightningTimer = 5;
    this.onLightning = null;
  }

  targetFor(type) {
    switch (type) {
      case WEATHER.RAIN: return { rain: 0.7, fog: 0.25, dark: 0.45 };
      case WEATHER.STORM: return { rain: 1.0, fog: 0.35, dark: 0.75 };
      case WEATHER.FOG: return { rain: 0, fog: 0.75, dark: 0.2 };
      default: return { rain: 0, fog: 0, dark: 0 };
    }
  }

  pickNext() {
    const r = Math.random();
    if (this.type !== WEATHER.CLEAR) return WEATHER.CLEAR; // после непогоды всегда проясняется
    if (r < 0.45) return WEATHER.RAIN;
    if (r < 0.62) return WEATHER.STORM;
    if (r < 0.82) return WEATHER.FOG;
    return WEATHER.CLEAR;
  }

  // frozen=true у сетевого гостя: тип погоды и молнии приходят от хоста
  update(dt, frozen = false) {
    if (!frozen) {
      this.timer -= dt;
      if (this.timer <= 0) {
        this.type = this.pickNext();
        this.timer = this.type === WEATHER.CLEAR ? 60 + Math.random() * 120 : 40 + Math.random() * 60;
      }
    }

    const t = this.targetFor(this.type);
    const k = 1 - Math.exp(-0.35 * dt); // плавный переход ~5 сек
    this.rain = lerp(this.rain, t.rain, k);
    this.fogFactor = lerp(this.fogFactor, t.fog, k);
    this.darkness = lerp(this.darkness, t.dark, k);

    // молнии в грозу
    this.flash = Math.max(0, this.flash - dt * 4);
    if (!frozen && this.type === WEATHER.STORM && this.rain > 0.6) {
      this.lightningTimer -= dt;
      if (this.lightningTimer <= 0) {
        this.lightningTimer = 3 + Math.random() * 9;
        this.flash = 1;
        if (this.audio) this.audio.thunder(0.4 + Math.random() * 2);
        if (this.onLightning) this.onLightning();
      }
    }

    if (this.audio) this.audio.setRain(this.rain);
  }
}
