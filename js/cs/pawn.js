// Блок-Страйк: боец (игрок/бот/сетевой игрок) — физика, модель, урон.
import * as THREE from 'three';
import { lerp, clamp } from '../config.js';

const HALF_W = 0.3, HEIGHT = 1.8, CROUCH_H = 1.3;
const GRAVITY = 24, JUMP_V = 7.8;

const mat = (c) => new THREE.MeshLambertMaterial({ color: c });
const box = (w, h, d, c) => new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat(c));

function faceTex(skin) {
  const cv = document.createElement('canvas');
  cv.width = cv.height = 16;
  const g = cv.getContext('2d');
  g.fillStyle = skin; g.fillRect(0, 0, 16, 16);
  g.fillStyle = '#141414';
  g.fillRect(3, 6, 3, 2); g.fillRect(10, 6, 3, 2);
  g.fillStyle = '#8a5a34'; g.fillRect(6, 12, 4, 1);
  const t = new THREE.CanvasTexture(cv);
  t.magFilter = THREE.NearestFilter;
  return new THREE.MeshLambertMaterial({ map: t });
}

// Воксельный солдат: СТ — синие, Т — оранжевые
export function buildSoldier(team) {
  const ct = team === 'ct';
  const uniform = ct ? 0x2e4a8c : 0xa06028;
  const uniformD = ct ? 0x223a6e : 0x7e4c1c;
  const skin = '#d9a066';

  const g = new THREE.Group();
  const head = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.42, 0.42), [
    mat(0xd9a066), mat(0xd9a066), mat(0xd9a066), mat(0xd9a066), faceTex(skin), mat(0xc4854e),
  ]);
  head.position.y = 1.5;
  g.add(head);
  // шлем / бандана
  const helmet = box(0.46, ct ? 0.18 : 0.12, 0.46, ct ? 0x1c2c52 : 0x6e2e1a);
  helmet.position.y = ct ? 1.68 : 1.66;
  g.add(helmet);

  const body = box(0.5, 0.62, 0.26, uniform);
  body.position.y = 0.97;
  g.add(body);
  const vest = box(0.54, 0.4, 0.3, uniformD); // бронежилет
  vest.position.y = 1.05;
  g.add(vest);

  const legs = [], arms = [];
  const mkLimb = (w, h, d, c, x, y, isArm) => {
    const pivot = new THREE.Group();
    pivot.position.set(x, y, 0);
    const m = box(w, h, d, c);
    m.position.y = -h / 2;
    pivot.add(m);
    g.add(pivot);
    (isArm ? arms : legs).push(pivot);
    return pivot;
  };
  const armL = mkLimb(0.16, 0.58, 0.16, uniform, -0.34, 1.26, true);
  const armR = mkLimb(0.16, 0.58, 0.16, uniform, 0.34, 1.26, true);
  // руки держат оружие перед собой
  armL.rotation.x = -1.1; armL.rotation.z = 0.35;
  armR.rotation.x = -1.2;
  const gun = box(0.08, 0.1, 0.55, 0x22252a);
  gun.position.set(-0.1, -0.5, -0.15);
  armR.add(gun);
  mkLimb(0.2, 0.68, 0.2, uniformD, -0.13, 0.68, false);
  mkLimb(0.2, 0.68, 0.2, uniformD, 0.13, 0.68, false);

  return { group: g, head, legs, arms, gun };
}

let NEXT_PAWN_ID = 1;

export class Pawn {
  constructor(scene, map, team, name, isLocal = false) {
    this.id = 'p' + NEXT_PAWN_ID++;
    this.scene = scene;
    this.map = map;
    this.team = team;      // 'ct' | 't'
    this.name = name;
    this.isLocal = isLocal;
    this.pos = new THREE.Vector3(48, 2, 8);
    this.vel = new THREE.Vector3();
    this.yaw = 0; this.pitch = 0;
    this.onGround = false;
    this.crouching = false;
    this.hp = 100;
    this.alive = true;
    this.kills = 0; this.deaths = 0;
    this.walkPhase = 0;
    this.stepDist = 0;
    this.flashT = 0;
    this.corpseT = 0;

    const model = buildSoldier(team);
    this.model = model.group;
    this.modelParts = model;
    this.model.visible = !isLocal;
    scene.add(this.model);
  }

