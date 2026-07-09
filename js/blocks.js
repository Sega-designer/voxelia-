// Реестр блоков + процедурная генерация текстур (атлас, вода, лава, иконки).
import * as THREE from 'three';
import { mulberry32 } from './noise.js';

export const B = {
  AIR: 0, GRASS: 1, DIRT: 2, STONE: 3, SAND: 4, WOOD: 5, LEAVES: 6,
  WATER: 7, LAVA: 8, COAL: 9, IRON: 10, GLASS: 11, PLANKS: 12,
  BRICK: 13, SNOW: 14, WOOL: 15, MEAT: 16, LEATHER: 17, FEATHER: 18,
  BONE: 19,
};

// tiles: индексы тайлов в атласе {top, bottom, side}
export const BLOCKS = [
  { name: 'Воздух', opaque: false, solid: false },
  { name: 'Дёрн',     opaque: true,  solid: true, tiles: { top: 0, bottom: 2, side: 1 },  hardness: 0.45, sound: 'grass', color: 0x58a838 },
  { name: 'Земля',    opaque: true,  solid: true, tiles: { top: 2, bottom: 2, side: 2 },  hardness: 0.45, sound: 'grass', color: 0x7a5230 },
  { name: 'Камень',   opaque: true,  solid: true, tiles: { top: 3, bottom: 3, side: 3 },  hardness: 1.0,  sound: 'stone', color: 0x8a8a8a },
  { name: 'Песок',    opaque: true,  solid: true, tiles: { top: 4, bottom: 4, side: 4 },  hardness: 0.4,  sound: 'sand',  color: 0xddd09a },
  { name: 'Бревно',   opaque: true,  solid: true, tiles: { top: 6, bottom: 6, side: 5 },  hardness: 0.7,  sound: 'wood',  color: 0x6b4a2b },
  { name: 'Листва',   opaque: false, solid: true, cutout: true, tiles: { top: 7, bottom: 7, side: 7 }, hardness: 0.2, sound: 'grass', color: 0x3f7d2c },
  { name: 'Вода',     opaque: false, solid: false, fluid: true, color: 0x3b6ed0 },
  { name: 'Лава',     opaque: false, solid: false, fluid: true, color: 0xe06010 },
  { name: 'Уголь',    opaque: true,  solid: true, tiles: { top: 8, bottom: 8, side: 8 },  hardness: 1.1,  sound: 'stone', color: 0x4a4a4a },
  { name: 'Руда',     opaque: true,  solid: true, tiles: { top: 9, bottom: 9, side: 9 },  hardness: 1.2,  sound: 'stone', color: 0xd8a870 },
  { name: 'Стекло',   opaque: false, solid: true, cutout: true, tiles: { top: 10, bottom: 10, side: 10 }, hardness: 0.2, sound: 'stone', color: 0xcfe8ef },
  { name: 'Доски',    opaque: true,  solid: true, tiles: { top: 11, bottom: 11, side: 11 }, hardness: 0.7, sound: 'wood',  color: 0xa97e4b },
  { name: 'Кирпич',   opaque: true,  solid: true, tiles: { top: 12, bottom: 12, side: 12 }, hardness: 1.0, sound: 'stone', color: 0x9c5040 },
  { name: 'Снег',     opaque: true,  solid: true, tiles: { top: 13, bottom: 2, side: 14 }, hardness: 0.4,  sound: 'snow',  color: 0xf2f6fa },
  { name: 'Шерсть',   opaque: true,  solid: true, tiles: { top: 15, bottom: 15, side: 15 }, hardness: 0.4, sound: 'grass', color: 0xe8e4dc },
  // предметы (не ставятся в мир)
  { name: 'Мясо',     opaque: false, solid: false, item: true, food: 3, tiles: { top: 16, bottom: 16, side: 16 }, color: 0xc04038 },
  { name: 'Кожа',     opaque: false, solid: false, item: true, tiles: { top: 17, bottom: 17, side: 17 }, color: 0x9a6a3a },
  { name: 'Перо',     opaque: false, solid: false, item: true, tiles: { top: 18, bottom: 18, side: 18 }, color: 0xf0f0f0 },
  { name: 'Кость',    opaque: false, solid: false, item: true, tiles: { top: 19, bottom: 19, side: 19 }, color: 0xe4e4da },
];

