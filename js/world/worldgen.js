// Процедурная генерация: рельеф, биомы, пещеры, руды, деревья.
import { Noise, ihash } from '../noise.js';
import { B } from '../blocks.js';
import { CHUNK, WORLD_H, SEA, smoothstep } from '../config.js';

export const BIOME = { OCEAN: 0, BEACH: 1, PLAINS: 2, FOREST: 3, JUNGLE: 4, DESERT: 5, MOUNTAINS: 6 };
export const BIOME_NAMES = ['Океан', 'Пляж', 'Равнины', 'Лес', 'Джунгли', 'Пустыня', 'Горы'];

export class WorldGen {
  constructor(seed) {
    this.seed = seed;
    this.nA = new Noise(seed);
    this.nB = new Noise(seed ^ 0x9e3779b9);
    this.nCave = new Noise(seed ^ 0x51ab33);
    this.nCave2 = new Noise(seed ^ 0x77aa11);
  }

  mountainMask(x, z) {
    return smoothstep(0.55, 0.78, this.nB.fbm2(x * 0.0025 + 100, z * 0.0025 - 50, 3));
  }

  heightAt(x, z) {
    const e = this.nA.fbm2(x * 0.008, z * 0.008, 4);
    const mm = this.mountainMask(x, z);
    const detail = this.nA.fbm2(x * 0.05 + 300, z * 0.05, 2);
    let h = 12 + e * 30 + mm * (18 + this.nB.fbm2(x * 0.02, z * 0.02, 3) * 26) + detail * 3;
    return Math.min(WORLD_H - 6, Math.max(3, h | 0));
  }

  climate(x, z) {
    return {
      temp: this.nB.fbm2(x * 0.0015 + 400, z * 0.0015 - 200, 2),
      hum: this.nA.fbm2(x * 0.0016 - 300, z * 0.0016 + 700, 2),
    };
  }

  biomeAt(x, z, h = this.heightAt(x, z)) {
    if (h < SEA - 1) return BIOME.OCEAN;
    if (h <= SEA + 1) return BIOME.BEACH;
    if (this.mountainMask(x, z) > 0.5 && h > 46) return BIOME.MOUNTAINS;
    const { temp, hum } = this.climate(x, z);
    if (temp > 0.58 && hum < 0.45) return BIOME.DESERT;
    if (temp > 0.54 && hum > 0.55) return BIOME.JUNGLE;
    if (hum > 0.45) return BIOME.FOREST;
    return BIOME.PLAINS;
  }