  height() { return this.crouching ? CROUCH_H : HEIGHT; }
  eyeY() { return this.crouching ? 1.14 : 1.62; }
  eye() { return new THREE.Vector3(this.pos.x, this.pos.y + this.eyeY(), this.pos.z); }

  lookDir() {
    return new THREE.Vector3(
      -Math.sin(this.yaw) * Math.cos(this.pitch),
      Math.sin(this.pitch),
      -Math.cos(this.yaw) * Math.cos(this.pitch)
    );
  }

  collides() {
    const h = this.height();
    const minX = Math.floor(this.pos.x - HALF_W), maxX = Math.floor(this.pos.x + HALF_W);
    const minY = Math.floor(this.pos.y), maxY = Math.floor(this.pos.y + h - 0.001);
    const minZ = Math.floor(this.pos.z - HALF_W), maxZ = Math.floor(this.pos.z + HALF_W);
    for (let y = minY; y <= maxY; y++) for (let z = minZ; z <= maxZ; z++) for (let x = minX; x <= maxX; x++) {
      if (this.map.isSolid(x, y, z)) return true;
    }
    return false;
  }

  collideAxis(axis, delta) {
    if (delta === 0) return false;
    this.pos.setComponent(axis, this.pos.getComponent(axis) + delta);
    const h = this.height();
    const minX = Math.floor(this.pos.x - HALF_W), maxX = Math.floor(this.pos.x + HALF_W);
    const minY = Math.floor(this.pos.y), maxY = Math.floor(this.pos.y + h - 0.001);
    const minZ = Math.floor(this.pos.z - HALF_W), maxZ = Math.floor(this.pos.z + HALF_W);
    for (let y = minY; y <= maxY; y++) for (let z = minZ; z <= maxZ; z++) for (let x = minX; x <= maxX; x++) {
      if (!this.map.isSolid(x, y, z)) continue;
      if (axis === 0) {
        this.pos.x = delta > 0 ? x - HALF_W - 0.001 : x + 1 + HALF_W + 0.001;
        this.vel.x = 0;
      } else if (axis === 1) {
        if (delta > 0) this.pos.y = y - h - 0.001;
        else { this.pos.y = y + 1 + 0.001; this.onGround = true; }
        this.vel.y = 0;
      } else {
        this.pos.z = delta > 0 ? z - HALF_W - 0.001 : z + 1 + HALF_W + 0.001;
        this.vel.z = 0;
      }
      return true;
    }
    return false;
  }

  // горизонтальное движение с автошагом на ступеньку высотой 1
  moveHorizontal(axis, delta) {
    if (delta === 0) return false;
    const startPos = this.pos.clone();
    const startVel = this.vel.getComponent(axis);
    const blocked = this.collideAxis(axis, delta);
    if (blocked && this.onGround) {
      // пробуем шагнуть на блок выше
      const afterPos = this.pos.clone();
      const afterVel = this.vel.getComponent(axis);
      this.pos.copy(startPos);
      this.pos.y += 1.02;
      this.vel.setComponent(axis, startVel);
      if (!this.collides()) {
        const stillBlocked = this.collideAxis(axis, delta);
        if (!stillBlocked) return false; // шагнули успешно
      }
      // не вышло — возвращаем как было после обычной коллизии
      this.pos.copy(afterPos);
      this.vel.setComponent(axis, afterVel);
    }
    return blocked;
  }

  // wish: { mx, mz, jump, crouch, walk, speed } — speed задаёт оружие
  update(dt, wish) {
    if (!this.alive) return;
    this.crouching = !!wish.crouch;

    let speed = wish.speed || 5;
    if (this.crouching) speed = 2.4;
    else if (wish.walk) speed = 2.8;

    let { mx, mz } = wish;
    const len = Math.hypot(mx, mz);
    if (len > 0) { mx /= len; mz /= len; }
    const sin = Math.sin(this.yaw), cos = Math.cos(this.yaw);
    const wishX = (mx * cos + mz * sin) * speed;
    const wishZ = (mz * cos - mx * sin) * speed;

    const accel = this.onGround ? 12 : 2.2;
    const k = 1 - Math.exp(-accel * dt);
    this.vel.x = lerp(this.vel.x, wishX, k);
    this.vel.z = lerp(this.vel.z, wishZ, k);

    this.vel.y -= GRAVITY * dt;
    if (wish.jump && this.onGround) {
      this.vel.y = JUMP_V;
      this.onGround = false;
    }
    this.vel.y = clamp(this.vel.y, -40, 40);

    this.onGround = false;
    this.collideAxis(1, this.vel.y * dt);
    this.moveHorizontal(0, this.vel.x * dt);
    this.moveHorizontal(2, this.vel.z * dt);

    // шаги (расстояние для звука считает csmain)
    const hSpeed = Math.hypot(this.vel.x, this.vel.z);
    if (this.onGround && hSpeed > 0.5) this.stepDist += hSpeed * dt;
    this.walkPhase += hSpeed * dt * 2.4;

    this.updateModel(hSpeed);
    if (this.pos.y < -6) this.hp = 0; // выпал с карты
  }

