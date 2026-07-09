// Построение геометрии чанка: видимые грани, AO, подсветка от лавы.
// Четыре "ведра": непрозрачные, вырезные (листва/стекло), вода, лава.
import * as THREE from 'three';
import { B, BLOCKS, ATLAS_COLS } from '../blocks.js';
import { CHUNK, WORLD_H } from '../config.js';

// Таблица граней (порядок вершин даёт корректную лицевую сторону).
const FACES = [
  { dir: [-1, 0, 0], shade: 0.62, corners: [[0,1,0,0,1],[0,0,0,0,0],[0,1,1,1,1],[0,0,1,1,0]] },
  { dir: [ 1, 0, 0], shade: 0.62, corners: [[1,1,1,0,1],[1,0,1,0,0],[1,1,0,1,1],[1,0,0,1,0]] },
  { dir: [ 0,-1, 0], shade: 0.50, corners: [[1,0,1,1,0],[0,0,1,0,0],[1,0,0,1,1],[0,0,0,0,1]] },
  { dir: [ 0, 1, 0], shade: 1.00, corners: [[0,1,1,1,1],[1,1,1,0,1],[0,1,0,1,0],[1,1,0,0,0]] },
  { dir: [ 0, 0,-1], shade: 0.82, corners: [[1,0,0,0,0],[0,0,0,1,0],[1,1,0,0,1],[0,1,0,1,1]] },
  { dir: [ 0, 0, 1], shade: 0.82, corners: [[0,0,1,0,0],[1,0,1,1,0],[0,1,1,0,1],[1,1,1,1,1]] },
];

const AO_TABLE = [1.0, 0.8, 0.64, 0.48];
const TILE_UV = 1 / ATLAS_COLS;
const PAD = 0.35 / (16 * ATLAS_COLS); // защита от протекания соседних тайлов

function makeBucket() {
  return { pos: [], uv: [], col: [], idx: [], count: 0 };
}

function bucketToGeometry(b) {
  if (b.count === 0) return null;
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(b.pos, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(b.uv, 2));
  geo.setAttribute('color', new THREE.Float32BufferAttribute(b.col, 3));
  geo.setIndex(b.idx);
  geo.computeVertexNormals();
  return geo;
}

