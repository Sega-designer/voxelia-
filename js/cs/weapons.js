// Блок-Страйк: оружие — КС-подобная модель стрельбы.
// Первая пуля стоя летит точно; очередь наращивает разброс и отдачу;
// присед уменьшает и то и другое. Хедшот из огнестрела — всегда летален.
import * as THREE from 'three';
import { rayVsPawn } from './pawn.js';

export const WEAPONS = {
  ak: {
    key: 'ak', name: 'Калаш', auto: true,
    dmg: 27, legMul: 0.75,
    rate: 0.1, mag: 30, reserve: 90, reload: 2.5, speed: 5.0,
    spread: 0.0008,          // первая пуля — лазер
    burstInc: 0.0038,        // рост разброса за выстрел в очереди
    burstCap: 0.035,
    moveSpread: 0.03, airSpread: 0.09,
    kickBase: 0.010, kickGrowth: 0.16, // вертикальная отдача растёт с очередью
  },
  awp: {
    key: 'awp', name: 'АВП', auto: false, zoom: true,
    dmg: 150, legMul: 1,     // ваншот в любую часть тела
    rate: 1.45, mag: 10, reserve: 30, reload: 3.2, speed: 4.3,
    spread: 0.0008, zoomSpread: 0.0008, noscope: 0.09,
    burstInc: 0, burstCap: 0,
    moveSpread: 0.2, airSpread: 0.3,
    kickBase: 0.05, kickGrowth: 0,
  },
  deagle: {
    key: 'deagle', name: 'Дигл', auto: false,
    dmg: 40, legMul: 0.75,
    rate: 0.28, mag: 7, reserve: 35, reload: 2.2, speed: 5.4,
    spread: 0.0015,
    burstInc: 0.02, burstCap: 0.06,   // спам сильно мажет, одиночные — точные
    moveSpread: 0.045, airSpread: 0.12,
    kickBase: 0.02, kickGrowth: 0.3,
  },
  knife: {
    key: 'knife', name: 'Нож', auto: true, melee: true,
    dmg: 32, heavyDmg: 66, backMul: 3, legMul: 1,
    rate: 0.45, heavyRate: 1.1, range: 2.3, speed: 6.4, // с ножом бегаешь быстрее
  },
};
export const WEAPON_ORDER = ['ak', 'awp', 'deagle', 'knife'];

export class WeaponState {
  constructor(key) {
    this.key = key;
    this.def = WEAPONS[key];
    this.ammo = this.def.mag || 0;
    this.reserve = this.def.reserve || 0;
    this.cd = 0;
    this.reloadT = 0;
    this.zoomed = false;
    this.kickT = 0;
    this.burst = 0;        // выстрелов в текущей очереди
    this.sinceShot = 99;
  }

  get reloading() { return this.reloadT > 0; }

  update(dt) {
    this.cd -= dt;
    this.kickT = Math.max(0, this.kickT - dt * 4);
    this.sinceShot += dt;
    // очередь «остывает» после короткой паузы
    if (this.sinceShot > 0.25) this.burst = Math.max(0, this.burst - dt * 26);
    if (this.reloadT > 0) {
      this.reloadT -= dt;
      if (this.reloadT <= 0) {
        const need = this.def.mag - this.ammo;
        const take = Math.min(need, this.reserve);
        this.ammo += take;
        this.reserve -= take;
      }
    }
  }

  canFire() {
    return this.cd <= 0 && !this.reloading && (this.def.melee || this.ammo > 0);
  }

  startReload() {
    if (this.def.melee || this.reloading) return false;
    if (this.ammo >= this.def.mag || this.reserve <= 0) return false;
    this.reloadT = this.def.reload;
    this.zoomed = false;
    return true;
  }

  // разброс (радианы) с учётом стойки/движения/очереди
  spreadFor(pawn) {
    const d = this.def;
    if (d.melee) return 0;
    const zoomed = d.zoom && this.zoomed;
    let s = zoomed ? d.zoomSpread : d.spread;
    if (d.zoom && !zoomed) s = d.noscope;   // АВП без прицела — молоко
    s += Math.min(d.burstCap, this.burst * d.burstInc);
    const hSpeed = Math.hypot(pawn.vel.x, pawn.vel.z);
    s += Math.min(1, hSpeed / d.speed) * d.moveSpread;
    if (!pawn.onGround) s += d.airSpread;
    if (pawn.crouching) s *= 0.65;          // с присяда точнее
    return s;
  }

  // регистрируем выстрел; возвращает вертикальную отдачу (радианы)
  onFire(pawn) {
    this.burst++;
    this.sinceShot = 0;
    this.kickT = 1;
    let kick = this.def.kickBase * (1 + this.burst * this.def.kickGrowth);
    kick = Math.min(kick, this.def.kickBase * 4);
    if (pawn.crouching) kick *= 0.55;       // с присяда отдача меньше
    return kick * (0.85 + Math.random() * 0.3);
  }
}