  updateModel(hSpeed = 0) {
    if (!this.model.visible) return;
    this.model.position.copy(this.pos);
    this.model.rotation.y = this.yaw + Math.PI;
    this.modelParts.head.rotation.x = -this.pitch;
    const swing = Math.sin(this.walkPhase) * Math.min(1, hSpeed / 4) * 0.6;
    this.modelParts.legs[0].rotation.x = -swing;
    this.modelParts.legs[1].rotation.x = swing;
    this.model.scale.y = this.crouching ? 0.78 : 1;

    if (this.flashT > 0) {
      this.flashT -= 1 / 60;
      const on = this.flashT > 0;
      this.model.traverse((m) => {
        if (m.isMesh) {
          const mats = Array.isArray(m.material) ? m.material : [m.material];
          for (const mm of mats) if (mm.emissive) mm.emissive.setHex(on ? 0x991111 : 0x000000);
        }
      });
    }
  }

  // урон; возвращает true, если боец погиб
  applyDamage(dmg) {
    if (!this.alive) return false;
    this.hp -= dmg;
    this.flashT = 0.15;
    if (this.hp <= 0) {
      this.hp = 0;
      this.die();
      return true;
    }
    return false;
  }

  die() {
    this.alive = false;
    this.deaths++;
    // «труп»: модель заваливается набок
    this.model.visible = true;
    this.model.rotation.z = (Math.random() < 0.5 ? 1 : -1) * Math.PI / 2;
    this.model.position.y = this.pos.y + 0.3;
    this.corpseT = 6;
  }

  respawn(x, z, yaw, map) {
    this.pos.set(x + 0.5, map.groundY(Math.floor(x), Math.floor(z)) + 0.01, z + 0.5);
    this.vel.set(0, 0, 0);
    this.yaw = yaw;
    this.pitch = 0;
    this.hp = 100;
    this.alive = true;
    this.crouching = false;
    this.model.rotation.set(0, yaw + Math.PI, 0);
    this.model.visible = !this.isLocal;
    this.flashT = 0;
  }

  dispose() {
    this.scene.remove(this.model);
  }
}

// Пересечение луча с хитбоксом бойца. Возвращает { dist, part } или null.
export function rayVsPawn(origin, dir, pawn, maxDist) {
  if (!pawn.alive) return null;
  const h = pawn.height();
  const half = HALF_W + 0.05;
  const min = [pawn.pos.x - half, pawn.pos.y, pawn.pos.z - half];
  const max = [pawn.pos.x + half, pawn.pos.y + h, pawn.pos.z + half];
  const o = [origin.x, origin.y, origin.z], d = [dir.x, dir.y, dir.z];
  let tmin = 0, tmax = Infinity;
  for (let i = 0; i < 3; i++) {
    if (Math.abs(d[i]) < 1e-8) {
      if (o[i] < min[i] || o[i] > max[i]) return null;
    } else {
      let t1 = (min[i] - o[i]) / d[i], t2 = (max[i] - o[i]) / d[i];
      if (t1 > t2) { const t = t1; t1 = t2; t2 = t; }
      tmin = Math.max(tmin, t1);
      tmax = Math.min(tmax, t2);
      if (tmin > tmax) return null;
    }
  }
  if (tmin > maxDist) return null;
  const hitY = origin.y + dir.y * tmin - pawn.pos.y;
  const part = hitY > (pawn.crouching ? 1.0 : 1.42) ? 'head' : hitY < 0.65 ? 'legs' : 'body';
  return { dist: tmin, part };
}
