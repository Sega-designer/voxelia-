// Враждебные ночные мобы: зомби (ближний бой) и скелет (стреляет из лука).
// Появляются ночью, на рассвете загораются и гибнут.
import * as THREE from 'three';
import { B } from './blocks.js';
import { Animals } from './animals.js';
import { lerp } from './config.js';

const MTYPES = {
  zombie: {
    hp: 10, speed: 2.0, w: 0.6, h: 1.75, dmg: 2,
    drops: [{ id: B.LEATHER, n: [0, 1] }],
  },
  skeleton: {
    hp: 8, speed: 1.8, w: 0.5, h: 1.75, dmg: 1,
    drops: [{ id: B.BONE, n: [1, 2] }, { id: B.FEATHER, n: [0, 1] }],
  },
};

const mat = (c) => new THREE.MeshLambertMaterial({ color: c });
const box = (w, h, d, c) => new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat(c));

function faceMat(type) {
  const cv = document.createElement('canvas');
  cv.width = cv.height = 16;
  const g = cv.getContext('2d');
  if (type === 'zombie') {
    g.fillStyle = '#5a9a4a'; g.fillRect(0, 0, 16, 16);
    g.fillStyle = '#101418';
    g.fillRect(3, 5, 3, 3); g.fillRect(10, 5, 3, 3);   // пустые глаза
    g.fillRect(5, 11, 6, 2);                             // мрачный рот
    g.fillStyle = '#4a7a3c'; g.fillRect(0, 0, 16, 3);    // тёмный лоб
  } else {
    g.fillStyle = '#d8d8d0'; g.fillRect(0, 0, 16, 16);
    g.fillStyle = '#181818';
    g.fillRect(3, 5, 3, 3); g.fillRect(10, 5, 3, 3);     // глазницы
    g.fillRect(7, 8, 2, 2);                              // носовое отверстие
    for (let i = 3; i < 13; i += 2) g.fillRect(i, 12, 1, 2); // зубы
  }
  const t = new THREE.CanvasTexture(cv);
  t.magFilter = THREE.NearestFilter;
  return new THREE.MeshLambertMaterial({ map: t });
}

function buildHumanoid(type) {
  const zombie = type === 'zombie';
  const skin = zombie ? 0x5a9a4a : 0xd8d8d0;
  const shirt = zombie ? 0x2e6a8a : 0xb8b8b0;
  const pants = zombie ? 0x35507a : 0xa8a8a0;

  const g = new THREE.Group();
  const head = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.42, 0.42), [
    mat(skin), mat(skin), mat(zombie ? 0x4a7a3c : 0xc8c8c0), mat(skin), faceMat(type), mat(skin),
  ]);
  head.position.y = 1.5;
  g.add(head);

  const bw = zombie ? 0.48 : 0.38, bd = zombie ? 0.24 : 0.16;
  const body = box(bw, 0.6, bd, shirt);
  body.position.y = 0.98;
  g.add(body);
  if (!zombie) { // рёбра скелета
    for (let i = 0; i < 3; i++) {
      const rib = box(0.4, 0.05, 0.18, 0x8a8a82);
      rib.position.set(0, 1.05 - i * 0.14, 0);
      g.add(rib);
    }
  }

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
  const aw = zombie ? 0.16 : 0.1;
  const armL = mkLimb(aw, 0.58, aw, zombie ? shirt : skin, -(bw / 2 + aw / 2 + 0.02), 1.26, true);
  const armR = mkLimb(aw, 0.58, aw, zombie ? shirt : skin, bw / 2 + aw / 2 + 0.02, 1.26, true);
  if (zombie) { // классические вытянутые вперёд руки
    armL.rotation.x = -1.35;
    armR.rotation.x = -1.35;
  } else { // лук в руке скелета
    const bow = box(0.04, 0.5, 0.04, 0x6b4a2b);
    bow.position.set(0, -0.5, 0.08);
    bow.rotation.x = 0.4;
    armR.add(bow);
    armR.rotation.x = -0.9;
  }
  const lw = zombie ? 0.2 : 0.12;
  mkLimb(lw, 0.68, lw, pants, -0.12, 0.68, false);
  mkLimb(lw, 0.68, lw, pants, 0.12, 0.68, false);

  return { group: g, legs, arms, head };
}

export class Mobs extends Animals {
  constructor(scene, world, audio, particles) {
    super(scene, world, audio);
    this.types = MTYPES;
    this.particles = particles;
    this.maxCount = 8;
    this.spawnTimer = 4;
    this.arrows = [];
    this.arrowGeo = new THREE.BoxGeometry(0.05, 0.05, 0.55);
    this.arrowMat = mat(0x8a7a5a);
    this.onHitPlayer = null;
  }

  buildModel(type) {
    return buildHumanoid(type);
  }

