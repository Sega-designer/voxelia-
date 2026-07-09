// Игрок: AABB-физика по вокселям, плавание, лава, урон, камеры (1-е/3-е лицо).
import * as THREE from 'three';
import { B, BLOCKS } from '../blocks.js';
import { dropGeometry } from '../items.js';
import { Binds } from '../keybinds.js';
import { Settings, clamp, lerp } from '../config.js';

const HALF_W = 0.3;      // половина ширины
const HEIGHT = 1.8;      // высота
const EYE = 1.62;        // высота глаз
const GRAVITY = 24;
const JUMP_V = 8.2;
const WALK = 4.3, SPRINT = 6.2, CROUCH = 1.6, SWIM = 3.2;

export class Player {
  constructor(world, camera, scene, audio, materials = null) {
    this.world = world;
    this.camera = camera;
    this.audio = audio;
    this.god = false;       // творческий режим: бессмертие
    this.flying = false;    // полёт (двойной пробел в творческом)
    this.swingT = 0;        // анимация замаха руки
    this.heldId = undefined;
    this.pos = new THREE.Vector3(8, 50, 8);   // позиция ног
    this.vel = new THREE.Vector3();
    this.yaw = 0; this.pitch = 0;
    this.onGround = false;
    this.inWater = false;       // тело в воде
    this.eyeInWater = false;    // глаза под водой
    this.inLava = false;
    this.camMode = 0;           // 0 — от 1-го лица, 1 — сзади, 2 — спереди
    this.health = 10;
    this.maxHealth = 10;
    this.dead = false;
    this.spawn = new THREE.Vector3(8, 50, 8);
    this.damageTimer = 0;       // время с последнего урона (для регенерации)
    this.lavaTick = 0;
    this.breathTimer = 0;
    this.stepDist = 0;
    this.walkPhase = 0;
    this.prevVy = 0;
    this.onDamage = null;       // колбэк для UI

    this.model = this.buildModel();
    this.model.visible = false;
    scene.add(this.model);

    if (materials) this.buildHand(materials);
  }

