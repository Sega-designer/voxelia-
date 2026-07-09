// Небо: цикл день/ночь, солнце, луна, звёзды, облака, туман и освещение.
import * as THREE from 'three';
import { DAY_LENGTH, Settings, QUALITY, CHUNK, clamp, lerp, smoothstep } from './config.js';
import { mulberry32 } from './noise.js';

const DAY_SKY = new THREE.Color(0x87c5eb);
const NIGHT_SKY = new THREE.Color(0x070b18);
const DUSK_SKY = new THREE.Color(0xe08050);

function makeSunTexture() {
  const cv = document.createElement('canvas');
  cv.width = cv.height = 32;
  const g = cv.getContext('2d');
  g.fillStyle = '#ffd23a'; g.fillRect(4, 4, 24, 24);
  g.fillStyle = '#ffb010'; g.fillRect(4, 4, 24, 3); g.fillRect(4, 25, 24, 3);
  g.fillRect(4, 4, 3, 24); g.fillRect(25, 4, 3, 24);
  g.fillStyle = '#fff2a0'; g.fillRect(10, 10, 12, 12);
  return new THREE.CanvasTexture(cv);
}

function makeMoonTexture() {
  const cv = document.createElement('canvas');
  cv.width = cv.height = 32;
  const g = cv.getContext('2d');
  g.fillStyle = '#dfe6ee'; g.fillRect(6, 6, 20, 20);
  g.fillStyle = '#aab4c2';
  g.fillRect(10, 10, 4, 4); g.fillRect(18, 16, 5, 4); g.fillRect(12, 20, 3, 3);
  return new THREE.CanvasTexture(cv);
}

function makeCloudTexture() {
  const cv = document.createElement('canvas');
  cv.width = cv.height = 256;
  const g = cv.getContext('2d');
  const rnd = mulberry32(555);
  g.clearRect(0, 0, 256, 256);
  g.fillStyle = 'rgba(255,255,255,0.92)';
  for (let i = 0; i < 60; i++) {
    const x = (rnd() * 256) | 0, y = (rnd() * 256) | 0;
    const w = 12 + (rnd() * 34) | 0, h = 6 + (rnd() * 14) | 0;
    g.fillRect(x, y, w, h);
    g.fillRect(x + 4, y - 4, w - 8, h);
  }
  const tex = new THREE.CanvasTexture(cv);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.magFilter = THREE.NearestFilter;
  return tex;
}

export class Sky {
  constructor(scene) {
    this.scene = scene;
    this.time = 0.3; // 0..1; 0.25 — рассвет, 0.5 — полдень, 0.75 — закат

    scene.background = new THREE.Color();
    scene.fog = new THREE.Fog(0x87c5eb, 40, 200);

    this.ambient = new THREE.AmbientLight(0xffffff, 0.6);
    scene.add(this.ambient);

    this.sun = new THREE.DirectionalLight(0xfff4e0, 1.0);
    this.sun.target = new THREE.Object3D();
    scene.add(this.sun);
    scene.add(this.sun.target);

    const spriteMat = (tex) => new THREE.MeshBasicMaterial({
      map: tex, transparent: true, fog: false, depthWrite: false,
    });
    this.sunMesh = new THREE.Mesh(new THREE.PlaneGeometry(60, 60), spriteMat(makeSunTexture()));
    this.moonMesh = new THREE.Mesh(new THREE.PlaneGeometry(40, 40), spriteMat(makeMoonTexture()));
    this.sunMesh.frustumCulled = this.moonMesh.frustumCulled = false;
    scene.add(this.sunMesh, this.moonMesh);

    // звёзды
    const starCount = 500;
    const pos = new Float32Array(starCount * 3);
    const rnd = mulberry32(777);
    for (let i = 0; i < starCount; i++) {
      const theta = rnd() * Math.PI * 2;
      const phi = Math.acos(rnd() * 0.9);
      const r = 480;
      pos[i * 3] = r * Math.sin(phi) * Math.cos(theta);
      pos[i * 3 + 1] = r * Math.cos(phi);
      pos[i * 3 + 2] = r * Math.sin(phi) * Math.sin(theta);
    }
    const starGeo = new THREE.BufferGeometry();
    starGeo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    this.starMat = new THREE.PointsMaterial({ color: 0xffffff, size: 1.6, fog: false, transparent: true, opacity: 0, sizeAttenuation: false });
    this.stars = new THREE.Points(starGeo, this.starMat);
    this.stars.frustumCulled = false;
    scene.add(this.stars);

    // облака
    this.cloudTex = makeCloudTexture();
    this.cloudMat = new THREE.MeshBasicMaterial({
      map: this.cloudTex, transparent: true, opacity: 0.75, fog: false,
      depthWrite: false, side: THREE.DoubleSide,
    });
    this.clouds = new THREE.Mesh(new THREE.PlaneGeometry(900, 900), this.cloudMat);
    this.clouds.rotation.x = -Math.PI / 2;
    this.clouds.position.y = 96;
    this.cloudTex.repeat.set(3, 3);
    scene.add(this.clouds);
    this.cloudDrift = 0;

    this.daylight = 1;
    this._c = new THREE.Color();
    this._tint = new THREE.Color();
  }

