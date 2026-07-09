// Сетевой кооператив через PeerJS (WebRTC): хост-авторитарная модель.
// Хост считает мир (мобы, дропы, время), гости получают снапшоты.
import * as THREE from 'three';
import { Player } from './player/player.js';
import { Animals } from './animals.js';
import { Mobs } from './mobs.js';
import { dropGeometry } from './items.js';
import { lerp } from './config.js';

const PREFIX = 'voxelia-ru-';
const CODE_CHARS = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

// STUN + бесплатные TURN-ретрансляторы (Open Relay) — чтобы игроки
// из разных стран соединялись даже за строгими NAT
const PEER_OPTS = {
  config: {
    iceServers: [
      { urls: 'stun:stun.l.google.com:19302' },
      { urls: 'stun:global.stun.twilio.com:3478' },
      {
        urls: ['turn:openrelay.metered.ca:80', 'turn:openrelay.metered.ca:443', 'turns:openrelay.metered.ca:443'],
        username: 'openrelayproject',
        credential: 'openrelayproject',
      },
    ],
  },
};

// ---------- транспорт ----------
export class Net {
  constructor() { this.reset(); }

  reset() {
    this.peer = null;
    this.conns = [];
    this.isHost = false;
    this.active = false;
    this.roomCode = null;
    this.onMessage = null;
    this.onPeerJoin = null;
    this.onPeerLeave = null;
    this.onClosed = null;
  }

  makeCode() {
    let s = '';
    for (let i = 0; i < 4; i++) s += CODE_CHARS[(Math.random() * CODE_CHARS.length) | 0];
    return s;
  }

  host(cb, attempt = 0) {
    if (typeof Peer === 'undefined') { cb(new Error('PeerJS не загружен')); return; }
    const code = this.makeCode();
    const peer = new Peer(PREFIX + code.toLowerCase(), PEER_OPTS);
    let done = false;
    peer.on('open', () => {
      if (done) return;
      done = true;
      this.peer = peer;
      this.isHost = true;
      this.active = true;
      this.roomCode = code;
      peer.on('connection', (conn) => this.setupConn(conn));
      cb(null, code);
    });
    peer.on('error', (e) => {
      if (done) return;
      if (e.type === 'unavailable-id' && attempt < 3) {
        peer.destroy();
        this.host(cb, attempt + 1); // код занят — пробуем другой
        return;
      }
      done = true;
      peer.destroy();
      cb(e);
    });
  }

  join(code, cb) {
    if (typeof Peer === 'undefined') { cb(new Error('PeerJS не загружен')); return; }
    const peer = new Peer(PEER_OPTS);
    let done = false;
    const fail = (e) => { if (!done) { done = true; peer.destroy(); cb(e); } };
    const timeout = setTimeout(() => fail(new Error('timeout')), 10000);
    peer.on('open', () => {
      const conn = peer.connect(PREFIX + code.toLowerCase(), { reliable: true });
      conn.on('open', () => {
        if (done) return;
        done = true;
        clearTimeout(timeout);
        this.peer = peer;
        this.isHost = false;
        this.active = true;
        this.roomCode = code.toUpperCase();
        this.setupConn(conn);
        cb(null);
      });
      conn.on('error', (e) => { clearTimeout(timeout); fail(e); });
    });
    peer.on('error', (e) => { clearTimeout(timeout); fail(e); });
  }

  setupConn(conn) {
    this.conns.push(conn);
    conn.on('data', (msg) => { if (this.onMessage) this.onMessage(msg, conn); });
    conn.on('close', () => {
      this.conns = this.conns.filter((c) => c !== conn);
      if (this.isHost) { if (this.onPeerLeave) this.onPeerLeave(conn); }
      else if (this.active) { if (this.onClosed) this.onClosed(); }
    });
    if (this.isHost && this.onPeerJoin) this.onPeerJoin(conn);
  }

  send(msg, conn = null) {
    const list = conn ? [conn] : this.conns;
    for (const c of list) { if (c.open) c.send(msg); }
  }

  relayExcept(msg, except) {
    for (const c of this.conns) { if (c !== except && c.open) c.send(msg); }
  }

  playerCount() { return this.conns.length + 1; }

  close() {
    const peer = this.peer;
    this.reset();
    if (peer) peer.destroy();
  }
}

// ---------- аватары других игроков ----------
function buildPlayerAvatar() {
  const stub = {};
  const group = Player.prototype.buildModel.call(stub);
  return { group, head: stub.head, armL: stub.armL, armR: stub.armR, legL: stub.legL, legR: stub.legR };
}

