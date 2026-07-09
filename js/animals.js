// Животные: курица, свинья, баран, корова. Блуждают, реагируют на удары,
// дают дроп как в оригинале (мясо, перо, шерсть, кожа).
import * as THREE from 'three';
import { B } from './blocks.js';
import { BIOME } from './world/worldgen.js';
import { lerp } from './config.js';

// n: [min, max] случайное количество
const TYPES = {
  chicken: {
    hp: 4, speed: 1.3, w: 0.35, h: 0.55,
    drops: [{ id: B.MEAT, n: [1, 1] }, { id: B.FEATHER, n: [1, 2] }],
  },
  pig: {
    hp: 10, speed: 1.1, w: 0.7, h: 0.85,
    drops: [{ id: B.MEAT, n: [1, 3] }],
  },
  sheep: {
    hp: 8, speed: 1.0, w: 0.7, h: 1.1,
    drops: [{ id: B.MEAT, n: [1, 2] }, { id: B.WOOL, n: [1, 2] }],
  },
  cow: {
    hp: 10, speed: 0.9, w: 0.8, h: 1.3,
    drops: [{ id: B.MEAT, n: [1, 3] }, { id: B.LEATHER, n: [0, 2] }],
  },
};

// какие животные водятся в каком биоме
const BIOME_SPAWNS = {
  [BIOME.PLAINS]: ['cow', 'sheep', 'pig', 'chicken'],
  [BIOME.FOREST]: ['pig', 'chicken', 'cow'],
  [BIOME.JUNGLE]: ['chicken', 'pig'],
  [BIOME.MOUNTAINS]: ['sheep'],
};

const mat = (c) => new THREE.MeshLambertMaterial({ color: c });
const box = (w, h, d, c) => new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat(c));

// сквозной сетевой id существ (общий для животных и мобов)
export let NEXT_EID = 1;
export function nextEid() { return NEXT_EID++; }

// пятнистая текстура для коровы
function spottedMat(base, spot) {
  const cv = document.createElement('canvas');
  cv.width = cv.height = 16;
  const g = cv.getContext('2d');
  g.fillStyle = base; g.fillRect(0, 0, 16, 16);
  g.fillStyle = spot;
  g.fillRect(1, 2, 5, 4); g.fillRect(9, 8, 6, 5); g.fillRect(3, 11, 4, 3); g.fillRect(11, 1, 4, 3);
  const t = new THREE.CanvasTexture(cv);
  t.magFilter = THREE.NearestFilter;
  return new THREE.MeshLambertMaterial({ map: t });
}

