// Выпавшие блоки (дропы): физика, вращение, магнит к игроку, подбор.
import * as THREE from 'three';
import { BLOCKS, ATLAS_COLS } from './blocks.js';

const GEO_CACHE = new Map();

export function dropGeometry(id) {
  if (GEO_CACHE.has(id)) return GEO_CACHE.get(id);
  const def = BLOCKS[id];
  const geo = new THREE.BoxGeometry(0.28, 0.28, 0.28);
  // натягиваем тайл блока из атласа на все грани
  const tile = def.tiles ? def.tiles.side : 3;
  const T = 1 / ATLAS_COLS;
  const u0 = (tile % ATLAS_COLS) * T;
  const v0 = 1 - (Math.floor(tile / ATLAS_COLS) + 1) * T;
  const uv = geo.attributes.uv;
  for (let i = 0; i < uv.count; i++) {
    uv.setXY(i, u0 + uv.getX(i) * T, v0 + uv.getY(i) * T);
  }
  GEO_CACHE.set(id, geo);
  return geo;
}

const LIFETIME = 120; // секунд до исчезновения
let NEXT_DROP_EID = 1;

export class Drops {
  constructor(scene, world, materials, audio) {
    this.scene = scene;
    this.world = world;
    this.audio = audio;
    this.mat = new THREE.MeshLambertMaterial({ map: materials.atlasTexture, alphaTest: 0.4 });
    this.list = [];
  }

  // delay — сколько секунд дроп нельзя подобрать (для выброшенных предметов)
  spawn(x, y, z, id, count = 1, vel = null, delay = 0.6) {
    if (this.list.length >= 160) this.removeDrop(this.list[0]);
    const mesh = new THREE.Mesh(dropGeometry(id), this.mat);
    mesh.position.set(x, y, z);
    this.scene.add(mesh);
    const d = {
      mesh, id, count,
      eid: NEXT_DROP_EID++,
      vx: vel ? vel.x : (Math.random() - 0.5) * 2.2,
      vy: vel ? vel.y : 2.5 + Math.random(),
      vz: vel ? vel.z : (Math.random() - 0.5) * 2.2,
      life: LIFETIME,
      delay,
      spin: Math.random() * Math.PI * 2,
    };
    this.list.push(d);
    return d;
  }

  removeDrop(d) {
    this.scene.remove(d.mesh);
    const i = this.list.indexOf(d);
    if (i >= 0) this.list.splice(i, 1);
  }

  // targets: [{isLocal?, id?, pos}], onPickup(target, id, count) -> сколько поместилось
  update(dt, targets, onPickup) {
    for (let i = this.list.length - 1; i >= 0; i--) {
      const d = this.list[i];
      d.life -= dt;
      if (d.life <= 0) { this.removeDrop(d); continue; }

      const m = d.mesh.position;
      // ближайший игрок
      let bt = null, dist = Infinity, px = 0, py = 0, pz = 0;
      for (const tg of targets) {
        const dx = tg.pos.x - m.x, dy = tg.pos.y + 0.9 - m.y, dz = tg.pos.z - m.z;
        const dd = Math.hypot(dx, dy, dz);
        if (dd < dist) { dist = dd; bt = tg; px = dx; py = dy; pz = dz; }
      }
      const pickable = bt && d.life < LIFETIME - d.delay;

      if (pickable && dist < 0.6) {
        const taken = onPickup(bt, d.id, d.count);
        if (taken > 0 && bt.isLocal && this.audio.pop) this.audio.pop();
        d.count -= taken;
        if (d.count <= 0) { this.removeDrop(d); continue; }
      } else if (pickable && dist < 2.2) {
        // магнит: летит к игроку
        const s = Math.min(dist, (4 + (2.2 - dist) * 6) * dt);
        m.x += px / dist * s;
        m.y += py / dist * s;
        m.z += pz / dist * s;
      } else {
        // свободная физика
        d.vy -= 16 * dt;
        d.vy = Math.max(d.vy, -25);
        const nx = m.x + d.vx * dt, ny = m.y + d.vy * dt, nz = m.z + d.vz * dt;
        if (!this.world.isSolid(Math.floor(nx), Math.floor(m.y), Math.floor(m.z))) m.x = nx;
        else { d.vx *= -0.3; }
        if (!this.world.isSolid(Math.floor(m.x), Math.floor(ny - 0.14), Math.floor(m.z))) m.y = ny;
        else if (d.vy < 0) { d.vy = 0; d.vx *= 0.82; d.vz *= 0.82; }
        else { d.vy = 0; }
        if (!this.world.isSolid(Math.floor(m.x), Math.floor(m.y), Math.floor(nz))) m.z = nz;
        else { d.vz *= -0.3; }
      }

      // вращение и лёгкое покачивание
      d.spin += dt * 2.2;
      d.mesh.rotation.y = d.spin;
      d.mesh.rotation.x = Math.sin(d.spin * 0.7) * 0.15;
      // мигание перед исчезновением
      d.mesh.visible = d.life > 10 || (d.life * 4 | 0) % 2 === 0;
    }
  }