// Блоки, доступные для установки в инвентаре
export const PLACEABLE = [
  B.GRASS, B.DIRT, B.STONE, B.SAND, B.WOOD, B.LEAVES, B.PLANKS,
  B.GLASS, B.BRICK, B.SNOW, B.WOOL, B.COAL, B.IRON, B.WATER, B.LAVA,
];

export const ATLAS_COLS = 8;
const T = 16; // размер тайла в пикселях

function shade(hex, amt) {
  const r = Math.min(255, Math.max(0, ((hex >> 16) & 255) + amt));
  const g = Math.min(255, Math.max(0, ((hex >> 8) & 255) + amt));
  const b = Math.min(255, Math.max(0, (hex & 255) + amt));
  return `rgb(${r},${g},${b})`;
}

// Рисуем атлас процедурно — никакие внешние ассеты не используются.
function drawAtlas() {
  const cv = document.createElement('canvas');
  cv.width = T * ATLAS_COLS; cv.height = T * ATLAS_COLS;
  const g = cv.getContext('2d');
  const rnd = mulberry32(987654);

  const ox = i => (i % ATLAS_COLS) * T;
  const oy = i => Math.floor(i / ATLAS_COLS) * T;

  function fillNoise(i, base, vary) {
    for (let y = 0; y < T; y++) for (let x = 0; x < T; x++) {
      g.fillStyle = shade(base, ((rnd() - 0.5) * vary) | 0);
      g.fillRect(ox(i) + x, oy(i) + y, 1, 1);
    }
  }
  function dots(i, color, count, size = 1) {
    g.fillStyle = color;
    for (let k = 0; k < count; k++) {
      g.fillRect(ox(i) + (rnd() * (T - size)) | 0, oy(i) + (rnd() * (T - size)) | 0, size, size);
    }
  }

  // 0: трава сверху
  fillNoise(0, 0x58a838, 40);
  dots(0, shade(0x58a838, 35), 12);
  // 1: трава сбоку (земля + зелёная кромка)
  fillNoise(1, 0x7a5230, 34);
  for (let x = 0; x < T; x++) {
    const depth = 3 + ((rnd() * 2.5) | 0);
    for (let y = 0; y < depth; y++) {
      g.fillStyle = shade(0x58a838, ((rnd() - 0.5) * 36) | 0);
      g.fillRect(ox(1) + x, oy(1) + y, 1, 1);
    }
  }
  // 2: земля
  fillNoise(2, 0x7a5230, 36);
  dots(2, shade(0x7a5230, -30), 10, 2);
  // 3: камень
  fillNoise(3, 0x8a8a8a, 26);
  dots(3, shade(0x8a8a8a, -28), 7, 2);
  dots(3, shade(0x8a8a8a, 18), 5, 2);
  // 4: песок
  fillNoise(4, 0xddd09a, 22);
  dots(4, shade(0xddd09a, -26), 9);
  // 5: бревно сбоку (вертикальные волокна)
  for (let x = 0; x < T; x++) {
    const stripe = (x % 4 < 2) ? 0x6b4a2b : 0x5a3d22;
    for (let y = 0; y < T; y++) {
      g.fillStyle = shade(stripe, ((rnd() - 0.5) * 22) | 0);
      g.fillRect(ox(5) + x, oy(5) + y, 1, 1);
    }
  }
  // 6: спил бревна (кольца)
  fillNoise(6, 0x8a6238, 18);
  g.strokeStyle = shade(0x5a3d22, 0);
  for (let r = 2; r < 8; r += 2) g.strokeRect(ox(6) + 8 - r, oy(6) + 8 - r, r * 2, r * 2);
  // 7: листва (с прозрачными "дырками")
  fillNoise(7, 0x3f7d2c, 48);
  dots(7, shade(0x3f7d2c, -40), 12);
  for (let k = 0; k < 7; k++) {
    g.clearRect(ox(7) + (rnd() * 15) | 0, oy(7) + (rnd() * 15) | 0, 1, 1);
  }
  // 8: уголь
  fillNoise(8, 0x8a8a8a, 26);
  dots(8, '#1c1c1c', 6, 2);
  dots(8, '#333', 5, 1);
  // 9: руда (железо)
  fillNoise(9, 0x8a8a8a, 26);
  dots(9, '#d8a870', 6, 2);
  dots(9, '#b07840', 4, 1);
  // 10: стекло (в основном прозрачное, рамка + блики)
  g.clearRect(ox(10), oy(10), T, T);
  g.fillStyle = '#cfe8ef';
  g.fillRect(ox(10), oy(10), T, 1); g.fillRect(ox(10), oy(10) + T - 1, T, 1);
  g.fillRect(ox(10), oy(10), 1, T); g.fillRect(ox(10) + T - 1, oy(10), 1, T);
  g.fillStyle = 'rgba(220,240,250,0.85)';
  for (let k = 0; k < 5; k++) g.fillRect(ox(10) + 3 + k, oy(10) + 8 - k, 1, 1);
  for (let k = 0; k < 4; k++) g.fillRect(ox(10) + 9 + k, oy(10) + 13 - k, 1, 1);
  // 11: доски
  for (let y = 0; y < T; y++) for (let x = 0; x < T; x++) {
    const seamY = y % 4 === 3;
    const seamX = (y < 8 ? x === 11 : x === 4);
    const base = (seamY || seamX) ? 0x6e4c26 : 0xa97e4b;
    g.fillStyle = shade(base, ((rnd() - 0.5) * 20) | 0);
    g.fillRect(ox(11) + x, oy(11) + y, 1, 1);
  }
  // 12: кирпич
  for (let y = 0; y < T; y++) for (let x = 0; x < T; x++) {
    const row = (y / 4) | 0;
    const mortarY = y % 4 === 3;
    const mortarX = ((x + row * 4) % 8) === 7;
    const base = (mortarY || mortarX) ? 0xcabba8 : 0x9c5040;
    g.fillStyle = shade(base, ((rnd() - 0.5) * 18) | 0);
    g.fillRect(ox(12) + x, oy(12) + y, 1, 1);
  }
  // 13: снег
  fillNoise(13, 0xf2f6fa, 12);
  dots(13, '#ffffff', 10);
  // 14: снег сбоку (земля + снежная шапка)
  fillNoise(14, 0x7a5230, 34);
  for (let x = 0; x < T; x++) {
    const depth = 3 + ((rnd() * 2) | 0);
    for (let y = 0; y < depth; y++) {
      g.fillStyle = shade(0xf2f6fa, ((rnd() - 0.5) * 14) | 0);
      g.fillRect(ox(14) + x, oy(14) + y, 1, 1);
    }
  }
  // 15: шерсть
  fillNoise(15, 0xe8e4dc, 14);
  dots(15, '#cfc8ba', 10, 2);
  dots(15, '#ffffff', 8);
  // 16: мясо
  fillNoise(16, 0xc04038, 28);
  for (let k = 0; k < 3; k++) {
    g.fillStyle = '#e89888';
    for (let i = 0; i < 9; i++) g.fillRect(ox(16) + 2 + i + k * 3, oy(16) + 12 - i, 1, 1);
  }
  g.strokeStyle = '#7a2018';
  g.strokeRect(ox(16) + 0.5, oy(16) + 0.5, T - 1, T - 1);
  // 17: кожа
  fillNoise(17, 0x9a6a3a, 22);
  dots(17, '#6a4520', 8);
  for (let i = 1; i < T; i += 3) {
    g.fillStyle = '#6a4520';
    g.fillRect(ox(17) + i, oy(17) + 1, 1, 1);
    g.fillRect(ox(17) + i, oy(17) + T - 2, 1, 1);
  }
  // 18: перо (на прозрачном фоне)
  g.clearRect(ox(18), oy(18), T, T);
  for (let i = 0; i < 10; i++) {
    g.fillStyle = i % 2 ? '#f4f4f0' : '#e0e0da';
    g.fillRect(ox(18) + 3 + i, oy(18) + 12 - i, 2, 2);
  }
  g.fillStyle = '#b0aa9a';
  for (let i = 0; i < 11; i++) g.fillRect(ox(18) + 3 + i, oy(18) + 13 - i, 1, 1);
  // 19: кость (на прозрачном фоне)
  g.clearRect(ox(19), oy(19), T, T);
  g.fillStyle = '#e4e4da';
  for (let i = 0; i < 8; i++) g.fillRect(ox(19) + 4 + i, oy(19) + 11 - i, 2, 2);
  g.fillRect(ox(19) + 2, oy(19) + 11, 3, 3); g.fillRect(ox(19) + 4, oy(19) + 12, 2, 3);
  g.fillRect(ox(19) + 11, oy(19) + 2, 3, 3); g.fillRect(ox(19) + 10, oy(19) + 1, 2, 3);
  g.fillStyle = '#c4c4b8';
  for (let i = 0; i < 7; i++) g.fillRect(ox(19) + 5 + i, oy(19) + 12 - i, 1, 1);
  return cv;
}

