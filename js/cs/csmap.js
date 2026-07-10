// Блок-Страйк: воксельная de_dust2 — планировка 1-в-1 по радару оригинала.
// Ориентация как на радаре: Б — верх-слева, А — верх-справа, СТ — центр-верх,
// Т — низ по центру. Ось Z растёт на юг (вниз радара).
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
    else this.fill(x0, 1, z0, x1, 0, z1, B.SAND); // на случай перекопа
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

    this.fill(0, 0, 0, MAP_W - 1, 0, MAP_D - 1, S);
    this.fill(0, 1, 0, MAP_W - 1, 8, MAP_D - 1, S);

    // ============ Б-СТОРОНА (верх-слева радара) ============
    this.carve(16, 6, 43, 49, 0);       // сайт Б
    this.carve(6, 16, 15, 37, 2);       // задняя площадка (+2)
    this.carve(16, 16, 17, 37, 1);      //   её ступенька
    // двери Б (здание между Б и СТ)
    this.fill(44, 1, 22, 51, 8, 33, S);
    this.carve(44, 26, 51, 31, 0, 4);
    this.fill(44, 1, 25, 44, 4, 26, W); this.fill(44, 1, 31, 44, 4, 32, W);
    this.fill(51, 1, 25, 51, 4, 26, W); this.fill(51, 1, 31, 51, 4, 32, W);

    // ============ СТ-СПАВН (центр-верх) ============
    this.carve(52, 24, 87, 53, 0);

    // ============ МИД (центральная вертикаль) ============
    this.carve(68, 44, 85, 61, 0);      // СТ-мид
    // двойные двери мида
    this.fill(68, 1, 62, 85, 8, 63, S);
    this.carve(70, 62, 73, 63, 0, 3);
    this.carve(80, 62, 83, 63, 0, 3);
    this.fill(69, 1, 62, 69, 4, 63, W); this.fill(74, 1, 62, 74, 4, 63, W);
    this.fill(79, 1, 62, 79, 4, 63, W); this.fill(84, 1, 62, 84, 4, 63, W);
    this.fill(69, 4, 62, 84, 4, 63, W);
    this.carve(68, 64, 85, 113, 0);     // мид
    this.carve(68, 96, 97, 117, 0);     // аутсайд-мид (расширение к Т)

    // виндовс: коннектор СТ-мид → Б (под спавном СТ)
    this.carve(34, 48, 53, 57, 0);

    // ============ Т-СТОРОНА (низ радара) ============
    this.carve(84, 118, 101, 121, 1);   // Т-рампа: ступень 1
    this.carve(84, 122, 101, 125, 2);   //   ступень 2
    this.carve(56, 126, 113, 155, 2);   // Т-спавн (плато +2)
    this.carve(36, 108, 61, 129, 0);    // двор туннелей
    this.carve(58, 120, 61, 129, 1);    //   ступень с плато

    // ============ ТУННЕЛИ (крытые, пол +1) ============
    this.carve(40, 84, 53, 108, 1, 4);  // вход (с юга)
    this.carve(40, 68, 53, 84, 1, 4);   // прямой
    this.carve(24, 68, 41, 81, 1, 4);   // поворот на запад
    this.carve(20, 48, 33, 69, 1, 4);   // северный рукав
    this.carve(20, 40, 33, 48, 0, 4);   // спуск-выход в Б

    // ============ КАТВОК / ШОРТ (диагональ мид → А) ============
    this.carve(86, 80, 89, 89, 1);      // ступень из мида
    this.carve(90, 80, 93, 89, 2);      // ступень 2
    this.carve(90, 72, 105, 85, 2);     // площадка
    this.carve(100, 52, 113, 79, 2);    // катвок на север
    this.carve(104, 44, 113, 53, 3);    // шорт-ступени к сайту

    // ============ САЙТ А (верх-справа) ============
    this.carve(104, 12, 145, 45, 3);
    // подъём СТ → А («элеватор»)
    this.carve(88, 28, 93, 45, 1);
    this.carve(94, 28, 99, 45, 2);
    this.carve(100, 28, 105, 45, 3);

    // ============ ЛОНГ (восточная вертикаль) ============
    this.carve(124, 36, 153, 113, 1);   // лонг (пол +1)
    this.carve(124, 32, 153, 35, 2);    // рампа А: ступень 2
    this.carve(124, 24, 153, 31, 3);    //   выход на сайт (+3)
    this.carve(112, 100, 123, 113, 0);  // ПИТ (яма у дверей)
    // длинные двери (стена z114..115 остаётся, режем две)
    this.carve(128, 114, 133, 115, 1, 4);
    this.carve(140, 114, 145, 115, 1, 4);
    this.fill(127, 1, 114, 127, 4, 115, W); this.fill(134, 1, 114, 134, 4, 115, W);
    this.fill(139, 1, 114, 139, 4, 115, W); this.fill(146, 1, 114, 146, 4, 115, W);
    this.carve(112, 116, 153, 137, 1);  // аутсайд-лонг (Т → двери)

    // ============ ЯЩИКИ ============
    this.crate(74, 88, 2, 2, 2);        // xbox в миде
    this.crate(146, 60, 2, 2, 2);       // угол лонга
    this.crate(132, 74, 2, 2, 3);       // лонг
    this.crate(120, 24, 2, 2, 2);       // дефолт А
    this.crate(126, 28, 2, 2, 3);
    this.crate(134, 20, 2, 2, 2);
    this.crate(138, 14, 2, 2, 2);       // «гусь»
    this.crate(141, 17, 2, 2, 3);
    this.crate(18, 10, 3, 2, 2);        // «тачка» на Б
    this.crate(36, 42, 2, 2, 3);        // биг-бокс у туннелей
    this.crate(24, 28, 2, 2, 2);        // дабл-стек
    this.crate(26, 30, 1, 1, 1);
    this.crate(100, 140, 2, 2, 2);      // Т-спавн
    this.crate(78, 46, 2, 2, 2);        // СТ-спавн
    this.crate(148, 122, 2, 2, 2);      // аутсайд-лонг

    // ============ ПЛЕНТ-ЗОНЫ ============
    this.fill(116, 3, 20, 133, 3, 33, BR);   // А (на +3)
    this.fill(20, 0, 16, 33, 0, 29, BR);     // Б

    // отделка спавнов камнем
    this.fill(58, 2, 128, 111, 2, 153, ST);  // Т (верх плато)
    this.fill(54, 0, 26, 85, 0, 51, ST);     // СТ
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