export function buildChunkGeometries(world, cx, cz, data) {
  const solid = makeBucket(), cutout = makeBucket(), water = makeBucket(), lava = makeBucket();
  const bx = cx * CHUNK, bz = cz * CHUNK;

  // есть ли лава в чанке — чтобы не проверять свечение зря
  let chunkHasLava = false;
  for (let i = 0; i < data.length; i++) {
    if (data[i] === B.LAVA) { chunkHasLava = true; break; }
  }

  const get = (wx, wy, wz) => {
    if (wy < 0) return B.STONE;
    if (wy >= WORLD_H) return B.AIR;
    if (wx >= bx && wx < bx + CHUNK && wz >= bz && wz < bz + CHUNK) {
      return data[(wx - bx) + (wz - bz) * CHUNK + wy * CHUNK * CHUNK];
    }
    return world.getBlock(wx, wy, wz);
  };
  const occludes = (wx, wy, wz) => {
    const id = get(wx, wy, wz);
    return id !== B.AIR && BLOCKS[id].opaque ? 1 : 0;
  };
  const nearLava = (wx, wy, wz) => {
    if (get(wx, wy, wz) === B.LAVA) return true;
    return get(wx + 1, wy, wz) === B.LAVA || get(wx - 1, wy, wz) === B.LAVA ||
           get(wx, wy + 1, wz) === B.LAVA || get(wx, wy - 1, wz) === B.LAVA ||
           get(wx, wy, wz + 1) === B.LAVA || get(wx, wy, wz - 1) === B.LAVA;
  };

  for (let y = 0; y < WORLD_H; y++) {
    for (let z = 0; z < CHUNK; z++) {
      for (let x = 0; x < CHUNK; x++) {
        const id = data[x + z * CHUNK + y * CHUNK * CHUNK];
        if (id === B.AIR) continue;
        const def = BLOCKS[id];
        const wx = bx + x, wz = bz + z;

        for (let f = 0; f < 6; f++) {
          const face = FACES[f];
          const nx = wx + face.dir[0], ny = y + face.dir[1], nz = wz + face.dir[2];
          const nb = get(nx, ny, nz);
          const nbDef = BLOCKS[nb];

          let visible;
          if (def.fluid) visible = nb === B.AIR || (nb !== id && !nbDef.opaque && !nbDef.fluid);
          else if (def.cutout) visible = nb === B.AIR || (nb !== id && !nbDef.opaque);
          else visible = nb === B.AIR || !nbDef.opaque;
          if (!visible) continue;

          const bucket = def.fluid ? (id === B.WATER ? water : lava) : def.cutout ? cutout : solid;
          const useAtlas = !def.fluid;

          let u0 = 0, v0 = 0;
          if (useAtlas) {
            const tile = face.dir[1] > 0 ? def.tiles.top : face.dir[1] < 0 ? def.tiles.bottom : def.tiles.side;
            u0 = (tile % ATLAS_COLS) * TILE_UV;
            v0 = 1 - (Math.floor(tile / ATLAS_COLS) + 1) * TILE_UV;
          }

          // затопленная поверхность жидкости чуть ниже верха блока
          const fluidTop = def.fluid && get(wx, y + 1, wz) !== id ? 0.875 : 1;

          // подсветка от лавы для блоков в пещерах
          let glow = 0;
          if (!def.fluid && chunkHasLava && y < 42 && nearLava(nx, ny, nz)) glow = 0.55;
          if (id === B.LAVA) glow = 1;

          // оси грани для расчёта AO: единичные векторы двух осей в плоскости грани
          const axis = face.dir[0] !== 0 ? 0 : face.dir[1] !== 0 ? 1 : 2;
          const ua = axis === 0 ? 1 : 0, va = axis === 2 ? 1 : 2;
          const eux = ua === 0 ? 1 : 0, euy = ua === 1 ? 1 : 0, euz = ua === 2 ? 1 : 0;
          const evx = va === 0 ? 1 : 0, evy = va === 1 ? 1 : 0, evz = va === 2 ? 1 : 0;
          const fx = wx + face.dir[0], fy = y + face.dir[1], fz = wz + face.dir[2];

          const base = bucket.count;
          const ao = [1, 1, 1, 1];

          for (let k = 0; k < 4; k++) {
            const c = face.corners[k];
            let py = c[1];
            if (py === 1 && fluidTop !== 1) py = fluidTop;
            bucket.pos.push(x + c[0], y + py, z + c[2]);

            if (useAtlas) {
              bucket.uv.push(
                u0 + PAD + c[3] * (TILE_UV - PAD * 2),
                v0 + PAD + c[4] * (TILE_UV - PAD * 2)
              );
            } else {
              bucket.uv.push(c[3], c[4]);
            }

            // ambient occlusion по трём соседям угла (без аллокаций)
            let aoV = 1;
            if (!def.fluid) {
              const su = (ua === 0 ? c[0] : ua === 1 ? c[1] : c[2]) === 1 ? 1 : -1;
              const sv = (va === 0 ? c[0] : va === 1 ? c[1] : c[2]) === 1 ? 1 : -1;
              const s1 = occludes(fx + eux * su, fy + euy * su, fz + euz * su);
              const s2 = occludes(fx + evx * sv, fy + evy * sv, fz + evz * sv);
              const cn = occludes(fx + eux * su + evx * sv, fy + euy * su + evy * sv, fz + euz * su + evz * sv);
              const occ = (s1 && s2) ? 3 : s1 + s2 + cn;
              aoV = AO_TABLE[occ];
            }
            ao[k] = aoV;

            const l = face.shade * aoV;
            const r = Math.min(1, l + glow * 0.9);
            const g = Math.min(1, l + glow * 0.42);
            const bcol = Math.max(0, l * (1 - glow * 0.35));
            bucket.col.push(r, g, bcol);
          }

          // выбор диагонали квада по AO (устраняет артефакты затенения)
          if (ao[0] + ao[3] > ao[1] + ao[2]) {
            bucket.idx.push(base, base + 1, base + 3, base, base + 3, base + 2);
          } else {
            bucket.idx.push(base, base + 1, base + 2, base + 2, base + 1, base + 3);
          }
          bucket.count += 4;
        }
      }
    }
  }

  return {
    solid: bucketToGeometry(solid),
    cutout: bucketToGeometry(cutout),
    water: bucketToGeometry(water),
    lava: bucketToGeometry(lava),
  };
}
