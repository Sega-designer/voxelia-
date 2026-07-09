// Мир: хранение чанков, очереди генерации/мешинга, блоки, воксельный рейкаст.
import * as THREE from 'three';
import { B, BLOCKS } from '../blocks.js';
import { CHUNK, WORLD_H, Settings } from '../config.js';
import { WorldGen } from './worldgen.js';
import { buildChunkGeometries } from './chunk.js';

const NEIGHBORS8 = [
  [-1, -1], [0, -1], [1, -1], [-1, 0], [1, 0], [-1, 1], [0, 1], [1, 1],
];

export class World {
  constructor(scene, materials, seed, modified = {}) {
    this.scene = scene;
    this.materials = materials;
    this.seed = seed;
    this.gen = new WorldGen(seed);
    this.chunks = new Map();          // "cx,cz" -> { data, meshes, dirty, meshed }
    this.modified = new Map();        // "cx,cz" -> Map(localIndex -> id)
    for (const [ck, blocks] of Object.entries(modified)) {
      const m = new Map();
      for (const [i, id] of Object.entries(blocks)) m.set(+i, id);
      this.modified.set(ck, m);
    }
    this.group = new THREE.Group();
    scene.add(this.group);
  }

  key(cx, cz) { return cx + ',' + cz; }

  ensureChunk(cx, cz) {
    const k = this.key(cx, cz);
    let ch = this.chunks.get(k);
    if (!ch) {
      const data = this.gen.generateChunk(cx, cz);
      const mods = this.modified.get(k);
      if (mods) for (const [i, id] of mods) data[i] = id;
      ch = { cx, cz, data, meshes: null, dirty: true, key: k };
      this.chunks.set(k, ch);
    }
    return ch;
  }

  getBlock(x, y, z) {
    if (y < 0 || y >= WORLD_H) return B.AIR;
    const cx = Math.floor(x / CHUNK), cz = Math.floor(z / CHUNK);
    const ch = this.chunks.get(this.key(cx, cz));
    if (!ch) return B.AIR;
    return ch.data[(x - cx * CHUNK) + (z - cz * CHUNK) * CHUNK + y * CHUNK * CHUNK];
  }

  // Для физики: несгенерированный чанк считается сплошным, чтобы игрок не провалился.
  isSolid(x, y, z) {
    if (y < 0) return true;
    if (y >= WORLD_H) return false;
    const cx = Math.floor(x / CHUNK), cz = Math.floor(z / CHUNK);
    const ch = this.chunks.get(this.key(cx, cz));
    if (!ch) return true;
    const id = ch.data[(x - cx * CHUNK) + (z - cz * CHUNK) * CHUNK + y * CHUNK * CHUNK];
    return id !== B.AIR && BLOCKS[id].solid;
  }

  setBlock(x, y, z, id, record = true) {
    if (y < 0 || y >= WORLD_H) return;
    const cx = Math.floor(x / CHUNK), cz = Math.floor(z / CHUNK);
    const key = this.key(cx, cz);
    const lx = x - cx * CHUNK, lz = z - cz * CHUNK;
    const li = lx + lz * CHUNK + y * CHUNK * CHUNK;
    // записываем правку даже для незагруженного чанка —
    // она применится при генерации (важно для сети и сохранений)
    if (record) {
      let m = this.modified.get(key);
      if (!m) { m = new Map(); this.modified.set(key, m); }
      m.set(li, id);
    }
    const ch = this.chunks.get(key);
    if (!ch) return;
    ch.data[li] = id;
    ch.dirty = true;
    // соседние чанки тоже нужно перестроить (грани и AO на границе)
    for (const [dx, dz] of NEIGHBORS8) {
      if ((dx === -1 && lx > 1) || (dx === 1 && lx < CHUNK - 2)) continue;
      if ((dz === -1 && lz > 1) || (dz === 1 && lz < CHUNK - 2)) continue;
      const nch = this.chunks.get(this.key(cx + dx, cz + dz));
      if (nch) nch.dirty = true;
    }
  }

  neighborsReady(cx, cz) {
    for (const [dx, dz] of NEIGHBORS8) {
      if (!this.chunks.has(this.key(cx + dx, cz + dz))) return false;
    }
    return true;
  }

  meshChunk(ch) {
    this.disposeChunkMeshes(ch);
    const geos = buildChunkGeometries(this, ch.cx, ch.cz, ch.data);
    const mats = this.materials;
    const meshes = [];
    const mk = (geo, mat, shadowable) => {
      if (!geo) return;
      const mesh = new THREE.Mesh(geo, mat);
      mesh.position.set(ch.cx * CHUNK, 0, ch.cz * CHUNK);
      if (shadowable && Settings.shadows) { mesh.castShadow = true; mesh.receiveShadow = true; }
      this.group.add(mesh);
      meshes.push(mesh);
    };
    mk(geos.solid, mats.opaque, true);
    mk(geos.cutout, mats.cutout, true);
    mk(geos.lava, mats.lava, false);
    mk(geos.water, mats.water, false);
    ch.meshes = meshes;
    ch.dirty = false;
  }

