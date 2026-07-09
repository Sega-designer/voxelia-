// Частицы: дождь, пустынная пыль, осколки блоков, искры лавы.
import * as THREE from 'three';
import { Settings, QUALITY } from './config.js';

export class Particles {
  constructor(scene) {
    this.scene = scene;
    this.buildRain();
    this.buildDust();
    this.buildBurst();
  }

  buildRain() {
    if (this.rain) { this.scene.remove(this.rain); this.rain.geometry.dispose(); }
    const count = QUALITY[Settings.quality].rain;
    this.rainCount = count;
    const pos = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      pos[i * 3] = (Math.random() - 0.5) * 40;
      pos[i * 3 + 1] = Math.random() * 30;
      pos[i * 3 + 2] = (Math.random() - 0.5) * 40;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    this.rain = new THREE.Points(geo, new THREE.PointsMaterial({
      color: 0x9db8d8, size: 0.09, transparent: true, opacity: 0.55, sizeAttenuation: true,
    }));
    this.rain.frustumCulled = false;
    this.rain.visible = false;
    this.scene.add(this.rain);
  }

  buildDust() {
    if (this.dust) { this.scene.remove(this.dust); this.dust.geometry.dispose(); }
    const count = QUALITY[Settings.quality].dust;
    this.dustCount = count;
    const pos = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      pos[i * 3] = (Math.random() - 0.5) * 30;
      pos[i * 3 + 1] = Math.random() * 8;
      pos[i * 3 + 2] = (Math.random() - 0.5) * 30;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    this.dust = new THREE.Points(geo, new THREE.PointsMaterial({
      color: 0xd8c080, size: 0.12, transparent: true, opacity: 0.35,
    }));
    this.dust.frustumCulled = false;
    this.dust.visible = false;
    this.scene.add(this.dust);
  }

  buildBurst() {
    const MAX = 320;
    this.burstMax = MAX;
    this.burstPos = new Float32Array(MAX * 3);
    this.burstVel = new Float32Array(MAX * 3);
    this.burstLife = new Float32Array(MAX);
    this.burstCol = new Float32Array(MAX * 3);
    this.burstCursor = 0;
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(this.burstPos, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(this.burstCol, 3));
    this.burst = new THREE.Points(geo, new THREE.PointsMaterial({
      size: 0.14, vertexColors: true, transparent: true, opacity: 0.95,
    }));
    this.burst.frustumCulled = false;
    this.scene.add(this.burst);
  }

  // Взрыв осколков (ломание блока), color — hex-число
  spawnBurst(x, y, z, color, count = 14, power = 3) {
    const r = ((color >> 16) & 255) / 255, g = ((color >> 8) & 255) / 255, b = (color & 255) / 255;
    for (let n = 0; n < count; n++) {
      const i = this.burstCursor;
      this.burstCursor = (this.burstCursor + 1) % this.burstMax;
      this.burstPos[i * 3] = x + (Math.random() - 0.5) * 0.6;
      this.burstPos[i * 3 + 1] = y + (Math.random() - 0.5) * 0.6;
      this.burstPos[i * 3 + 2] = z + (Math.random() - 0.5) * 0.6;
      this.burstVel[i * 3] = (Math.random() - 0.5) * power;
      this.burstVel[i * 3 + 1] = Math.random() * power * 0.9;
      this.burstVel[i * 3 + 2] = (Math.random() - 0.5) * power;
      this.burstLife[i] = 0.7 + Math.random() * 0.5;
      const j = 0.85 + Math.random() * 0.3;
      this.burstCol[i * 3] = Math.min(1, r * j);
      this.burstCol[i * 3 + 1] = Math.min(1, g * j);
      this.burstCol[i * 3 + 2] = Math.min(1, b * j);
    }
  }

  spawnLavaSpark(x, y, z) {
    this.spawnBurst(x, y + 0.9, z, 0xffa020, 3, 2);
  }

  update(dt, playerPos, rainLevel, desertDust) {
    // дождь
    this.rain.visible = rainLevel > 0.05;
    if (this.rain.visible) {
      this.rain.material.opacity = 0.55 * rainLevel;
      const p = this.rain.geometry.attributes.position;
      const arr = p.array;
      for (let i = 0; i < this.rainCount; i++) {
        arr[i * 3 + 1] -= (18 + (i % 7)) * dt;
        arr[i * 3] += 2.5 * dt; // лёгкий ветер
        if (arr[i * 3 + 1] < playerPos.y - 8) {
          arr[i * 3] = playerPos.x + (Math.random() - 0.5) * 40;
          arr[i * 3 + 1] = playerPos.y + 18 + Math.random() * 14;
          arr[i * 3 + 2] = playerPos.z + (Math.random() - 0.5) * 40;
        }
      }
      p.needsUpdate = true;
    }

    // пыль в пустыне
    this.dust.visible = desertDust > 0.05 && rainLevel < 0.2;
    if (this.dust.visible) {
      this.dust.material.opacity = 0.35 * desertDust;
      const p = this.dust.geometry.attributes.position;
      const arr = p.array;
      for (let i = 0; i < this.dustCount; i++) {
        arr[i * 3] += (3 + (i % 5) * 0.4) * dt;
        arr[i * 3 + 1] += Math.sin(performance.now() * 0.001 + i) * dt * 0.6;
        const dx = arr[i * 3] - playerPos.x;
        if (Math.abs(dx) > 16) {
          arr[i * 3] = playerPos.x - 15;
          arr[i * 3 + 1] = playerPos.y - 1 + Math.random() * 6;
          arr[i * 3 + 2] = playerPos.z + (Math.random() - 0.5) * 30;
        }
      }
      p.needsUpdate = true;
    }

    // осколки
    let any = false;
    for (let i = 0; i < this.burstMax; i++) {
      if (this.burstLife[i] <= 0) {
        this.burstPos[i * 3 + 1] = -1000;
        continue;
      }
      any = true;
      this.burstLife[i] -= dt;
      this.burstVel[i * 3 + 1] -= 9 * dt;
      this.burstPos[i * 3] += this.burstVel[i * 3] * dt;
      this.burstPos[i * 3 + 1] += this.burstVel[i * 3 + 1] * dt;
      this.burstPos[i * 3 + 2] += this.burstVel[i * 3 + 2] * dt;
    }
    this.burst.visible = any;
    if (any) {
      this.burst.geometry.attributes.position.needsUpdate = true;
      this.burst.geometry.attributes.color.needsUpdate = true;
    }
  }

  rebuildForQuality() {
    this.buildRain();
    this.buildDust();
  }
}