// Т внизу радара, смотрят на север (yaw 0 → -z); СТ вверху, смотрят на юг (yaw π)
export const SPAWNS = {
  t: {
    yaw: 0,
    points: [[64, 146], [72, 138], [80, 146], [88, 138], [96, 146], [104, 144], [68, 132], [84, 132], [104, 132], [92, 150]],
  },
  ct: {
    yaw: Math.PI,
    points: [[56, 30], [62, 36], [68, 30], [74, 36], [80, 30], [58, 44], [66, 48], [74, 44], [84, 40], [70, 40]],
  },
};

export const HOTSPOTS = [
  [76, 66],    // двери мида (юг)
  [78, 92],    // у xbox
  [76, 104],   // низ мида
  [88, 112],   // аутсайд-мид
  [92, 122],   // Т-рампа
  [84, 140],   // Т-спавн
  [48, 118],   // двор туннелей
  [46, 96],    // вход в туннели
  [32, 74],    // поворот туннелей
  [26, 58],    // северный рукав
  [30, 36],    // сайт Б
  [26, 22],    // плент Б
  [10, 26],    // задняя площадка
  [47, 28],    // двери Б
  [70, 38],    // СТ-спавн
  [44, 52],    // виндовс
  [76, 52],    // СТ-мид
  [96, 36],    // подъём СТ→А
  [108, 48],   // шорт-ступени
  [106, 62],   // катвок
  [124, 38],   // сайт А
  [140, 28],   // рампа А с лонга
  [138, 80],   // лонг
  [116, 106],  // пит
  [136, 120],  // длинные двери
  [132, 130],  // аутсайд-лонг
];
