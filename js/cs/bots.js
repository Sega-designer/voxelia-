// Блок-Страйк: боты — навигация A* по воксельной карте и боевой ИИ.
import * as THREE from 'three';
import { MAP_W, MAP_D, HOTSPOTS } from './csmap.js';
import { WeaponState, WEAPON_ORDER } from './weapons.js';

export const DIFFICULTIES = {
  easy:   { label: 'Лёгкий',  vision: 26, react: 0.7,  aimErr: 0.12,  aimSpeed: 3.5, pauseMin: 0.4,  pauseMax: 0.9 },
  normal: { label: 'Средний', vision: 36, react: 0.4,  aimErr: 0.055, aimSpeed: 6.5, pauseMin: 0.25, pauseMax: 0.55 },
  hard:   { label: 'Сложный', vision: 50, react: 0.16, aimErr: 0.022, aimSpeed: 11,  pauseMin: 0.1,  pauseMax: 0.3 },
};

export const BOT_NAMES = [
  'Шустрый', 'Клык', 'Барон', 'Гром', 'Тень', 'Штык',
  'Кобра', 'Ястреб', 'Дым', 'Волна', 'Крот', 'Финт',
  'Шершень', 'Рикошет', 'Сокол', 'Буран',
];

// ---------- навигация ----------
export function buildNav(map) {
  const walkY = new Int8Array(MAP_W * MAP_D).fill(-1);
  for (let z = 0; z < MAP_D; z++) for (let x = 0; x < MAP_W; x++) {
    // ищем НИЖНИЙ проходимый уровень (важно для крытых туннелей):
    // твёрдый пол снизу и два блока воздуха над ним
    for (let y = 1; y <= 8; y++) {
      if (map.isSolid(x, y - 1, z) && !map.isSolid(x, y, z) && !map.isSolid(x, y + 1, z)) {
        walkY[x + z * MAP_W] = y;
        break;
      }
    }
  }
  return walkY;
}

export function astar(nav, sx, sz, tx, tz, maxIter = 4000) {
  const key = (x, z) => x + z * MAP_W;
  if (nav[key(sx, sz)] < 0 || nav[key(tx, tz)] < 0) return null;
  const open = [{ x: sx, z: sz, g: 0, f: 0 }];
  const came = new Map();
  const gScore = new Map([[key(sx, sz), 0]]);
  const h = (x, z) => Math.abs(x - tx) + Math.abs(z - tz);
  let iter = 0;

  while (open.length && iter++ < maxIter) {
    // самый дешёвый узел (куча не нужна на такой карте)
    let bi = 0;
    for (let i = 1; i < open.length; i++) if (open[i].f < open[bi].f) bi = i;
    const cur = open.splice(bi, 1)[0];
    if (cur.x === tx && cur.z === tz) {
      // восстановление пути
      const path = [];
      let k = key(cur.x, cur.z);
      let node = { x: cur.x, z: cur.z };
      while (node) {
        path.push({ x: node.x + 0.5, z: node.z + 0.5, y: nav[key(node.x, node.z)] });
        node = came.get(k);
        if (node) k = key(node.x, node.z);
      }
      path.reverse();
      // прореживаем каждую вторую точку для плавности
      return path.filter((_, i) => i % 2 === 0 || i === path.length - 1);
    }
    const ck = key(cur.x, cur.z);
    const cy = nav[ck];
    for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = cur.x + dx, nz = cur.z + dz;
      if (nx < 0 || nx >= MAP_W || nz < 0 || nz >= MAP_D) continue;
      const nk = key(nx, nz);
      const ny = nav[nk];
      if (ny < 0 || Math.abs(ny - cy) > 1) continue;
      const g = cur.g + 1 + Math.abs(ny - cy) * 0.5;
      if (g < (gScore.get(nk) ?? Infinity)) {
        gScore.set(nk, g);
        came.set(nk, { x: cur.x, z: cur.z });
        open.push({ x: nx, z: nz, g, f: g + h(nx, nz) });
      }
    }
  }
  return null;
}

// ---------- бот ----------
export class Bot {
  constructor(pawn, difficulty) {
    this.pawn = pawn;
    this.diffKey = difficulty;
    this.diff = DIFFICULTIES[difficulty] || DIFFICULTIES.normal;
    this.weapon = null;          // WeaponState, выдаётся в начале раунда
    this.path = null;
    this.pathIdx = 0;
    this.repathT = 0;
    this.reactT = 0;
    this.engageT = 0;
    this.fireT = 0;
    this.strafeT = 0;
    this.strafeDir = 1;
    this.stuckT = 0;
    this.lastPos = new THREE.Vector3();
    this.target = null;
    this.heard = null;           // позиция услышанного выстрела
    this.heardT = 0;
  }

  pickWeapon() {
    // АВП реже на лёгком, нож — редкий выбор
    const pool = this.diffKey === 'easy'
      ? ['ak', 'ak', 'deagle', 'deagle', 'knife']
      : ['ak', 'ak', 'ak', 'awp', 'deagle', 'knife'];
    this.weapon = new WeaponState(pool[(Math.random() * pool.length) | 0]);
    return this.weapon;
  }

  hear(pos) {
    this.heard = pos.clone();
    this.heardT = 5;
  }

  // выбираем видимого врага
  perceive(map, enemies) {
    const eye = this.pawn.eye();
    const fwd = this.pawn.lookDir();
    let best = null, bd = Infinity;
    for (const e of enemies) {
      if (!e.alive) continue;
      const d = e.pos.distanceTo(this.pawn.pos);
      if (d > this.diff.vision) continue;
      const to = e.eye().sub(eye).normalize();
      const facing = fwd.dot(to) > -0.15; // почти круговой обзор при близости
      if (d > 6 && !facing && this.heardT <= 0) continue;
      if (!map.hasLOS(eye, e.eye())) continue;
      if (d < bd) { bd = d; best = e; }
    }
    return best;
  }