  // Рука от первого лица: рукав + кисть, в кисти — выбранный блок (если есть)
  buildHand(materials) {
    this.handGroup = new THREE.Group();
    this.camera.add(this.handGroup);
    const mkMat = (c) => {
      const m = new THREE.MeshLambertMaterial({ color: c });
      m.depthTest = false;
      return m;
    };
    // предплечье (кожа) и зелёный рукав — в цветах скина игрока
    const arm = new THREE.Mesh(new THREE.BoxGeometry(0.13, 0.13, 0.42), mkMat(0xd9a066));
    arm.position.set(0, -0.02, 0.14);
    arm.renderOrder = 101;
    const sleeve = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.16, 0.2), mkMat(0x3fa163));
    sleeve.position.set(0, -0.02, 0.32);
    sleeve.renderOrder = 102;
    this.handGroup.add(arm, sleeve);

    this.heldMat = new THREE.MeshLambertMaterial({ map: materials.atlasTexture, alphaTest: 0.4 });
    this.heldMat.depthTest = false;
    this.heldMesh = new THREE.Mesh(dropGeometry(B.GRASS), this.heldMat);
    this.heldMesh.scale.setScalar(1.3);
    this.heldMesh.position.set(-0.02, 0.09, -0.12);
    this.heldMesh.rotation.set(0.15, 0.65, 0);
    this.heldMesh.renderOrder = 100;
    this.heldMesh.visible = false;
    this.handGroup.add(this.heldMesh);

    this.handGroup.visible = false;
  }

  triggerSwing() { this.swingT = 0.3; }

  updateHand(dt, selectedId) {
    if (!this.handGroup) return;
    this.handGroup.visible = this.camMode === 0 && !this.dead;
    if (!this.handGroup.visible) return;

    if (selectedId !== this.heldId) {
      this.heldId = selectedId;
      if (selectedId != null) this.heldMesh.geometry = dropGeometry(selectedId);
      this.heldMesh.visible = selectedId != null;
    }

    this.swingT = Math.max(0, this.swingT - dt);
    const swing = Math.sin((this.swingT / 0.3) * Math.PI);
    const hSpeed = Math.hypot(this.vel.x, this.vel.z);
    const bobA = Math.min(1, hSpeed / 4) * (this.onGround ? 1 : 0.2);
    const t = this.walkPhase * 2;

    this.handGroup.position.set(
      0.42 + Math.cos(t) * 0.014 * bobA,
      -0.42 + Math.abs(Math.sin(t)) * 0.022 * bobA - swing * 0.1,
      -0.68 - swing * 0.12
    );
    this.handGroup.rotation.set(-swing * 0.9, -0.28 + swing * 0.3, 0);
  }

  // Персонаж по скину игрока: зелёная кепка с уточкой, очки, щетина, сине-зелёная броня.
  buildModel() {
    const g = new THREE.Group();

    const SKIN = '#d9a066', STUBBLE = 'rgba(110,75,40,0.6)', HAIR = '#d9c06a', HAIR_D = '#b89c4e';
    const BLUE = '#2b4a9c', BLUE_D = '#223a7a', GREEN = '#3fa163', GREEN_D = '#2c7a49';
    const CAP = '#2f8f5b', CAP_D = '#257247', GLOW = '#7dffb0', BOOT = '#1e5c38', BLACK = '#12161c';

    // material с пиксельной canvas-текстурой 16×16
    const tex = (draw) => {
      const cv = document.createElement('canvas');
      cv.width = cv.height = 16;
      const c = cv.getContext('2d');
      draw(c);
      const t = new THREE.CanvasTexture(cv);
      t.magFilter = THREE.NearestFilter;
      t.minFilter = THREE.NearestFilter;
      t.colorSpace = THREE.SRGBColorSpace;
      return new THREE.MeshLambertMaterial({ map: t });
    };
    const solid = (color) => tex((c) => { c.fillStyle = color; c.fillRect(0, 0, 16, 16); });
    const base = (c, color) => { c.fillStyle = color; c.fillRect(0, 0, 16, 16); };
    const px = (c, x, y, w, h, color) => { c.fillStyle = color; c.fillRect(x, y, w, h); };

    // --- голова: [+x, -x, +y, -y, +z(лицо), -z(затылок)] ---
    const headSide = (backAt) => tex((c) => {
      base(c, SKIN);
      px(c, 0, 0, 16, 4, HAIR);                 // волосы под кепкой
      px(c, backAt, 4, 6, 5, HAIR);             // затылочная прядь
      px(c, 0, 6, 16, 2, BLACK);                // дужка очков
      px(c, 2, 12, 12, 3, STUBBLE);             // щетина
    });
    const headFace = tex((c) => {
      base(c, SKIN);
      px(c, 0, 0, 16, 3, HAIR);
      // очки
      px(c, 0, 5, 16, 1, BLACK);
      px(c, 1, 5, 6, 4, BLACK); px(c, 9, 5, 6, 4, BLACK);
      px(c, 2, 6, 4, 2, '#b8c8d4'); px(c, 10, 6, 4, 2, '#b8c8d4');
      px(c, 3, 6, 1, 1, '#e8f2f8'); px(c, 11, 6, 1, 1, '#e8f2f8'); // блик
      // нос и рот
      px(c, 7, 9, 2, 2, '#c88f56');
      px(c, 6, 12, 4, 1, '#a06a3a');
      // щетина
      for (let i = 0; i < 14; i++) px(c, 1 + ((i * 7) % 14), 12 + (i % 3), 1, 1, STUBBLE);
    });
    const headBack = tex((c) => {
      base(c, SKIN);
      px(c, 0, 0, 16, 10, HAIR);
      for (let i = 0; i < 8; i++) px(c, i * 2, 2 + (i % 3), 1, 7, HAIR_D); // пряди
    });
    const head = new THREE.Mesh(new THREE.BoxGeometry(0.45, 0.45, 0.45), [
      headSide(10), headSide(0), solid(HAIR), solid(SKIN), headFace, headBack,
    ]);
    head.position.y = 1.575;
    g.add(head); this.head = head;

    // --- кепка с уточкой (крепится к голове, чтобы кивала вместе с ней) ---
    const capStripes = (c) => {
      base(c, CAP);
      for (let x = 1; x < 16; x += 3) px(c, x, 0, 1, 16, CAP_D);
    };
    const capFront = tex((c) => {
      capStripes(c);
      // уточка
      px(c, 6, 8, 5, 3, '#e8a020');   // тело
      px(c, 9, 5, 3, 3, '#e8a020');   // голова
      px(c, 12, 6, 2, 1, '#c87010');  // клюв
      px(c, 10, 6, 1, 1, '#3a2a10');  // глаз
      px(c, 7, 9, 2, 1, '#c87010');   // крыло
    });
    const capSide = tex(capStripes);
    const cap = new THREE.Mesh(new THREE.BoxGeometry(0.52, 0.18, 0.52), [
      capSide, capSide, capSide, capSide, capFront, capSide,
    ]);
    cap.position.y = 0.27; // относительно центра головы
    head.add(cap);
    const visor = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.05, 0.24), solid(CAP_D));
    visor.position.set(0, 0.2, 0.34);
    head.add(visor);

    // --- торс: броня с эмблемой ---
    const torsoFront = tex((c) => {
      base(c, BLUE);
      px(c, 0, 0, 4, 5, GREEN); px(c, 12, 0, 4, 5, GREEN);     // наплечники
      px(c, 0, 4, 4, 1, GREEN_D); px(c, 12, 4, 4, 1, GREEN_D);
      px(c, 2, 9, 12, 7, GREEN_D);                              // пластины пресса
      px(c, 3, 10, 4, 2, GREEN); px(c, 9, 10, 4, 2, GREEN);
      px(c, 3, 13, 4, 2, GREEN); px(c, 9, 13, 4, 2, GREEN);
      // светящаяся эмблема
      px(c, 5, 2, 6, 1, GLOW); px(c, 9, 3, 2, 1, GLOW);
      px(c, 7, 4, 2, 3, GLOW); px(c, 5, 5, 1, 2, GLOW);
    });
    const torsoBack = tex((c) => {
      base(c, BLUE);
      px(c, 1, 1, 6, 10, GREEN); px(c, 9, 1, 6, 10, GREEN);    // спинные пластины
      px(c, 2, 2, 4, 8, GREEN_D); px(c, 10, 2, 4, 8, GREEN_D);
      px(c, 6, 12, 4, 3, GREEN);                                // пояс
    });
    const torsoSide = solid(BLUE_D);
    const body = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.65, 0.26), [
      torsoSide, torsoSide, torsoSide, torsoSide, torsoFront, torsoBack,
    ]);
    body.position.y = 1.02;
    g.add(body);

    // --- конечности ---
    const armMat = tex((c) => {
      base(c, BLUE);
      px(c, 0, 0, 16, 6, GREEN);      // наплечник
      px(c, 0, 6, 16, 1, GREEN_D);
      px(c, 0, 9, 16, 2, GREEN_D);    // налокотник
      px(c, 0, 13, 16, 3, SKIN);      // кисть
    });
    const legMat = tex((c) => {
      base(c, BLUE);
      px(c, 0, 6, 16, 3, GREEN);      // наколенник
      px(c, 0, 8, 16, 1, GREEN_D);
      px(c, 0, 13, 16, 3, BOOT);      // ботинок
    });

    const mkLimb = (w, h, d, mat, x, y) => {
      const pivot = new THREE.Group();
      pivot.position.set(x, y, 0);
      const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
      m.position.y = -h / 2;
      pivot.add(m);
      g.add(pivot);
      return pivot;
    };
    this.armL = mkLimb(0.2, 0.62, 0.2, armMat, -0.36, 1.32);
    this.armR = mkLimb(0.2, 0.62, 0.2, armMat.clone(), 0.36, 1.32);
    this.legL = mkLimb(0.22, 0.7, 0.22, legMat, -0.13, 0.7);
    this.legR = mkLimb(0.22, 0.7, 0.22, legMat.clone(), 0.13, 0.7);
    return g;
  }

  respawn() {
    this.pos.copy(this.spawn);
    this.vel.set(0, 0, 0);
    this.health = this.maxHealth;
    this.dead = false;
    this.breathTimer = 0;
  }

  damage(n) {
    if (this.dead || this.god) return;
    this.health -= n;
    this.damageTimer = 0;
    if (this.onDamage) this.onDamage();
    if (this.health <= 0) { this.health = 0; this.dead = true; }
  }

  aabbOverlapsBlock(bx, by, bz) {
    return bx + 1 > this.pos.x - HALF_W && bx < this.pos.x + HALF_W &&
           by + 1 > this.pos.y && by < this.pos.y + HEIGHT &&
           bz + 1 > this.pos.z - HALF_W && bz < this.pos.z + HALF_W;
  }

  collideAxis(axis, delta) {
    if (delta === 0) return;
    this.pos.setComponent(axis, this.pos.getComponent(axis) + delta);
    const minX = Math.floor(this.pos.x - HALF_W), maxX = Math.floor(this.pos.x + HALF_W);
    const minY = Math.floor(this.pos.y), maxY = Math.floor(this.pos.y + HEIGHT - 0.001);
    const minZ = Math.floor(this.pos.z - HALF_W), maxZ = Math.floor(this.pos.z + HALF_W);

    for (let y = minY; y <= maxY; y++) for (let z = minZ; z <= maxZ; z++) for (let x = minX; x <= maxX; x++) {
      if (!this.world.isSolid(x, y, z)) continue;
      if (axis === 0) {
        this.pos.x = delta > 0 ? x - HALF_W - 0.001 : x + 1 + HALF_W + 0.001;
        this.vel.x = 0;
      } else if (axis === 1) {
        if (delta > 0) { this.pos.y = y - HEIGHT - 0.001; }
        else { this.pos.y = y + 1 + 0.001; this.onGround = true; }
        this.vel.y = 0;
      } else {
        this.pos.z = delta > 0 ? z - HALF_W - 0.001 : z + 1 + HALF_W + 0.001;
        this.vel.z = 0;
      }
      return;
    }
  }

  blockAt(dy) {
    return this.world.getBlock(Math.floor(this.pos.x), Math.floor(this.pos.y + dy), Math.floor(this.pos.z));
  }

  update(dt, input) {
    if (this.dead) return;
    this.prevVy = this.vel.y;

    // --- среда ---
    const bodyBlock = this.blockAt(0.4);
    const eyeBlock = this.blockAt(EYE);
    this.inWater = bodyBlock === B.WATER || eyeBlock === B.WATER;
    this.eyeInWater = eyeBlock === B.WATER;
    this.inLava = bodyBlock === B.LAVA || this.blockAt(0.05) === B.LAVA;

    // --- желаемое движение ---
    const f = input.keys;
    let mx = 0, mz = 0;
    if (f.has(Binds.forward)) mz -= 1;
    if (f.has(Binds.back)) mz += 1;
    if (f.has(Binds.left)) mx -= 1;
    if (f.has(Binds.right)) mx += 1;
    const down = f.has(Binds.crouch);
    const crouch = down && !this.flying;
    const sprint = f.has(Binds.sprint) && !crouch && mz < 0;
    let speed = this.flying ? (f.has(Binds.sprint) ? 13 : 8.5)
      : this.inWater ? SWIM : crouch ? CROUCH : sprint ? SPRINT : WALK;

    // поворот вектора (mx, mz) на угол yaw: вперёд = (-sin, -cos), вправо = (cos, -sin)
    const sin = Math.sin(this.yaw), cos = Math.cos(this.yaw);
    let wishX = 0, wishZ = 0;
    if (mx !== 0 || mz !== 0) {
      const len = Math.hypot(mx, mz);
      mx /= len; mz /= len;
      wishX = (mx * cos + mz * sin) * speed;
      wishZ = (mz * cos - mx * sin) * speed;
    }

    // ускорение/инерция: на земле резче, в воздухе плавнее
    const accel = this.flying ? 8 : this.inWater ? 4 : this.onGround ? 12 : 3.5;
    const k = 1 - Math.exp(-accel * dt);
    this.vel.x = lerp(this.vel.x, wishX, k);
    this.vel.z = lerp(this.vel.z, wishZ, k);

    // --- вертикаль ---
    if (this.flying) {
      const wishY = f.has(Binds.jump) ? 7.5 : down ? -7.5 : 0;
      this.vel.y = lerp(this.vel.y, wishY, 1 - Math.exp(-10 * dt));
    } else if (this.inWater) {
      this.vel.y -= 5 * dt;                       // слабая гравитация
      this.vel.y *= 1 - Math.min(1, 2.2 * dt);    // сопротивление воды
      if (f.has(Binds.jump)) this.vel.y = lerp(this.vel.y, 4.0, 1 - Math.exp(-6 * dt));
      if (crouch) this.vel.y = lerp(this.vel.y, -3.0, 1 - Math.exp(-6 * dt));
    } else {
      this.vel.y -= GRAVITY * dt;
      if (f.has(Binds.jump) && this.onGround) {
        this.vel.y = JUMP_V;
        this.onGround = false;
        this.audio.jump();
      }
    }
    if (this.inLava) {
      this.vel.x *= 0.7; this.vel.z *= 0.7;
      this.vel.y = clamp(this.vel.y, -2, 2);
      if (f.has(Binds.jump)) this.vel.y = 2.5;
    }
    this.vel.y = clamp(this.vel.y, -42, 42);

    // --- интеграция с коллизиями по осям ---
    const wasGround = this.onGround;
    this.onGround = false;
    const step = Math.min(dt, 0.05);
    let remaining = dt;
    while (remaining > 0) {
      const h = Math.min(step, remaining);
      this.collideAxis(1, this.vel.y * h);
      this.collideAxis(0, this.vel.x * h);
      this.collideAxis(2, this.vel.z * h);
      remaining -= h;
    }

    // приземление: звук и урон от падения; касание земли выключает полёт
    if (this.flying && this.onGround) this.flying = false;
    if (!wasGround && this.onGround) {
      const impact = -this.prevVy;
      if (impact > 4) this.audio.land();
      if (impact > 13 && !this.inWater) this.damage(Math.floor((impact - 12) * 0.5) + 1);
      if (this.inWater || this.blockAt(-0.5) === B.WATER) this.audio.splash();
    }

    // --- урон ---
    this.damageTimer += dt;
    if (this.inLava) {
      this.lavaTick += dt;
      if (this.lavaTick > 0.5) { this.lavaTick = 0; this.damage(2); }
    } else this.lavaTick = 0.5;

    if (this.eyeInWater) {
      this.breathTimer += dt;
      if (this.breathTimer > 15 && this.breathTimer % 1 < dt) this.damage(1);
    } else this.breathTimer = 0;

    // регенерация
    if (this.damageTimer > 6 && this.health < this.maxHealth) {
      this.damageTimer = 4.5;
      this.health = Math.min(this.maxHealth, this.health + 1);
    }

    // --- шаги ---
    const hSpeed = Math.hypot(this.vel.x, this.vel.z);
    if (this.onGround && hSpeed > 0.5) {
      this.stepDist += hSpeed * dt;
      if (this.stepDist > 2.1) {
        this.stepDist = 0;
        const under = this.world.getBlock(Math.floor(this.pos.x), Math.floor(this.pos.y - 0.5), Math.floor(this.pos.z));
        const def = BLOCKS[under];
        if (def && def.sound) this.audio.step(def.sound);
      }
    }
    this.walkPhase += hSpeed * dt * 2.2;

    // --- камера ---
    this.updateCamera(crouch);
    this.updateModel(hSpeed, crouch);

    if (this.pos.y < -10) this.damage(100); // упал за пределы мира
  }

  getEye() {
    return new THREE.Vector3(this.pos.x, this.pos.y + EYE, this.pos.z);
  }

  getLookDir() {
    return new THREE.Vector3(
      -Math.sin(this.yaw) * Math.cos(this.pitch),
      Math.sin(this.pitch),
      -Math.cos(this.yaw) * Math.cos(this.pitch)
    );
  }

  updateCamera(crouch) {
    const eye = this.getEye();
    if (crouch) eye.y -= 0.15;
    const dir = this.getLookDir();

    if (this.camMode === 0) {
      this.camera.position.copy(eye);
      this.camera.rotation.set(0, 0, 0, 'YXZ');
      this.camera.rotation.order = 'YXZ';
      this.camera.rotation.y = this.yaw;
      this.camera.rotation.x = this.pitch;
    } else {
      const back = this.camMode === 1 ? dir.clone().negate() : dir.clone();
      const desired = 4;
      // камера не должна проходить сквозь блоки
      const hit = this.world.raycast(eye, back, desired, true);
      const dist = hit ? Math.max(0.4, hit.dist - 0.3) : desired;
      this.camera.position.copy(eye).addScaledVector(back, dist);
      this.camera.lookAt(eye);
    }
  }

  updateModel(hSpeed, crouch) {
    this.model.visible = this.camMode !== 0;
    if (!this.model.visible) return;
    this.model.position.copy(this.pos);
    this.model.rotation.y = this.yaw + Math.PI;
    this.head.rotation.x = -this.pitch;
    const swing = Math.sin(this.walkPhase) * Math.min(1, hSpeed / WALK) * 0.7;
    this.armL.rotation.x = swing;
    this.armR.rotation.x = -swing;
    this.legL.rotation.x = -swing;
    this.legR.rotation.x = swing;
    this.model.scale.y = crouch ? 0.92 : 1;
  }

  // Проверка перед установкой блока: не ставим внутрь собственного тела
  intersectsBlock(bx, by, bz) {
    return this.aabbOverlapsBlock(bx, by, bz);
  }
}