  dispose() {
    for (const d of [...this.list]) this.removeDrop(d);
  }
}

// Осколки разлома блока: простая rigid-body симуляция —
// разлетаются, вращаются, отскакивают от земли и исчезают через ~секунду.
export class Debris {
  constructor(scene, world, materials) {
    this.scene = scene;
    this.world = world;
    this.mat = new THREE.MeshLambertMaterial({ map: materials.atlasTexture, alphaTest: 0.4 });
    this.list = [];
  }

  // (x,y,z) — центр разломанного блока
  spawnBreak(x, y, z, id) {
    const n = 10;
    for (let i = 0; i < n; i++) {
      if (this.list.length >= 120) {
        const old = this.list.shift();
        this.scene.remove(old.mesh);
      }
      const mesh = new THREE.Mesh(dropGeometry(id), this.mat);
      const s = 0.35 + Math.random() * 0.55;
      mesh.scale.setScalar(s);
      mesh.position.set(
        x + (Math.random() - 0.5) * 0.6,
        y + (Math.random() - 0.5) * 0.6,
        z + (Math.random() - 0.5) * 0.6
      );
      mesh.rotation.set(Math.random() * 3, Math.random() * 3, Math.random() * 3);
      this.scene.add(mesh);
      this.list.push({
        mesh, baseScale: s,
        vx: (Math.random() - 0.5) * 5,
        vy: 1.5 + Math.random() * 3.5,
        vz: (Math.random() - 0.5) * 5,
        ax: (Math.random() - 0.5) * 14,   // угловые скорости
        ay: (Math.random() - 0.5) * 14,
        az: (Math.random() - 0.5) * 14,
        life: 0.85 + Math.random() * 0.4,
      });
    }
  }

  update(dt) {
    for (let i = this.list.length - 1; i >= 0; i--) {
      const d = this.list[i];
      d.life -= dt;
      if (d.life <= 0) {
        this.scene.remove(d.mesh);
        this.list.splice(i, 1);
        continue;
      }
      const m = d.mesh.position;
      d.vy -= 22 * dt;
      // вертикаль: отскок от твёрдого с потерей энергии
      const ny = m.y + d.vy * dt;
      if (d.vy < 0 && this.world.isSolid(Math.floor(m.x), Math.floor(ny - 0.05), Math.floor(m.z))) {
        d.vy *= -0.45;
        d.vx *= 0.7; d.vz *= 0.7;
        d.ax *= 0.6; d.az *= 0.6;
      } else {
        m.y = ny;
      }
      // горизонталь: рикошет от стен
      const nx = m.x + d.vx * dt;
      if (!this.world.isSolid(Math.floor(nx), Math.floor(m.y), Math.floor(m.z))) m.x = nx;
      else d.vx *= -0.4;
      const nz = m.z + d.vz * dt;
      if (!this.world.isSolid(Math.floor(m.x), Math.floor(m.y), Math.floor(nz))) m.z = nz;
      else d.vz *= -0.4;
      // вращение осколка
      d.mesh.rotation.x += d.ax * dt;
      d.mesh.rotation.y += d.ay * dt;
      d.mesh.rotation.z += d.az * dt;
      // плавное исчезновение в конце жизни
      if (d.life < 0.3) d.mesh.scale.setScalar(d.baseScale * Math.max(0.01, d.life / 0.3));
    }
  }

  dispose() {
    for (const d of this.list) this.scene.remove(d.mesh);
    this.list = [];
  }
}