  applyShadowSettings(renderer) {
    renderer.shadowMap.enabled = Settings.shadows;
    renderer.shadowMap.type = THREE.PCFShadowMap;
    this.sun.castShadow = Settings.shadows;
    if (Settings.shadows) {
      const size = QUALITY[Settings.quality].shadowSize;
      this.sun.shadow.mapSize.set(size, size);
      const s = 70;
      this.sun.shadow.camera.left = -s; this.sun.shadow.camera.right = s;
      this.sun.shadow.camera.top = s; this.sun.shadow.camera.bottom = -s;
      this.sun.shadow.camera.near = 1; this.sun.shadow.camera.far = 400;
      this.sun.shadow.bias = -0.0005;
      if (this.sun.shadow.map) { this.sun.shadow.map.dispose(); this.sun.shadow.map = null; }
    }
  }

  // weather: { rain, fogFactor, darkness, flash }, tint: THREE.Color|null — биомная атмосфера
  update(dt, camPos, weather, tint) {
    this.time = (this.time + dt / DAY_LENGTH) % 1;
    const ang = this.time * Math.PI * 2 - Math.PI / 2; // 0.25 → восход
    const sunY = Math.sin(ang);
    const daylight = smoothstep(-0.06, 0.22, sunY);
    this.daylight = daylight;
    const duskFactor = clamp(1 - Math.abs(sunY) * 5, 0, 1) * daylight;

    // цвет неба
    this._c.copy(NIGHT_SKY).lerp(DAY_SKY, daylight).lerp(DUSK_SKY, duskFactor * 0.55);
    const dark = 1 - weather.darkness * 0.55;
    this._c.multiplyScalar(dark);
    if (tint) this._c.lerp(tint, 0.22);
    // вспышка молнии
    if (weather.flash > 0) this._c.lerp(new THREE.Color(0xffffff), weather.flash * 0.7);
    this.scene.background.copy(this._c);

    // туман
    const far = Settings.renderDistance * CHUNK * (1 - weather.fogFactor * 0.62);
    this.scene.fog.color.copy(this._c);
    this.scene.fog.near = Math.max(8, far * 0.3);
    this.scene.fog.far = Math.max(20, far);

    // освещение
    this.sun.intensity = daylight * 1.15 * (1 - weather.darkness * 0.55) + weather.flash * 1.5;
    this.ambient.intensity = 0.22 + daylight * 0.55 * (1 - weather.darkness * 0.4) + weather.flash;
    this.sun.color.setHSL(0.12, duskFactor * 0.6 + 0.15, 0.9);

    // положение солнца/луны относительно камеры
    const sunDir = new THREE.Vector3(Math.cos(ang), sunY, 0.25).normalize();
    this.sunMesh.position.copy(camPos).addScaledVector(sunDir, 420);
    this.sunMesh.lookAt(camPos);
    this.moonMesh.position.copy(camPos).addScaledVector(sunDir, -420);
    this.moonMesh.lookAt(camPos);
    this.sun.position.copy(camPos).addScaledVector(sunDir, 120);
    this.sun.target.position.copy(camPos);

    // звёзды
    this.starMat.opacity = (1 - daylight) * (1 - weather.darkness * 0.8);
    this.stars.position.set(camPos.x, 0, camPos.z);
    this.stars.rotation.y += dt * 0.005;

    // облака: дрейф + привязка к миру
    this.cloudDrift += dt * 0.8;
    this.clouds.position.x = camPos.x;
    this.clouds.position.z = camPos.z;
    this.cloudTex.offset.set(
      (camPos.x + this.cloudDrift * 4) / 300,
      -(camPos.z + this.cloudDrift) / 300
    );
    this.cloudMat.opacity = lerp(0.55, 0.95, weather.darkness) * clamp(daylight + 0.25, 0, 1);
  }
}
