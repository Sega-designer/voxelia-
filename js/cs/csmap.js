// Блок-Страйк: воксельная «Дюна-2» — планировка по радару оригинальной de_dust2.
// Юг — Т-спавн (плато +2), север — сайты. Три линии: туннели (запад),
// мид (центр), лонг (восток). Пит, гусь, xbox, тачка на Б — всё на месте.
import * as THREE from 'three';
import { B } from '../blocks.js';
import { buildChunkGeometries } from '../world/chunk.js';
import { CHUNK, WORLD_H } from '../config.js';

export const MAP_W = 160, MAP_H = 28, MAP_D = 160;

export class CSMap {
  constructor() {
    this.data = new Uint8Array(MAP_W * MAP_H * MAP_D);
    this.meshes = [];
    this.build();
  }

  i(x, y, z) { return x + z * MAP_W + y * MAP_W * MAP_D; }

  getBlock(x, y, z) {
    if (y < 0) return B.STONE;
    if (x < 0 || x >= MAP_W || z < 0 || z >= MAP_D || y >= MAP_H) return B.AIR;
    return this.data[this.i(x, y, z)];
  }

  isSolid(x, y, z) {
    return this.getBlock(x, y, z) !== B.AIR;
  }

  set(x, y, z, id) {
    if (x < 0 || x >= MAP_W || y < 0 || y >= MAP_H || z < 0 || z >= MAP_D) return;
    this.data[this.i(x, y, z)] = id;
  }

  fill(x0, y0, z0, x1, y1, z1, id) {
    for (let y = y0; y <= y1; y++) for (let z = z0; z <= z1; z++) for (let x = x0; x <= x1; x++) {
      this.set(x, y, z, id);
    }
  }

  carve(x0, z0, x1, z1, floorY = 0, ceilY = 8) {
    if (floorY > 0) this.fill(x0, 1, z0, x1, floorY, z1, B.SAND);
    this.fill(x0, floorY + 1, z0, x1, ceilY, z1, B.AIR);
  }

  crate(x, z, w, d, h) {
    const y0 = this.groundY(x, z);
    this.fill(x, y0, z, x + w - 1, y0 + h - 1, z + d - 1, B.PLANKS);
  }

  groundY(x, z) {
    for (let y = MAP_H - 1; y >= 0; y--) {
      if (this.isSolid(x, y, z)) return y + 1;
    }
    return 0;
  }