function drawWaterTexture() {
  const cv = document.createElement('canvas');
  cv.width = 32; cv.height = 32;
  const g = cv.getContext('2d');
  const rnd = mulberry32(24680);
  for (let y = 0; y < 32; y++) for (let x = 0; x < 32; x++) {
    const wave = Math.sin((x + y * 2) * 0.6) * 14;
    g.fillStyle = shade(0x3b6ed0, (wave + (rnd() - 0.5) * 16) | 0);
    g.fillRect(x, y, 1, 1);
  }
  g.fillStyle = 'rgba(200,225,255,0.35)';
  for (let k = 0; k < 10; k++) g.fillRect((rnd() * 30) | 0, (rnd() * 30) | 0, 2, 1);
  return cv;
}

function drawLavaTexture() {
  const cv = document.createElement('canvas');
  cv.width = 32; cv.height = 32;
  const g = cv.getContext('2d');
  const rnd = mulberry32(13579);
  for (let y = 0; y < 32; y++) for (let x = 0; x < 32; x++) {
    const blob = Math.sin(x * 0.5) * Math.cos(y * 0.45) * 0.5 + 0.5;
    const base = blob > 0.62 ? 0xffb020 : blob > 0.3 ? 0xd8500f : 0x802000;
    g.fillStyle = shade(base, ((rnd() - 0.5) * 26) | 0);
    g.fillRect(x, y, 1, 1);
  }
  return cv;
}