  generateChunk(cx, cz) {
    const data = new Uint8Array(CHUNK * CHUNK * WORLD_H);
    const idx = (x, y, z) => x + z * CHUNK + y * CHUNK * CHUNK;
    const heights = new Int16Array(CHUNK * CHUNK);
    const biomes = new Uint8Array(CHUNK * CHUNK);

    // --- рельеф, вода, руды ---
    for (let z = 0; z < CHUNK; z++) for (let x = 0; x < CHUNK; x++) {
      const wx = cx * CHUNK + x, wz = cz * CHUNK + z;
      const h = this.heightAt(wx, wz);
      const biome = this.biomeAt(wx, wz, h);
      heights[x + z * CHUNK] = h;
      biomes[x + z * CHUNK] = biome;
      const sandy = biome === BIOME.DESERT || biome === BIOME.BEACH || biome === BIOME.OCEAN;
      const snowy = biome === BIOME.MOUNTAINS && h > 52;

      for (let y = 0; y <= h; y++) {
        let id = B.STONE;
        if (y === h) {
          id = sandy ? B.SAND : snowy ? B.SNOW : biome === BIOME.MOUNTAINS ? B.STONE : B.GRASS;
        } else if (y > h - 4) {
          id = sandy ? B.SAND : biome === BIOME.MOUNTAINS ? B.STONE : B.DIRT;
        } else {
          // руды в толще камня
          const r = ihash(wx * 7 + y * 131, wz * 13 + y * 57, this.seed);
          if (y < 40 && r < 0.012) id = B.COAL;
          else if (y < 26 && r > 0.994) id = B.IRON;
        }
        data[idx(x, y, z)] = id;
      }
      // море
      for (let y = h + 1; y <= SEA; y++) data[idx(x, y, z)] = B.WATER;
    }

    // --- пещеры (комнаты + "спагетти"-туннели), лава и подземные озёра ---
    for (let z = 0; z < CHUNK; z++) for (let x = 0; x < CHUNK; x++) {
      const h = heights[x + z * CHUNK];
      const wx = cx * CHUNK + x, wz = cz * CHUNK + z;
      const underOcean = h < SEA + 2;
      const yMax = underOcean ? Math.max(2, h - 6) : h;
      for (let y = 2; y <= yMax; y++) {
        const c1 = this.nCave.n3(wx * 0.06, y * 0.1, wz * 0.06);
        const c2 = this.nCave2.n3(wx * 0.06 + 40, y * 0.1, wz * 0.06 - 40);
        const room = c1 > 0.73;
        const tunnel = Math.abs(c1 - 0.5) < 0.05 && Math.abs(c2 - 0.5) < 0.05;
        if (room || tunnel) {
          let id = B.AIR;
          if (y <= 8) id = B.LAVA;                       // лавовые озёра на глубине
          else if (y <= 13 && c1 > 0.78) id = B.WATER;   // подземные озёра
          data[idx(x, y, z)] = id;
        }
      }
    }

    // --- растительность (деревья могут пересекать границы чанков) ---
    for (let tz = -3; tz < CHUNK + 3; tz++) for (let tx = -3; tx < CHUNK + 3; tx++) {
      const wx = cx * CHUNK + tx, wz = cz * CHUNK + tz;
      const h = this.heightAt(wx, wz);
      if (h <= SEA) continue;
      const biome = this.biomeAt(wx, wz, h);
      const r = ihash(wx, wz, this.seed ^ 0xabcdef);

      const treeChance =
        biome === BIOME.FOREST ? 0.022 :
        biome === BIOME.JUNGLE ? 0.038 :
        biome === BIOME.PLAINS ? 0.004 : 0;

      const put = (lx, y, lz, id, onlyAir) => {
        lx -= cx * CHUNK; lz -= cz * CHUNK;
        if (lx < 0 || lx >= CHUNK || lz < 0 || lz >= CHUNK || y < 0 || y >= WORLD_H) return;
        const i = idx(lx, y, lz);
        if (onlyAir && data[i] !== B.AIR) return;
        data[i] = id;
      };

      if (r < treeChance) {
        const jungle = biome === BIOME.JUNGLE;
        const th = (jungle ? 6 : 4) + ((r * 9973) | 0) % 3;
        // крона
        for (let ly = h + th - 2; ly <= h + th + 1; ly++) {
          const rad = ly > h + th ? 1 : 2;
          for (let ox = -rad; ox <= rad; ox++) for (let oz = -rad; oz <= rad; oz++) {
            if (Math.abs(ox) === 2 && Math.abs(oz) === 2 && ihash(wx + ox, wz + oz + ly, this.seed) < 0.5) continue;
            put(wx + ox, ly, wz + oz, B.LEAVES, true);
          }
        }
        // ствол
        for (let ly = h + 1; ly <= h + th; ly++) put(wx, ly, wz, B.WOOD, false);
      } else if (r > 0.985 && (biome === BIOME.JUNGLE || biome === BIOME.FOREST)) {
        // куст
        put(wx, h + 1, wz, B.LEAVES, true);
        put(wx + 1, h + 1, wz, B.LEAVES, true);
        put(wx, h + 1, wz + 1, B.LEAVES, true);
        put(wx, h + 2, wz, B.LEAVES, true);
      } else if (r > 0.996 && (biome === BIOME.PLAINS || biome === BIOME.MOUNTAINS)) {
        // валун
        put(wx, h + 1, wz, B.STONE, true);
        put(wx + 1, h + 1, wz, B.STONE, true);
        put(wx, h + 1, wz + 1, B.STONE, true);
        put(wx, h + 2, wz, B.STONE, true);
      }
    }

    return data;
  }
}