  build() {
    const S = B.SAND, W = B.WOOD, BR = B.BRICK, ST = B.STONE;

    // основание + сплошная застройка
    this.fill(0, 0, 0, MAP_W - 1, 0, MAP_D - 1, S);
    this.fill(0, 1, 0, MAP_W - 1, 8, MAP_D - 1, S);

    // ================= Т-СТОРОНА (юг) =================
    // Т-спавн: плато +2
    this.carve(96, 8, 136, 34, 2);
    // двор туннелей: ступени вниз на запад
    this.carve(88, 12, 95, 30, 1);
    this.carve(60, 12, 87, 30, 0);
    // Т-рампа вниз в мид
    this.carve(100, 34, 116, 44, 1);
    this.carve(96, 44, 116, 56, 0);
    // выход на лонг: двор +2 и ступени вниз
    this.carve(128, 20, 150, 44, 2);
    this.carve(128, 44, 150, 50, 1);

    // ================= ЛОНГ (восток) =================
    // длинные двери: две, с простенком
    this.fill(126, 1, 50, 152, 8, 53, S);
    this.carve(130, 50, 133, 53, 1, 4);
    this.carve(143, 50, 146, 53, 1, 4);
    this.fill(129, 1, 50, 129, 4, 53, W); this.fill(134, 1, 50, 134, 4, 53, W);
    this.fill(142, 1, 50, 142, 4, 53, W); this.fill(147, 1, 50, 147, 4, 53, W);
    this.fill(129, 4, 50, 147, 4, 53, W);
    // ПИТ (яма у выхода с дверей)
    this.carve(114, 54, 126, 68, 0);
    // лонг (пол +1)
    this.carve(126, 54, 152, 120, 1);
    // рампа на А
    this.carve(126, 120, 152, 126, 2);
    this.carve(126, 126, 152, 132, 3);

    // ================= САЙТ А (северо-восток, +3) =================
    this.carve(100, 126, 152, 156, 3);

    // ================= МИД =================
    this.carve(72, 52, 96, 108, 0);
    // двойные двери мида
    this.fill(72, 1, 108, 96, 8, 110, S);
    this.carve(76, 108, 79, 110, 0, 3);
    this.carve(86, 108, 89, 110, 0, 3);
    this.fill(75, 1, 108, 75, 4, 110, W); this.fill(80, 1, 108, 80, 4, 110, W);
    this.fill(85, 1, 108, 85, 4, 110, W); this.fill(90, 1, 108, 90, 4, 110, W);
    this.fill(75, 4, 108, 90, 4, 110, W);
    // СТ-мид
    this.carve(72, 110, 96, 124, 0);

    // ================= КАТВОК / ШОРТ (мид → А) =================
    this.carve(92, 72, 97, 80, 1);     // ступень из мида
    this.carve(98, 72, 106, 80, 2);    // площадка
    this.carve(98, 80, 108, 120, 2);   // катвок на север
    this.carve(98, 120, 108, 126, 3);  // шорт-ступени к сайту

    // ================= СТ-СТОРОНА =================
    // СТ-спавн
    this.carve(44, 124, 76, 152, 0);
    // подъём СТ → А («элеватор»)
    this.carve(76, 132, 84, 144, 1);
    this.carve(84, 132, 92, 144, 2);
    this.carve(92, 132, 100, 144, 3);
    // клозет мид → Б
    this.carve(56, 108, 72, 120, 0);
    this.carve(44, 108, 58, 116, 0);

    // ================= САЙТ Б (северо-запад) =================
    this.carve(8, 96, 44, 156, 0);
    // задняя площадка (+2) со ступенькой
    this.carve(8, 140, 16, 156, 2);
    this.carve(16, 144, 18, 152, 1);
    // двери Б: здание-проход между СТ и сайтом (не задевает спавн СТ)
    this.fill(40, 1, 130, 48, 8, 144, S);
    this.carve(40, 134, 48, 140, 0, 4);
    this.fill(40, 1, 133, 40, 4, 134, W); this.fill(40, 1, 140, 40, 4, 141, W);
    this.fill(47, 1, 133, 47, 4, 134, W); this.fill(47, 1, 140, 47, 4, 141, W);

    // ================= ТУННЕЛИ (запад, крытые, пол +1) =================
    this.carve(60, 30, 72, 38, 1, 4);   // вход со двора Т
    this.carve(58, 38, 68, 90, 1, 4);   // длинный северный
    this.carve(46, 82, 58, 90, 1, 4);   // поворот на запад
    this.carve(40, 90, 50, 98, 0, 4);   // спуск в Б
    // стык туннелей и двора Т (двор пол 0, вход пол 1 — ступенька)
    this.carve(60, 28, 72, 30, 0);

    // ================= ЯЩИКИ И ДЕТАЛИ =================
    this.crate(78, 84, 2, 2, 2);        // xbox в миде
    this.crate(146, 56, 2, 2, 2);       // угол лонга у дверей
    this.crate(132, 88, 2, 2, 3);       // лонг
    this.crate(122, 138, 2, 2, 2);      // дефолт-плент А
    this.crate(126, 142, 2, 2, 3);
    this.crate(134, 134, 2, 2, 2);
    this.crate(102, 148, 2, 2, 2);      // «гусь»
    this.crate(104, 152, 2, 2, 3);
    this.crate(12, 146, 3, 2, 2);       // «тачка» на Б
    this.crate(36, 104, 2, 2, 3);       // биг-бокс у выхода из туннелей
    this.crate(28, 122, 2, 2, 2);       // дабл-стек Б
    this.crate(30, 124, 1, 1, 1);
    this.crate(100, 26, 2, 2, 2);       // Т-спавн
    this.crate(60, 146, 2, 2, 2);       // СТ-спавн

    // плент-зоны (кирпичная разметка)
    this.fill(118, 3, 136, 132, 3, 148, BR);   // А (на +3)
    this.fill(16, 0, 116, 30, 0, 132, BR);     // Б

    // каменная отделка спавнов
    this.fill(98, 2, 10, 134, 2, 32, ST);
    this.fill(46, 0, 126, 74, 0, 150, ST);
  }