  // возвращает wish для pawn.update + может стрелять через ctx.fire
  update(dt, ctx) {
    // ctx: { map, nav, enemies, fire(bot, targetPawn), hotspotsBias }
    const p = this.pawn;
    if (!p.alive) return;
    this.heardT -= dt;
    this.repathT -= dt;
    this.fireT -= dt;
    this.strafeT -= dt;

    const enemy = this.perceive(ctx.map, ctx.enemies);
    const wish = { mx: 0, mz: 0, jump: false, crouch: false, walk: false, speed: this.weapon ? this.weapon.def.speed : 5 };

    if (enemy) {
      if (this.target !== enemy) {
        this.target = enemy;
        this.reactT = this.diff.react * (0.7 + Math.random() * 0.6);
        this.engageT = 0;
      }
      this.reactT -= dt;
      this.engageT += dt;

      // прицеливание с ошибкой (уменьшается по мере боя)
      const errK = this.diff.aimErr * (1 + 1.6 * Math.exp(-this.engageT * 1.5));
      const to = enemy.eye().sub(p.eye());
      const dist = to.length();
      to.normalize();
      const wantYaw = Math.atan2(-to.x, -to.z) + (Math.random() - 0.5) * errK * 2;
      const wantPitch = Math.asin(Math.max(-1, Math.min(1, to.y))) + (Math.random() - 0.5) * errK;
      const turn = Math.min(1, this.diff.aimSpeed * dt);
      let dy = wantYaw - p.yaw;
      while (dy > Math.PI) dy -= Math.PI * 2;
      while (dy < -Math.PI) dy += Math.PI * 2;
      p.yaw += dy * turn;
      p.pitch += (wantPitch - p.pitch) * turn;

      const w = this.weapon;
      const isKnife = w && w.def.melee;

      if (isKnife) {
        // нож: сближаемся
        wish.mz = -1;
        if (dist < w.def.range * 0.9 && this.reactT <= 0 && this.fireT <= 0) {
          this.fireT = w.def.rate;
          ctx.fire(this, enemy);
        }
      } else {
        // стрейф во время боя (кроме АВП)
        if (this.strafeT <= 0) {
          this.strafeT = 0.5 + Math.random() * 0.6;
          this.strafeDir = Math.random() < 0.5 ? -1 : 1;
        }
        if (w && w.def.zoom) {
          w.zoomed = true;
          wish.crouch = this.diffKey === 'hard';
        } else {
          wish.mx = this.strafeDir;
          if (dist > this.diff.vision * 0.7) wish.mz = -0.6; // подходим ближе
        }
        const aimed = Math.abs(dy) < 0.12 + errK;
        if (w && aimed && this.reactT <= 0 && this.fireT <= 0 && w.canFire()) {
          ctx.fire(this, enemy);
          // пауза между очередями
          if (w.ammo % ((Math.random() * 4 + 3) | 0) === 0) {
            this.fireT = this.diff.pauseMin + Math.random() * (this.diff.pauseMax - this.diff.pauseMin);
          }
        }
        if (w && w.ammo === 0 && !w.reloading) w.startReload();
      }
      this.path = null;
    } else {
      this.target = null;
      if (this.weapon && this.weapon.ammo < this.weapon.def.mag * 0.4 && !this.weapon.reloading && !this.weapon.def.melee) {
        this.weapon.startReload();
      }

      // идём к услышанному выстрелу или патрулируем
      let goal = null;
      if (this.heardT > 0 && this.heard) {
        goal = { x: this.heard.x, z: this.heard.z };
      }
      if (!this.path || this.pathIdx >= this.path.length) {
        if (!goal) {
          const hs = HOTSPOTS[(Math.random() * HOTSPOTS.length) | 0];
          goal = { x: hs[0], z: hs[1] };
        }
        if (this.repathT <= 0) {
          this.repathT = 1.5;
          this.path = astar(ctx.nav, Math.floor(p.pos.x), Math.floor(p.pos.z), Math.floor(goal.x), Math.floor(goal.z));
          this.pathIdx = 1;
        }
      }

      if (this.path && this.pathIdx < this.path.length) {
        const wp = this.path[this.pathIdx];
        const dx = wp.x - p.pos.x, dz = wp.z - p.pos.z;
        const dist = Math.hypot(dx, dz);
        if (dist < 0.7) {
          this.pathIdx++;
        } else {
          const wantYaw = Math.atan2(-dx, -dz);
          let dy = wantYaw - p.yaw;
          while (dy > Math.PI) dy -= Math.PI * 2;
          while (dy < -Math.PI) dy += Math.PI * 2;
          p.yaw += dy * Math.min(1, 8 * dt);
          p.pitch *= 1 - Math.min(1, 4 * dt);
          if (Math.abs(dy) < 1.1) wish.mz = -1;
          if (wp.y > p.pos.y + 0.6 && dist < 1.4) wish.jump = true;
        }
      }

      // антизастревание
      if (wish.mz !== 0) {
        if (p.pos.distanceTo(this.lastPos) < 0.4 * dt * 60 / 60) this.stuckT += dt;
        else this.stuckT = 0;
        if (this.stuckT > 0.8) {
          wish.jump = true;
          if (this.stuckT > 1.6) { this.path = null; this.stuckT = 0; }
        }
      }
      this.lastPos.copy(p.pos);
    }

    p.update(dt, wish);
    if (this.weapon) this.weapon.update(dt);
  }
}
