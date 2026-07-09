// Глобальные константы мира и настройки игры.

export const CHUNK = 16;        // размер чанка по X/Z
export const WORLD_H = 80;      // высота мира
export const SEA = 26;          // уровень моря
export const DAY_LENGTH = 600;  // длительность суток, секунд

export const Settings = {
  sensitivity: 1.0,
  volume: 0.7,
  renderDistance: 5,   // в чанках
  quality: 'medium',
  shadows: false,
};

export const QUALITY = {
  low:    { pixelRatio: 0.75, rain: 700,  dust: 80,  shadowSize: 1024 },
  medium: { pixelRatio: 1.0,  rain: 1800, dust: 160, shadowSize: 2048 },
  high:   { pixelRatio: Math.min(window.devicePixelRatio || 1, 2), rain: 3500, dust: 260, shadowSize: 2048 },
};

const SETTINGS_KEY = 'voxelia_settings_v1';

export function loadSettings() {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (raw) Object.assign(Settings, JSON.parse(raw));
  } catch (e) { /* повреждённые настройки игнорируем */ }
}

export function saveSettings() {
  try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(Settings)); } catch (e) {}
}

export function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
export function lerp(a, b, t) { return a + (b - a) * t; }
export function smoothstep(a, b, t) {
  t = clamp((t - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
}