  trySpawnMob(playerPos) {
    const ang = Math.random() * Math.PI * 2;
    const dist = 16 + Math.random() * 20;
    const x = Math.floor(playerPos.x + Math.cos(ang) * dist);
    const z = Math.floor(playerPos.z + Math.sin(ang) * dist);
    const cx = Math.floor(x / 16), cz = Math.floor(z / 16);
    if (!this.world.chunks.has(cx + ',' + cz)) return;
    const h = this.world.surfaceHeight(x, z);
    if (h <= 26) return;
    if (this.world.getBlock(x, h + 1, z) !== B.AIR || this.world.getBlock(x, h + 2, z) !== B.AIR) return;
    const type = Math.random() < 0.55 ? 'zombie' : 'skeleton';
    this.spawn(type, x + 0.5, h + 1.01, z + 0.5);
  }

  // мобы не убегают от ударов — злятся
  hit(a, dmg, dir, onDrop) {
    a.hp -= dmg;
    a.flashT = 0.18;
    a.vel.x += dir.x * 6;
    a.vel.z += dir.z * 6;
    a.vel.y = 4.5;
    a.aggro = true;
    if (this.audio.animal) this.audio.animal(a.type);
    if (a.hp <= 0) this.kill(a, onDrop);
  }

  kill(a, onDrop) {
    for (const drop of a.def.drops) {
      const n = drop.n[0] + ((Math.random() * (drop.n[1] - drop.n[0] + 1)) | 0);
      if (n > 0 && onDrop) onDrop(drop.id, n, a.pos.clone().add(new THREE.Vector3(0, 1, 0)));
    }
    if (this.particles) this.particles.spawnBurst(a.pos.x, a.pos.y + 1, a.pos.z, 0x555555, 12, 2);
    this.removeAnimal(a);
  }

  // ближайшая живая цель (игрок хоста или гостя)
  nearestTarget(pos, targets) {
    let best = null, bd = Infinity;
    for (const tg of targets) {
      if (tg.god || tg.dead) continue;
      const d = pos.distanceTo(tg.pos);
      if (d < bd) { bd = d; best = tg; }
    }
    return best ? { tg: best, dist: bd } : null;
  }

  shoot(a, tg) {
    const from = new THREE.Vector3(a.pos.x, a.pos.y + 1.45, a.pos.z);
    const target = new THREE.Vector3(tg.pos.x, tg.pos.y + 1.2, tg.pos.z);
    const delta = target.sub(from);
    const dist = delta.length();
    const dir = delta.normalize();
    // линия видимости: не стреляем сквозь блоки
    if (this.world.raycast(from, dir, dist, true)) return;
    const mesh = new THREE.Mesh(this.arrowGeo, this.arrowMat);
    mesh.position.copy(from);
    this.scene.add(mesh);
    this.arrows.push({
      mesh,
      vel: dir.multiplyScalar(18).add(new THREE.Vector3(0, dist * 0.07, 0)), // поправка дуги
      life: 3,
    });
    if (this.audio.arrow) this.audio.arrow();
  }

  removeArrow(i) {
    this.scene.remove(this.arrows[i].mesh);
    this.arrows.splice(i, 1);
  }

  updateArrows(dt, targets) {
    for (let i = this.arrows.length - 1; i >= 0; i--) {
      const ar = this.arrows[i];
      ar.life -= dt;
      if (ar.life <= 0) { this.removeArrow(i); continue; }
      ar.vel.y -= 7 * dt;
      const p = ar.mesh.position;
      p.addScaledVector(ar.vel, dt);
      ar.mesh.lookAt(p.x + ar.vel.x, p.y + ar.vel.y, p.z + ar.vel.z);
      if (this.world.isSolid(Math.floor(p.x), Math.floor(p.y), Math.floor(p.z))) {
        this.removeArrow(i);
        continue;
      }
      for (const tg of targets) {
        if (tg.god || tg.dead) continue;
        const dx = p.x - tg.pos.x, dy = p.y - (tg.pos.y + 0.9), dz = p.z - tg.pos.z;
        if (dx * dx + dy * dy + dz * dz < 0.5) {
          if (this.onHitTarget) this.onHitTarget(tg, 1, ar.vel.clone().normalize());
          this.removeArrow(i);
          break;
        }
      }
    }
  }