// Модель: группа с ногами-пивотами. Вперёд — +z.
function buildModel(type) {
  const g = new THREE.Group();
  const legs = [];
  const mkLeg = (w, h, d, c, x, y, z) => {
    const pivot = new THREE.Group();
    pivot.position.set(x, y, z);
    const m = box(w, h, d, c);
    m.position.y = -h / 2;
    pivot.add(m);
    g.add(pivot);
    legs.push(pivot);
    return pivot;
  };
  let head = null;

  if (type === 'chicken') {
    const body = box(0.34, 0.32, 0.46, 0xf2f0e8);
    body.position.y = 0.38;
    g.add(body);
    head = new THREE.Group();
    head.position.set(0, 0.62, 0.18);
    const h1 = box(0.2, 0.26, 0.2, 0xf2f0e8);
    h1.position.y = 0.06;
    head.add(h1);
    const beak = box(0.1, 0.06, 0.1, 0xe8a020);
    beak.position.set(0, 0.05, 0.14);
    head.add(beak);
    const comb = box(0.06, 0.08, 0.1, 0xc03028);
    comb.position.set(0, 0.22, 0.02);
    head.add(comb);
    g.add(head);
    // крылья
    const wingL = box(0.06, 0.18, 0.3, 0xe4e0d4);
    wingL.position.set(-0.2, 0.4, 0);
    const wingR = wingL.clone();
    wingR.position.x = 0.2;
    g.add(wingL, wingR);
    mkLeg(0.06, 0.22, 0.06, 0xe8a020, -0.08, 0.22, 0);
    mkLeg(0.06, 0.22, 0.06, 0xe8a020, 0.08, 0.22, 0);
  } else {
    const conf = {
      pig:   { body: mat(0xe89ba0), head: mat(0xe89ba0), leg: 0xd8878c, bw: 0.55, bh: 0.5, bl: 0.95, legH: 0.35 },
      sheep: { body: mat(0xeceae2), head: mat(0x5a5049), leg: 0x4a423c, bw: 0.6, bh: 0.58, bl: 0.95, legH: 0.45 },
      cow:   { body: spottedMat('#8a5a3a', '#f0ece2'), head: mat(0x8a5a3a), leg: 0x6a4228, bw: 0.6, bh: 0.6, bl: 1.05, legH: 0.5 },
    }[type];

    const body = new THREE.Mesh(new THREE.BoxGeometry(conf.bw, conf.bh, conf.bl), conf.body);
    body.position.y = conf.legH + conf.bh / 2;
    g.add(body);

    head = new THREE.Group();
    head.position.set(0, conf.legH + conf.bh * 0.8, conf.bl / 2 + 0.05);
    const hd = new THREE.Mesh(new THREE.BoxGeometry(0.36, 0.36, 0.32), conf.head);
    hd.position.set(0, 0.05, 0.1);
    head.add(hd);
    if (type === 'pig') {
      const snout = box(0.16, 0.12, 0.06, 0xd8787e);
      snout.position.set(0, 0, 0.3);
      head.add(snout);
    }
    if (type === 'cow') {
      const hornL = box(0.06, 0.12, 0.06, 0xe8e0d0);
      hornL.position.set(-0.16, 0.26, 0.05);
      const hornR = hornL.clone();
      hornR.position.x = 0.16;
      head.add(hornL, hornR);
      const muzzle = box(0.3, 0.14, 0.06, 0xd8c8b8);
      muzzle.position.set(0, -0.06, 0.28);
      head.add(muzzle);
    }
    if (type === 'sheep') {
      const fluff = box(0.3, 0.3, 0.26, 0xeceae2);
      fluff.position.set(0, 0.14, 0.02);
      head.add(fluff);
    }
    g.add(head);

    const lx = conf.bw / 2 - 0.09, lz = conf.bl / 2 - 0.12;
    mkLeg(0.16, conf.legH, 0.16, conf.leg, -lx, conf.legH, lz);
    mkLeg(0.16, conf.legH, 0.16, conf.leg, lx, conf.legH, lz);
    mkLeg(0.16, conf.legH, 0.16, conf.leg, -lx, conf.legH, -lz);
    mkLeg(0.16, conf.legH, 0.16, conf.leg, lx, conf.legH, -lz);
  }
  return { group: g, legs, head };
}

export class Animals {
  constructor(scene, world, audio) {
    this.scene = scene;
    this.world = world;
    this.audio = audio;
    this.list = [];
    this.spawnTimer = 1.5;
    this.maxCount = 12;
    this.types = TYPES; // переопределяется в наследниках (мобы)
  }

  buildModel(type) {
    return buildModel(type);
  }

  trySpawn(playerPos) {
    const ang = Math.random() * Math.PI * 2;
    const dist = 22 + Math.random() * 18;
    const x = Math.floor(playerPos.x + Math.cos(ang) * dist);
    const z = Math.floor(playerPos.z + Math.sin(ang) * dist);
    const cx = Math.floor(x / 16), cz = Math.floor(z / 16);
    if (!this.world.chunks.has(cx + ',' + cz)) return;
    const biome = this.world.gen.biomeAt(x, z);
    const pool = BIOME_SPAWNS[biome];
    if (!pool) return;
    const h = this.world.surfaceHeight(x, z);
    if (h <= 26) return;
    const surf = this.world.getBlock(x, h, z);
    if (surf !== B.GRASS && surf !== B.SNOW) return;
    if (this.world.getBlock(x, h + 1, z) !== B.AIR || this.world.getBlock(x, h + 2, z) !== B.AIR) return;

    const type = pool[(Math.random() * pool.length) | 0];
    this.spawn(type, x + 0.5, h + 1.01, z + 0.5);
  }