export class RemotePlayers {
  constructor(scene) {
    this.scene = scene;
    this.map = new Map();
  }

  upsert(id, data) {
    let rp = this.map.get(id);
    if (!rp) {
      const model = buildPlayerAvatar();
      model.group.visible = true;
      this.scene.add(model.group);
      rp = {
        id, model,
        pos: new THREE.Vector3(data.x, data.y, data.z),
        tgt: new THREE.Vector3(data.x, data.y, data.z),
        prev: new THREE.Vector3(data.x, data.y, data.z),
        yaw: data.yaw, tgtYaw: data.yaw, pitch: 0,
        swing: 0, walkPhase: 0, speed: 0,
        god: false, dead: false,
      };
      this.map.set(id, rp);
    }
    rp.tgt.set(data.x, data.y, data.z);
    rp.tgtYaw = data.yaw;
    rp.pitch = data.pitch || 0;
    rp.god = !!data.god;
    rp.dead = !!data.dead;
    if (data.sw) rp.swing = 0.3;
  }

  remove(id) {
    const rp = this.map.get(id);
    if (rp) {
      this.scene.remove(rp.model.group);
      this.map.delete(id);
    }
  }

  update(dt) {
    for (const rp of this.map.values()) {
      const k = 1 - Math.exp(-14 * dt);
      rp.prev.copy(rp.pos);
      rp.pos.lerp(rp.tgt, k);
      let dy = rp.tgtYaw - rp.yaw;
      while (dy > Math.PI) dy -= Math.PI * 2;
      while (dy < -Math.PI) dy += Math.PI * 2;
      rp.yaw += dy * Math.min(1, 12 * dt);

      const m = rp.model;
      m.group.position.copy(rp.pos);
      m.group.rotation.y = rp.yaw + Math.PI;
      m.group.visible = !rp.dead;
      m.head.rotation.x = -rp.pitch;

      // анимация ходьбы по фактической скорости
      const hs = Math.hypot(rp.pos.x - rp.prev.x, rp.pos.z - rp.prev.z) / Math.max(dt, 1e-4);
      rp.speed = lerp(rp.speed, hs, 0.2);
      rp.walkPhase += rp.speed * dt * 2.2;
      const swing = Math.sin(rp.walkPhase) * Math.min(1, rp.speed / 4.3) * 0.7;
      m.legL.rotation.x = -swing;
      m.legR.rotation.x = swing;
      m.armL.rotation.x = swing;
      // правая рука: замах или шаг
      rp.swing = Math.max(0, rp.swing - dt);
      m.armR.rotation.x = rp.swing > 0 ? -Math.sin((rp.swing / 0.3) * Math.PI) * 1.6 : -swing;
    }
  }

  dispose() {
    for (const rp of this.map.values()) this.scene.remove(rp.model.group);
    this.map.clear();
  }
}

// ---------- марионетки существ и дропов (на стороне гостя) ----------
export const KIND = ['chicken', 'pig', 'sheep', 'cow', 'zombie', 'skeleton'];
export const KIND_IDX = { chicken: 0, pig: 1, sheep: 2, cow: 3, zombie: 4, skeleton: 5 };
const KIND_SIZE = {
  chicken: [0.35, 0.55], pig: [0.7, 0.85], sheep: [0.7, 1.1],
  cow: [0.8, 1.3], zombie: [0.6, 1.75], skeleton: [0.5, 1.75],
};

export class RemoteEntities {
  constructor(scene, materials) {
    this.scene = scene;
    this.creatures = new Map(); // eid -> puppet
    this.drops = new Map();     // eid -> {mesh, spin}
    this.dropMat = new THREE.MeshLambertMaterial({ map: materials.atlasTexture, alphaTest: 0.4 });
  }

  buildCreature(kindIdx) {
    const type = KIND[kindIdx];
    const model = kindIdx < 4
      ? Animals.prototype.buildModel.call(null, type)
      : Mobs.prototype.buildModel.call(null, type);
    return { type, model };
  }