let atlasCanvas = null;
const iconCache = new Map();

export function createMaterials() {
  atlasCanvas = drawAtlas();
  const atlas = new THREE.CanvasTexture(atlasCanvas);
  atlas.magFilter = THREE.NearestFilter;
  atlas.minFilter = THREE.NearestFilter;
  atlas.generateMipmaps = false;
  atlas.colorSpace = THREE.SRGBColorSpace;

  const waterTex = new THREE.CanvasTexture(drawWaterTexture());
  waterTex.magFilter = THREE.NearestFilter; waterTex.minFilter = THREE.NearestFilter;
  waterTex.wrapS = waterTex.wrapT = THREE.RepeatWrapping;
  waterTex.colorSpace = THREE.SRGBColorSpace;

  const lavaTex = new THREE.CanvasTexture(drawLavaTexture());
  lavaTex.magFilter = THREE.NearestFilter; lavaTex.minFilter = THREE.NearestFilter;
  lavaTex.wrapS = lavaTex.wrapT = THREE.RepeatWrapping;
  lavaTex.colorSpace = THREE.SRGBColorSpace;

  return {
    atlasTexture: atlas,
    waterTexture: waterTex,
    lavaTexture: lavaTex,
    opaque: new THREE.MeshLambertMaterial({ map: atlas, vertexColors: true }),
    cutout: new THREE.MeshLambertMaterial({ map: atlas, vertexColors: true, alphaTest: 0.5, side: THREE.DoubleSide }),
    water: new THREE.MeshLambertMaterial({ map: waterTex, vertexColors: true, transparent: true, opacity: 0.72, depthWrite: false, side: THREE.DoubleSide }),
    lava: new THREE.MeshBasicMaterial({ map: lavaTex, side: THREE.DoubleSide }),
  };
}

// Иконка блока для UI (dataURL из тайла атласа)
export function getIcon(id) {
  if (iconCache.has(id)) return iconCache.get(id);
  const cv = document.createElement('canvas');
  cv.width = T; cv.height = T;
  const g = cv.getContext('2d');
  if (id === B.WATER) g.drawImage(drawWaterTexture(), 0, 0, T, T);
  else if (id === B.LAVA) g.drawImage(drawLavaTexture(), 0, 0, T, T);
  else {
    const def = BLOCKS[id];
    if (!def || !def.tiles) return '';
    const tile = def.tiles.side;
    g.drawImage(atlasCanvas, (tile % ATLAS_COLS) * T, Math.floor(tile / ATLAS_COLS) * T, T, T, 0, 0, T, T);
    if (id === B.GLASS) { // подложка, чтобы стекло было видно на иконке
      g.globalCompositeOperation = 'destination-over';
      g.fillStyle = 'rgba(170,210,230,0.25)';
      g.fillRect(0, 0, T, T);
    }
  }
  const url = cv.toDataURL();
  iconCache.set(id, url);
  return url;
}