  spawn(type, x, y, z) {
    const def = this.types[type];
    const model = this.buildModel(type);
    model.group.position.set(x, y, z);
    this.scene.add(model.group);
    const a = {
      type, def,
      eid: nextEid(),
      group: model.group, legs: model.legs, head: model.head,
      arms: model.arms || [],
      pos: new THREE.Vector3(x, y, z),
      vel: new THREE.Vector3(),
      yaw: Math.random() * Math.PI * 2,
      targetYaw: 0,
      state: 'idle', timer: 1 + Math.random() * 3,
      hp: def.hp,
      walkPhase: 0,
      flashT: 0,
      soundT: 4 + Math.random() * 12,
      onGround: false,
    };
    a.targetYaw = a.yaw;
    this.list.push(a);
    return a;
  }

  removeAnimal(a) {
    this.scene.remove(a.group);
    const i = this.list.indexOf(a);
    if (i >= 0) this.list.splice(i, 1);
  }

  // Пересечение луча с AABB животного (slab-тест). Возвращает дистанцию или null.
  rayAABB(o, d, a) {
    const half = a.def.w / 2 + 0.1;
    const min = [a.pos.x - half, a.pos.y, a.pos.z - half];
    const max = [a.pos.x + half, a.pos.y + a.def.h, a.pos.z + half];
    let tmin = 0, tmax = Infinity;
    const oArr = [o.x, o.y, o.z], dArr = [d.x, d.y, d.z];
    for (let i = 0; i < 3; i++) {
      if (Math.abs(dArr[i]) < 1e-8) {
        if (oArr[i] < min[i] || oArr[i] > max[i]) return null;
      } else {
        let t1 = (min[i] - oArr[i]) / dArr[i];
        let t2 = (max[i] - oArr[i]) / dArr[i];
        if (t1 > t2) { const t = t1; t1 = t2; t2 = t; }
        tmin = Math.max(tmin, t1);
        tmax = Math.min(tmax, t2);
        if (tmin > tmax) return null;
      }
    }
    return tmin;
  }

  tryHit(origin, dir, maxDist) {
    let best = null;
    for (const a of this.list) {
      const t = this.rayAABB(origin, dir, a);
      if (t !== null && t <= maxDist && (!best || t < best.dist)) {
        best = { animal: a, dist: t };
      }
    }
    return best;
  }

  // onDrop(id, count, pos)
  hit(a, dmg, dir, onDrop) {
    a.hp -= dmg;
    a.flashT = 0.18;
    a.vel.x += dir.x * 6;
    a.vel.z += dir.z * 6;
    a.vel.y = 4.5;
    a.state = 'flee';
    a.timer = 2.5;
    a.targetYaw = Math.atan2(dir.x, dir.z); // убегает по направлению удара
    if (this.audio.animal) this.audio.animal(a.type);
    if (a.hp <= 0) {
      for (const drop of a.def.drops) {
        const n = drop.n[0] + ((Math.random() * (drop.n[1] - drop.n[0] + 1)) | 0);
        if (n > 0 && onDrop) onDrop(drop.id, n, a.pos.clone().add(new THREE.Vector3(0, a.def.h * 0.5, 0)));
      }
      this.removeAnimal(a);
    }
  }

  collideAxis(a, axis, delta) {
    if (delta === 0) return false;
    a.pos.setComponent(axis, a.pos.getComponent(axis) + delta);
    const half = a.def.w / 2;
    const minX = Math.floor(a.pos.x - half), maxX = Math.floor(a.pos.x + half);
    const minY = Math.floor(a.pos.y), maxY = Math.floor(a.pos.y + a.def.h - 0.001);
    const minZ = Math.floor(a.pos.z - half), maxZ = Math.floor(a.pos.z + half);
    for (let y = minY; y <= maxY; y++) for (let z = minZ; z <= maxZ; z++) for (let x = minX; x <= maxX; x++) {
      if (!this.world.isSolid(x, y, z)) continue;
      if (axis === 0) { a.pos.x = delta > 0 ? x - half - 0.001 : x + 1 + half + 0.001; a.vel.x = 0; }
      else if (axis === 1) {
        if (delta > 0) a.pos.y = y - a.def.h - 0.001;
        else { a.pos.y = y + 1 + 0.001; a.onGround = true; }
        a.vel.y = 0;
      } else { a.pos.z = delta > 0 ? z - half - 0.001 : z + 1 + half + 0.001; a.vel.z = 0; }
      return true;
    }
    return false;
  }