  applySnapshot(msg) {
    // существа: [eid, kind, x, y, z, yaw, flash]
    const seenC = new Set();
    for (const row of msg.c) {
      const [eid, kind, x, y, z, yaw, flash] = row;
      seenC.add(eid);
      let p = this.creatures.get(eid);
      if (!p) {
        const { type, model } = this.buildCreature(kind);
        this.scene.add(model.group);
        p = {
          type, model,
          pos: new THREE.Vector3(x, y, z), tgt: new THREE.Vector3(x, y, z),
          yaw, tgtYaw: yaw, walkPhase: 0, speed: 0, flash: 0,
        };
        this.creatures.set(eid, p);
      }
      p.tgt.set(x, y, z);
      p.tgtYaw = yaw;
      if (flash) p.flash = 0.18;
    }
    for (const [eid, p] of this.creatures) {
      if (!seenC.has(eid)) { this.scene.remove(p.model.group); this.creatures.delete(eid); }
    }

    // дропы: [eid, itemId, x, y, z]
    const seenD = new Set();
    for (const [eid, itemId, x, y, z] of msg.d) {
      seenD.add(eid);
      let dr = this.drops.get(eid);
      if (!dr) {
        const mesh = new THREE.Mesh(dropGeometry(itemId), this.dropMat);
        this.scene.add(mesh);
        dr = { mesh, tgt: new THREE.Vector3(x, y, z), spin: Math.random() * 6 };
        mesh.position.set(x, y, z);
        this.drops.set(eid, dr);
      }
      dr.tgt.set(x, y, z);
    }
    for (const [eid, dr] of this.drops) {
      if (!seenD.has(eid)) { this.scene.remove(dr.mesh); this.drops.delete(eid); }
    }
  }

  update(dt) {
    const k = 1 - Math.exp(-12 * dt);
    for (const p of this.creatures.values()) {
      const prevX = p.pos.x, prevZ = p.pos.z;
      p.pos.lerp(p.tgt, k);
      let dy = p.tgtYaw - p.yaw;
      while (dy > Math.PI) dy -= Math.PI * 2;
      while (dy < -Math.PI) dy += Math.PI * 2;
      p.yaw += dy * Math.min(1, 10 * dt);

      p.model.group.position.copy(p.pos);
      p.model.group.rotation.y = p.yaw;

      const hs = Math.hypot(p.pos.x - prevX, p.pos.z - prevZ) / Math.max(dt, 1e-4);
      p.speed = lerp(p.speed, hs, 0.2);
      p.walkPhase += p.speed * dt * 3;
      const swing = Math.sin(p.walkPhase) * Math.min(1, p.speed) * 0.55;
      p.model.legs.forEach((leg, i) => { leg.rotation.x = i % 2 ? swing : -swing; });

      if (p.flash > 0) {
        p.flash -= dt;
        const on = p.flash > 0;
        p.model.group.traverse((m) => {
          if (m.isMesh) {
            const mats = Array.isArray(m.material) ? m.material : [m.material];
            for (const mm of mats) if (mm.emissive) mm.emissive.setHex(on ? 0x882222 : 0x000000);
          }
        });
      }
    }
    for (const dr of this.drops.values()) {
      dr.mesh.position.lerp(dr.tgt, k);
      dr.spin += dt * 2.2;
      dr.mesh.rotation.y = dr.spin;
    }
  }

  // рейкаст по марионеткам — чтобы гость мог бить мобов
  tryHit(origin, dir, maxDist) {
    let best = null;
    for (const [eid, p] of this.creatures) {
      const [w, h] = KIND_SIZE[p.type];
      const half = w / 2 + 0.1;
      const min = [p.pos.x - half, p.pos.y, p.pos.z - half];
      const max = [p.pos.x + half, p.pos.y + h, p.pos.z + half];
      let tmin = 0, tmax = Infinity, ok = true;
      const o = [origin.x, origin.y, origin.z], d = [dir.x, dir.y, dir.z];
      for (let i = 0; i < 3; i++) {
        if (Math.abs(d[i]) < 1e-8) {
          if (o[i] < min[i] || o[i] > max[i]) { ok = false; break; }
        } else {
          let t1 = (min[i] - o[i]) / d[i], t2 = (max[i] - o[i]) / d[i];
          if (t1 > t2) { const t = t1; t1 = t2; t2 = t; }
          tmin = Math.max(tmin, t1);
          tmax = Math.min(tmax, t2);
          if (tmin > tmax) { ok = false; break; }
        }
      }
      if (ok && tmin <= maxDist && (!best || tmin < best.dist)) best = { eid, dist: tmin };
    }
    return best;
  }

  flashEid(eid) {
    const p = this.creatures.get(eid);
    if (p) p.flash = 0.18;
  }

  dispose() {
    for (const p of this.creatures.values()) this.scene.remove(p.model.group);
    for (const dr of this.drops.values()) this.scene.remove(dr.mesh);
    this.creatures.clear();
    this.drops.clear();
  }
}