  raycast(o, d, maxDist) {
    let x = Math.floor(o.x), y = Math.floor(o.y), z = Math.floor(o.z);
    const stepX = Math.sign(d.x), stepY = Math.sign(d.y), stepZ = Math.sign(d.z);
    const tDX = stepX !== 0 ? Math.abs(1 / d.x) : Infinity;
    const tDY = stepY !== 0 ? Math.abs(1 / d.y) : Infinity;
    const tDZ = stepZ !== 0 ? Math.abs(1 / d.z) : Infinity;
    let tMaxX = stepX > 0 ? (x + 1 - o.x) * tDX : stepX < 0 ? (o.x - x) * tDX : Infinity;
    let tMaxY = stepY > 0 ? (y + 1 - o.y) * tDY : stepY < 0 ? (o.y - y) * tDY : Infinity;
    let tMaxZ = stepZ > 0 ? (z + 1 - o.z) * tDZ : stepZ < 0 ? (o.z - z) * tDZ : Infinity;
    let nx = 0, ny = 0, nz = 0, t = 0;

    for (let i = 0; i < 800; i++) {
      const id = this.getBlock(x, y, z);
      if (id !== B.AIR && t > 0) return { x, y, z, id, nx, ny, nz, dist: t };
      if (tMaxX < tMaxY && tMaxX < tMaxZ) {
        t = tMaxX; tMaxX += tDX; x += stepX; nx = -stepX; ny = 0; nz = 0;
      } else if (tMaxY < tMaxZ) {
        t = tMaxY; tMaxY += tDY; y += stepY; nx = 0; ny = -stepY; nz = 0;
      } else {
        t = tMaxZ; tMaxZ += tDZ; z += stepZ; nx = 0; ny = 0; nz = -stepZ;
      }
      if (t > maxDist) break;
    }
    return null;
  }

  hasLOS(a, b) {
    const d = new THREE.Vector3().subVectors(b, a);
    const dist = d.length();
    if (dist < 0.001) return true;
    d.normalize();
    return !this.raycast(a, d, dist);
  }

  addToScene(scene, materials) {
    const chunksX = MAP_W / CHUNK, chunksZ = MAP_D / CHUNK;
    for (let cz = 0; cz < chunksZ; cz++) for (let cx = 0; cx < chunksX; cx++) {
      const cdata = new Uint8Array(CHUNK * CHUNK * WORLD_H);
      for (let y = 0; y < MAP_H; y++) for (let z = 0; z < CHUNK; z++) for (let x = 0; x < CHUNK; x++) {
        cdata[x + z * CHUNK + y * CHUNK * CHUNK] = this.getBlock(cx * CHUNK + x, y, cz * CHUNK + z);
      }
      const geos = buildChunkGeometries(this, cx, cz, cdata);
      for (const [geo, mat] of [[geos.solid, materials.opaque], [geos.cutout, materials.cutout]]) {
        if (!geo) continue;
        const mesh = new THREE.Mesh(geo, mat);
        mesh.position.set(cx * CHUNK, 0, cz * CHUNK);
        scene.add(mesh);
        this.meshes.push(mesh);
      }
    }
  }
}

// Т смотрят на север (в сторону мида), СТ — на юг
export const SPAWNS = {
  t: {
    yaw: Math.PI,
    points: [[104, 14], [110, 18], [116, 14], [122, 18], [128, 14], [132, 20], [106, 24], [114, 28], [122, 26], [130, 28]],
  },
  ct: {
    yaw: 0,
    points: [[52, 130], [58, 134], [64, 130], [70, 134], [74, 130], [52, 142], [56, 148], [64, 142], [70, 148], [60, 138]],
  },
};

export const HOTSPOTS = [
  [82, 106],  // двери мида
  [82, 90],   // у xbox
  [138, 46],  // длинные двери
  [138, 90],  // лонг
  [138, 124], // рампа А
  [120, 132], // подход к пленту А
  [110, 150], // у «гуся»
  [103, 100], // катвок
  [103, 122], // шорт
  [80, 118],  // СТ-мид
  [60, 138],  // СТ-спавн
  [45, 112],  // клозет
  [22, 124],  // плент Б
  [18, 140],  // у «тачки»
  [36, 110],  // биг-бокс
  [62, 60],   // туннели
  [50, 86],   // поворот туннелей
  [108, 48],  // низ Т-рампы
  [116, 20],  // Т-спавн
  [88, 138],  // подъём СТ→А
  [120, 60],  // пит
];