// направление выстрела с разбросом
export function shotDir(baseDir, spread) {
  if (spread <= 0) return baseDir.clone();
  const d = baseDir.clone();
  const a = Math.random() * Math.PI * 2;
  const r = (Math.random() + Math.random()) * 0.5 * spread;
  const up = Math.abs(d.y) > 0.9 ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(0, 1, 0);
  const t1 = new THREE.Vector3().crossVectors(d, up).normalize();
  const t2 = new THREE.Vector3().crossVectors(d, t1);
  d.addScaledVector(t1, Math.cos(a) * r).addScaledVector(t2, Math.sin(a) * r).normalize();
  return d;
}

// хитскан: карта + бойцы
export function castShot(map, origin, dir, targets, maxDist = 200) {
  const mapHit = map.raycast(origin, dir, maxDist);
  const limit = mapHit ? mapHit.dist : maxDist;
  let best = null;
  for (const p of targets) {
    const hit = rayVsPawn(origin, dir, p, limit);
    if (hit && (!best || hit.dist < best.dist)) best = { pawn: p, ...hit };
  }
  if (best) {
    return {
      pawn: best.pawn, part: best.part, dist: best.dist,
      point: origin.clone().addScaledVector(dir, best.dist), mapHit: null,
    };
  }
  return {
    pawn: null, part: null, dist: limit,
    point: origin.clone().addScaledVector(dir, limit), mapHit,
  };
}

export function damageFor(def, part, backstab = false) {
  // хедшот из огнестрела — всегда летален
  if (part === 'head' && !def.melee) return Math.max(105, def.dmg);
  let dmg = def.dmg;
  if (part === 'legs') dmg *= def.legMul;
  if (backstab && def.backMul) dmg *= def.backMul;
  return Math.round(dmg);
}

// ---------- вьюмодели ----------
const vm = (c) => {
  const m = new THREE.MeshLambertMaterial({ color: c });
  m.depthTest = false;
  return m;
};
const vbox = (w, h, d, c, x, y, z) => {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), vm(c));
  mesh.position.set(x, y, z);
  mesh.renderOrder = 110;
  return mesh;
};

export function buildViewModel(key) {
  const g = new THREE.Group();
  // рука
  g.add(vbox(0.1, 0.1, 0.3, 0xd9a066, 0.04, -0.08, 0.22));
  g.add(vbox(0.12, 0.12, 0.14, 0x3fa163, 0.04, -0.08, 0.36));

  if (key === 'ak') {
    g.add(vbox(0.055, 0.09, 0.52, 0x2a2d33, 0, 0, -0.1));
    g.add(vbox(0.05, 0.07, 0.16, 0x7a4a22, 0, -0.005, 0.26));
    g.add(vbox(0.05, 0.06, 0.14, 0x7a4a22, 0, 0.01, -0.22));
    g.add(vbox(0.03, 0.03, 0.16, 0x1c1e22, 0, 0.005, -0.42));
    const magz = vbox(0.045, 0.16, 0.08, 0x3a3d44, 0, -0.11, 0.02);
    magz.rotation.x = 0.5;
    g.add(magz);
  } else if (key === 'awp') {
    g.add(vbox(0.06, 0.1, 0.72, 0x3c5232, 0, 0, -0.14));
    g.add(vbox(0.04, 0.04, 0.3, 0x22252a, 0, 0.02, -0.55));
    g.add(vbox(0.05, 0.05, 0.22, 0x1c1e22, 0, 0.09, -0.1));
    // затвор — анимируется после выстрела
    const bolt = vbox(0.025, 0.025, 0.1, 0x8a9098, 0.045, 0.045, 0.02);
    g.add(bolt);
    g.userData.bolt = bolt;
    g.userData.boltZ = bolt.position.z;
  } else if (key === 'deagle') {
    g.add(vbox(0.05, 0.08, 0.3, 0x8a9098, 0, 0.02, -0.08));
    g.add(vbox(0.045, 0.14, 0.08, 0x2a2d33, 0, -0.07, 0.06));
  } else { // нож
    g.add(vbox(0.02, 0.07, 0.26, 0xb8c4cc, 0, 0.02, -0.16));
    g.add(vbox(0.035, 0.05, 0.1, 0x2a2016, 0, 0, 0.02));
  }

  g.traverse((m) => { if (m.isMesh) m.renderOrder = 110; });
  return g;
}

// ---------- трассеры ----------
export class Tracers {
  constructor(scene) {
    this.scene = scene;
    this.list = [];
    this.mat = new THREE.LineBasicMaterial({ color: 0xffe6a0, transparent: true, opacity: 0.85 });
  }

  spawn(from, to) {
    const geo = new THREE.BufferGeometry().setFromPoints([from, to]);
    const line = new THREE.Line(geo, this.mat.clone());
    this.scene.add(line);
    this.list.push({ line, life: 0.07 });
  }

  update(dt) {
    for (let i = this.list.length - 1; i >= 0; i--) {
      const t = this.list[i];
      t.life -= dt;
      t.line.material.opacity = Math.max(0, t.life / 0.07) * 0.85;
      if (t.life <= 0) {
        this.scene.remove(t.line);
        t.line.geometry.dispose();
        this.list.splice(i, 1);
      }
    }
  }

  dispose() {
    for (const t of this.list) { this.scene.remove(t.line); t.line.geometry.dispose(); }
    this.list = [];
  }
}