  updateAnimal(a, dt, playerPos) {
    // --- ИИ ---
    a.timer -= dt;
    if (a.timer <= 0) {
      if (a.state === 'walk' || a.state === 'flee') {
        a.state = 'idle';
        a.timer = 1.5 + Math.random() * 3.5;
      } else {
        a.state = 'walk';
        a.timer = 2 + Math.random() * 4;
        a.targetYaw = Math.random() * Math.PI * 2;
      }
    }
    // плавный поворот
    let dy = a.targetYaw - a.yaw;
    while (dy > Math.PI) dy -= Math.PI * 2;
    while (dy < -Math.PI) dy += Math.PI * 2;
    a.yaw += dy * Math.min(1, 5 * dt);

    const moving = a.state === 'walk' || a.state === 'flee';
    const speed = a.state === 'flee' ? a.def.speed * 2.4 : a.def.speed;
    const wishX = moving ? Math.sin(a.yaw) * speed : 0;
    const wishZ = moving ? Math.cos(a.yaw) * speed : 0;
    const k = 1 - Math.exp(-8 * dt);
    a.vel.x = lerp(a.vel.x, wishX, k);
    a.vel.z = lerp(a.vel.z, wishZ, k);

    // вода: всплываем
    const feetBlock = this.world.getBlock(Math.floor(a.pos.x), Math.floor(a.pos.y + 0.3), Math.floor(a.pos.z));
    if (feetBlock === B.WATER) {
      a.vel.y = lerp(a.vel.y, 2, 1 - Math.exp(-4 * dt));
    } else {
      a.vel.y -= 22 * dt;
    }
    a.vel.y = Math.max(a.vel.y, -30);

    // --- физика ---
    a.onGround = false;
    this.collideAxis(a, 1, a.vel.y * dt);
    const blockedX = this.collideAxis(a, 0, a.vel.x * dt);
    const blockedZ = this.collideAxis(a, 2, a.vel.z * dt);
    // автопрыжок на блок высотой 1
    if (moving && a.onGround && (blockedX || blockedZ)) a.vel.y = 7.5;

    // --- анимация ---
    a.group.position.copy(a.pos);
    a.group.rotation.y = a.yaw;
    const hSpeed = Math.hypot(a.vel.x, a.vel.z);
    a.walkPhase += hSpeed * dt * 3;
    const swing = Math.sin(a.walkPhase) * Math.min(1, hSpeed) * 0.55;
    a.legs.forEach((leg, i) => { leg.rotation.x = i % 2 ? swing : -swing; });
    if (a.head) a.head.rotation.x = Math.sin(a.walkPhase * 0.3) * 0.08;

    // красная вспышка при уроне
    if (a.flashT > 0) {
      a.flashT -= dt;
      const on = a.flashT > 0;
      a.group.traverse((m) => {
        if (m.isMesh) {
          const mats = Array.isArray(m.material) ? m.material : [m.material];
          for (const mm of mats) if (mm.emissive) mm.emissive.setHex(on ? 0x882222 : 0x000000);
        }
      });
    }

    // случайные звуки поблизости
    a.soundT -= dt;
    if (a.soundT <= 0) {
      a.soundT = 6 + Math.random() * 14;
      if (a.pos.distanceTo(playerPos) < 22 && this.audio.animal) this.audio.animal(a.type);
    }

    if (a.pos.y < -8) this.removeAnimal(a);
  }

  update(dt, playerPos, onDrop) {
    this.spawnTimer -= dt;
    if (this.spawnTimer <= 0) {
      this.spawnTimer = 2.5;
      if (this.list.length < this.maxCount) this.trySpawn(playerPos);
    }
    for (let i = this.list.length - 1; i >= 0; i--) {
      const a = this.list[i];
      // деспаун далёких
      const dx = a.pos.x - playerPos.x, dz = a.pos.z - playerPos.z;
      if (dx * dx + dz * dz > 72 * 72) { this.removeAnimal(a); continue; }
      this.updateAnimal(a, dt, playerPos);
    }
  }

  dispose() {
    for (const a of [...this.list]) this.removeAnimal(a);
  }
}