  disposeChunkMeshes(ch) {
    if (!ch.meshes) return;
    for (const m of ch.meshes) {
      this.group.remove(m);
      m.geometry.dispose();
    }
    ch.meshes = null;
  }

  setShadows(on) {
    for (const ch of this.chunks.values()) {
      if (!ch.meshes) continue;
      for (const m of ch.meshes) {
        if (m.material === this.materials.opaque || m.material === this.materials.cutout) {
          m.castShadow = on; m.receiveShadow = on;
        }
      }
    }
  }

  // Основной апдейт: подгрузка чанков вокруг точки, мешинг, выгрузка дальних.
  update(px, pz, budgetMs = 7) {
    const R = Settings.renderDistance;
    const pcx = Math.floor(px / CHUNK), pcz = Math.floor(pz / CHUNK);
    const t0 = performance.now();

    // список нужных чанков по спирали (сортировка по расстоянию)
    const wanted = [];
    for (let dz = -R - 1; dz <= R + 1; dz++) for (let dx = -R - 1; dx <= R + 1; dx++) {
      wanted.push([pcx + dx, pcz + dz, dx * dx + dz * dz]);
    }
    wanted.sort((a, b) => a[2] - b[2]);

    // генерация данных (радиус R+1 — запас для мешинга и AO)
    for (const [cx, cz] of wanted) {
      if (this.chunks.has(this.key(cx, cz))) continue;
      this.ensureChunk(cx, cz);
      if (performance.now() - t0 > budgetMs) break;
    }

    // мешинг: грязные чанки в радиусе R, у которых готовы все соседи
    for (const [cx, cz, d2] of wanted) {
      if (d2 > R * R + 2) continue;
      const ch = this.chunks.get(this.key(cx, cz));
      if (!ch || !ch.dirty || !this.neighborsReady(cx, cz)) continue;
      this.meshChunk(ch);
      if (performance.now() - t0 > budgetMs * 1.6) break;
    }

    // выгрузка дальних чанков
    const unloadR = R + 3;
    for (const ch of this.chunks.values()) {
      if (Math.abs(ch.cx - pcx) > unloadR || Math.abs(ch.cz - pcz) > unloadR) {
        this.disposeChunkMeshes(ch);
        this.chunks.delete(ch.key);
      }
    }
  }

  // Готовность области вокруг точки (для экрана загрузки), 0..1
  readiness(px, pz, r = 2) {
    const pcx = Math.floor(px / CHUNK), pcz = Math.floor(pz / CHUNK);
    let total = 0, done = 0;
    for (let dz = -r; dz <= r; dz++) for (let dx = -r; dx <= r; dx++) {
      total++;
      const ch = this.chunks.get(this.key(pcx + dx, pcz + dz));
      if (ch && ch.meshes) done++;
    }
    return done / total;
  }

  surfaceHeight(x, z) {
    const cx = Math.floor(x / CHUNK), cz = Math.floor(z / CHUNK);
    const ch = this.chunks.get(this.key(cx, cz));
    if (ch) {
      for (let y = WORLD_H - 1; y > 0; y--) {
        const id = ch.data[(x - cx * CHUNK) + (z - cz * CHUNK) * CHUNK + y * CHUNK * CHUNK];
        if (id !== B.AIR && id !== B.LEAVES) return y;
      }
    }
    return this.gen.heightAt(x, z);
  }

  // Воксельный рейкаст (алгоритм Аманатидеса—Ву). Возвращает блок и нормаль грани.
  raycast(origin, dir, maxDist, ignoreFluids = true) {
    let x = Math.floor(origin.x), y = Math.floor(origin.y), z = Math.floor(origin.z);
    const stepX = Math.sign(dir.x), stepY = Math.sign(dir.y), stepZ = Math.sign(dir.z);
    const tDX = stepX !== 0 ? Math.abs(1 / dir.x) : Infinity;
    const tDY = stepY !== 0 ? Math.abs(1 / dir.y) : Infinity;
    const tDZ = stepZ !== 0 ? Math.abs(1 / dir.z) : Infinity;
    let tMaxX = stepX > 0 ? (x + 1 - origin.x) * tDX : stepX < 0 ? (origin.x - x) * tDX : Infinity;
    let tMaxY = stepY > 0 ? (y + 1 - origin.y) * tDY : stepY < 0 ? (origin.y - y) * tDY : Infinity;
    let tMaxZ = stepZ > 0 ? (z + 1 - origin.z) * tDZ : stepZ < 0 ? (origin.z - z) * tDZ : Infinity;
    let nx = 0, ny = 0, nz = 0, t = 0;

    for (let i = 0; i < 256; i++) {
      const id = this.getBlock(x, y, z);
      if (id !== B.AIR && !(ignoreFluids && BLOCKS[id].fluid) && t > 0) {
        return { x, y, z, id, nx, ny, nz, dist: t };
      }
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

  getModifiedForSave() {
    const out = {};
    for (const [ck, m] of this.modified) {
      const o = {};
      for (const [i, id] of m) o[i] = id;
      out[ck] = o;
    }
    return out;
  }

  dispose() {
    for (const ch of this.chunks.values()) this.disposeChunkMeshes(ch);
    this.chunks.clear();
    this.scene.remove(this.group);
  }
}