  updateMob(a, dt, targets) {
    const nt = this.nearestTarget(a.pos, targets);
    const hostile = nt && nt.dist < 26;
    a.attackCd = (a.attackCd || 0) - dt;
    a.shootCd = (a.shootCd || 0) - dt;

    let moving;
    if (hostile) {
      const tp = nt.tg.pos;
      const distP = nt.dist;
      const toP = Math.atan2(tp.x - a.pos.x, tp.z - a.pos.z);
      if (a.type === 'zombie') {
        a.targetYaw = toP;
        moving = distP > 1.1;
        if (distP < 1.6 && a.attackCd <= 0) {
          a.attackCd = 1.2;
          const dir = new THREE.Vector3(tp.x - a.pos.x, 0, tp.z - a.pos.z).normalize();
          if (this.onHitTarget) this.onHitTarget(nt.tg, a.def.dmg, dir);
          if (this.audio.animal) this.audio.animal('zombie');
        }
      } else { // скелет держит дистанцию и стреляет
        if (distP < 5) { a.targetYaw = toP + Math.PI; moving = true; }
        else if (distP > 14) { a.targetYaw = toP; moving = true; }
        else { a.targetYaw = toP; moving = false; }
        if (distP < 15 && a.shootCd <= 0) {
          a.shootCd = 2.2;
          this.shoot(a, nt.tg);
        }
      }
    } else {
      // мирное блуждание как у животных
      a.timer -= dt;
      if (a.timer <= 0) {
        if (a.state === 'walk') { a.state = 'idle'; a.timer = 1.5 + Math.random() * 3; }
        else { a.state = 'walk'; a.timer = 2 + Math.random() * 4; a.targetYaw = Math.random() * Math.PI * 2; }
      }
      moving = a.state === 'walk';
    }

    // плавный поворот
    let dy = a.targetYaw - a.yaw;
    while (dy > Math.PI) dy -= Math.PI * 2;
    while (dy < -Math.PI) dy += Math.PI * 2;
    a.yaw += dy * Math.min(1, 6 * dt);

    const speed = a.def.speed;
    const k = 1 - Math.exp(-8 * dt);
    a.vel.x = lerp(a.vel.x, moving ? Math.sin(a.yaw) * speed : 0, k);
    a.vel.z = lerp(a.vel.z, moving ? Math.cos(a.yaw) * speed : 0, k);

    const feetBlock = this.world.getBlock(Math.floor(a.pos.x), Math.floor(a.pos.y + 0.3), Math.floor(a.pos.z));
    if (feetBlock === B.WATER) a.vel.y = lerp(a.vel.y, 2, 1 - Math.exp(-4 * dt));
    else a.vel.y -= 22 * dt;
    a.vel.y = Math.max(a.vel.y, -30);

    a.onGround = false;
    this.collideAxis(a, 1, a.vel.y * dt);
    const blockedX = this.collideAxis(a, 0, a.vel.x * dt);
    const blockedZ = this.collideAxis(a, 2, a.vel.z * dt);
    if (moving && a.onGround && (blockedX || blockedZ)) a.vel.y = 7.5;

    // анимация
    a.group.position.copy(a.pos);
    a.group.rotation.y = a.yaw;
    const hSpeed = Math.hypot(a.vel.x, a.vel.z);
    a.walkPhase += hSpeed * dt * 3;
    const swing = Math.sin(a.walkPhase) * Math.min(1, hSpeed) * 0.55;
    a.legs.forEach((leg, i) => { leg.rotation.x = i % 2 ? swing : -swing; });
    if (a.type === 'skeleton') {
      a.arms.forEach((arm, i) => {
        const base = i === 1 ? -0.9 : 0; // правая держит лук
        arm.rotation.x = base + (i % 2 ? swing : -swing) * 0.4;
      });
    }
    if (a.head) a.head.rotation.x = Math.sin(a.walkPhase * 0.3) * 0.06;

    // вспышка урона
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

    // случайные звуки
    a.soundT -= dt;
    if (a.soundT <= 0) {
      a.soundT = 5 + Math.random() * 10;
      if (nt && nt.dist < 20 && this.audio.animal) this.audio.animal(a.type);
    }

    if (a.pos.y < -8) this.removeAnimal(a);
  }

  // targets: [{isLocal?, id?, pos, god, dead}], onHitTarget(target, dmg, dir), onDrop(id, count, pos)
  update(dt, targets, daylight, onHitTarget, onDrop) {
    this.onHitTarget = onHitTarget;
    const anchor = targets[0].pos; // хост — центр симуляции
    const night = daylight < 0.22;

    if (night) {
      this.spawnTimer -= dt;
      if (this.spawnTimer <= 0) {
        this.spawnTimer = 2.5;
        if (this.list.length < this.maxCount) {
          // спавним вокруг случайного игрока
          const around = targets[(Math.random() * targets.length) | 0].pos;
          this.trySpawnMob(around);
        }
      }
    }

    for (let i = this.list.length - 1; i >= 0; i--) {
      const a = this.list[i];
      const dx = a.pos.x - anchor.x, dz = a.pos.z - anchor.z;
      if (dx * dx + dz * dz > 72 * 72) { this.removeAnimal(a); continue; }

      // днём мобы горят
      if (daylight > 0.35) {
        a.burnT = (a.burnT || 0) + dt;
        if (a.burnT > 0.6) {
          a.burnT = 0;
          a.hp -= 2;
          a.flashT = 0.15;
          if (this.particles) this.particles.spawnBurst(a.pos.x, a.pos.y + 1.3, a.pos.z, 0xff8020, 6, 1.5);
          if (a.hp <= 0) { this.kill(a, onDrop); continue; }
        }
      }

      this.updateMob(a, dt, targets);
    }

    this.updateArrows(dt, targets);
  }

  dispose() {
    super.dispose();
    for (const ar of this.arrows) this.scene.remove(ar.mesh);
    this.arrows = [];
  }
}
