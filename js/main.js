// Вокселия — точка входа: рендер, состояния игры, взаимодействие с миром.
import * as THREE from 'three';
import { Settings, QUALITY, loadSettings, clamp } from './config.js';
import { strToSeed, mulberry32 } from './noise.js';
import { B, BLOCKS, createMaterials } from './blocks.js';
import { World } from './world/world.js';
import { BIOME, BIOME_NAMES } from './world/worldgen.js';
import { Player } from './player/player.js';
import { Input } from './player/input.js';
import { Sky } from './sky.js';
import { Weather, WEATHER_NAMES } from './weather.js';
import { Particles } from './particles.js';
import { AudioSys } from './audio.js';
import { UI } from './ui.js';
import { SaveSys } from './save.js';
import { Drops, Debris } from './items.js';
import { Animals } from './animals.js';
import { Mobs } from './mobs.js';
import { Net, RemotePlayers, RemoteEntities, KIND_IDX } from './net.js';
import { Binds, loadBinds } from './keybinds.js';

loadSettings();
loadBinds();

// ---------- базовая сцена ----------
const canvas = document.getElementById('game-canvas');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: false });
renderer.setSize(window.innerWidth, window.innerHeight);
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1400);
scene.add(camera); // нужно, чтобы рендерились дети камеры (рука от первого лица)

const materials = createMaterials();
const audio = new AudioSys();
const sky = new Sky(scene);
const weather = new Weather(audio);
const particles = new Particles(scene);
const input = new Input(canvas);

// подсветка от лавы рядом с игроком
const lavaLight = new THREE.PointLight(0xff7020, 0, 14);
scene.add(lavaLight);

// рамка выделенного блока
const highlight = new THREE.LineSegments(
  new THREE.EdgesGeometry(new THREE.BoxGeometry(1.002, 1.002, 1.002)),
  new THREE.LineBasicMaterial({ color: 0x111111, transparent: true, opacity: 0.7 })
);
highlight.visible = false;
scene.add(highlight);

// ---------- анимация разлома: 5 стадий трещин ----------
function makeCrackMaterials() {
  const mats = [];
  for (let s = 0; s < 5; s++) {
    const cv = document.createElement('canvas');
    cv.width = cv.height = 16;
    const g = cv.getContext('2d');
    const rnd = mulberry32(4242); // один и тот же узор, растущий со стадией
    g.strokeStyle = 'rgba(12, 8, 4, 0.9)';
    g.lineWidth = 1;
    const branches = 3 + s * 2;
    for (let b = 0; b < branches; b++) {
      let x = 8 + (rnd() - 0.5) * 3, y = 8 + (rnd() - 0.5) * 3;
      g.beginPath();
      g.moveTo(x, y);
      for (let i = 0; i < 3 + s; i++) {
        x += (rnd() - 0.5) * 9;
        y += (rnd() - 0.5) * 9;
        g.lineTo(x, y);
      }
      g.stroke();
    }
    const tex = new THREE.CanvasTexture(cv);
    tex.magFilter = THREE.NearestFilter;
    tex.minFilter = THREE.NearestFilter;
    mats.push(new THREE.MeshBasicMaterial({
      map: tex, transparent: true, depthWrite: false,
      polygonOffset: true, polygonOffsetFactor: -2,
    }));
  }
  return mats;
}
const crackMats = makeCrackMaterials();
const crackMesh = new THREE.Mesh(new THREE.BoxGeometry(1.004, 1.004, 1.004), crackMats[0]);
crackMesh.visible = false;
crackMesh.renderOrder = 2;
scene.add(crackMesh);

// ---------- состояние ----------
let state = 'menu'; // menu | loading | ready | playing | inventory | paused | dead
let world = null;
let player = null;
let drops = null;
let debris = null;
let animals = null;
let mobs = null;
let lastSpaceTime = 0; // для двойного пробела (полёт)

// --- сеть ---
const net = new Net();
let remotePlayers = null;
let remoteEnts = null;
let posTimer = 0, snapTimer = 0, syncTimer = 0;
let guestSession = false; // гость не перезаписывает своё локальное сохранение
const isGuest = () => net.active && !net.isHost;
const isSimHost = () => !net.active || net.isHost; // кто считает мобов/дропы
let gameMode = 'survival';      // режим текущей игры
let newWorldMode = 'survival';  // выбранный режим для нового мира
let menuAngle = 0;
let debugOn = false;
let saveTimer = 0;
let biomeCheckTimer = 0;
let currentBiome = BIOME.PLAINS;
let desertDust = 0;
let jungleFog = 0;
const biomeTint = new THREE.Color();
let tintAmount = 0;

// разрушение блоков и бой
let breakTarget = null;
let breakProgress = 0;
let placeCooldown = 0;
let attackCooldown = 0;
let eatCooldown = 0;
let startedFromSave = false;

// что выпадает из блока при разломе (по умолчанию — сам блок)
const DROP_MAP = { [B.GRASS]: B.DIRT };

// мир для фона меню
let menuWorld = new World(scene, materials, (Math.random() * 1e9) | 0);

// ---------- UI ----------
const ui = new UI({
  hasSave: () => SaveSys.hasSave(),
  onUiClick: () => { audio.init(); audio.uiClick(); },
  onContinue: () => { const s = SaveSys.load(); if (s) startGame(s.seed, s); },
  onNewWorld: (seedStr) => {
    SaveSys.clear();
    const seed = seedStr ? (isNaN(+seedStr) ? strToSeed(seedStr) : (+seedStr | 0)) : (Math.random() * 1e9) | 0;
    startGame(seed, null);
  },
  onModeToggleMenu: () => {
    newWorldMode = newWorldMode === 'survival' ? 'creative' : 'survival';
    ui.setMenuModeLabel(newWorldMode);
  },
  onHostNew: () => hostRoom(null),
  onHostContinue: () => hostRoom(SaveSys.load()),
  onJoin: (code) => joinRoom(code),
  onModeSwitch: () => {
    setGameMode(gameMode === 'survival' ? 'creative' : 'survival');
    saveGame();
  },
  onTossItem: (id, count) => tossItem(id, count),
  onResume: () => input.requestLock(),
  onExit: () => exitToMenu(),
  onRespawn: () => {
    player.respawn();
    ui.setHealth(player.health, player.maxHealth);
    state = 'ready';
    ui.show('click-to-play');
  },
  onSettingsChanged: () => applySettings(),
  onCanvasClick: () => { audio.init(); input.requestLock(); },
});
ui.setMenuModeLabel(newWorldMode);

function applySettings() {
  renderer.setPixelRatio(QUALITY[Settings.quality].pixelRatio);
  audio.setVolume(Settings.volume);
  sky.applyShadowSettings(renderer);
  if (world) world.setShadows(Settings.shadows);
  if (menuWorld) menuWorld.setShadows(Settings.shadows);
  materials.opaque.needsUpdate = true;
  materials.cutout.needsUpdate = true;
  particles.rebuildForQuality();
}
applySettings();

function setGameMode(mode) {
  gameMode = mode;
  ui.setMode(mode);
  if (player) {
    player.god = mode === 'creative';
    if (!player.god) player.flying = false;
  }
}

// ---------- сетевая игра ----------
function setupNetHandlers() {
  net.onMessage = handleNet;
  net.onPeerJoin = () => ui.setRoomInfo(net.roomCode, net.playerCount());
  net.onPeerLeave = (conn) => {
    if (remotePlayers) remotePlayers.remove(conn.peer);
    ui.setRoomInfo(net.roomCode, net.playerCount());
  };
  net.onClosed = () => onHostLost();
}

function hostRoom(save) {
  audio.init();
  ui.setMpStatus('Создание комнаты…');
  setupNetHandlers();
  net.host((err, code) => {
    if (err) {
      ui.setMpStatus('Ошибка соединения: ' + (err.type || err.message || err));
      return;
    }
    ui.setRoomInfo(code, 1);
    if (save) startGame(save.seed, save);
    else { SaveSys.clear(); startGame((Math.random() * 1e9) | 0, null); }
  });
}

function joinRoom(code) {
  audio.init();
  ui.setMpStatus('Подключение к комнате ' + code.toUpperCase() + '…');
  setupNetHandlers();
  net.join(code, (err) => {
    if (err) {
      ui.setMpStatus(err.type === 'peer-unavailable'
        ? 'Комната не найдена. Проверь код.'
        : 'Не удалось подключиться: ' + (err.type || err.message || err));
      net.close();
      return;
    }
    ui.setMpStatus('Получение мира…');
    net.send({ t: 'hello' });
  });
}

function onHostLost() {
  if (!net.active && state === 'menu') return;
  net.close();
  exitToMenu();
  ui.show('mp-menu');
  ui.setMpStatus('Соединение с хостом потеряно');
}

function netTargets() {
  const list = [{ isLocal: true, pos: player.pos, god: player.god, dead: player.dead }];
  if (net.active && net.isHost && remotePlayers) {
    for (const rp of remotePlayers.map.values()) {
      const conn = net.conns.find((c) => c.peer === rp.id);
      list.push({ id: rp.id, conn, pos: rp.pos, god: rp.god, dead: rp.dead });
    }
  }
  return list;
}

function onPickupTarget(tg, id, count) {
  if (tg.isLocal) return ui.addItem(id, count);
  if (tg.conn) net.send({ t: 'give', id, count }, tg.conn);
  return count;
}

function onMobHit(tg, dmg, dir) {
  if (tg.isLocal) {
    player.damage(dmg);
    player.vel.x += dir.x * 5;
    player.vel.z += dir.z * 5;
    player.vel.y = Math.max(player.vel.y, 3.5);
  } else if (tg.conn) {
    net.send({ t: 'damage', dmg, dx: dir.x, dz: dir.z }, tg.conn);
  }
}

function buildSnapshot() {
  const c = [];
  const pack = (a) => c.push([
    a.eid, KIND_IDX[a.type],
    +a.pos.x.toFixed(2), +a.pos.y.toFixed(2), +a.pos.z.toFixed(2),
    +a.yaw.toFixed(2), a.flashT > 0 ? 1 : 0,
  ]);
  for (const a of animals.list) pack(a);
  for (const a of mobs.list) pack(a);
  const d = [];
  for (const dr of drops.list) {
    const p = dr.mesh.position;
    d.push([dr.eid, dr.id, +p.x.toFixed(2), +p.y.toFixed(2), +p.z.toFixed(2)]);
  }
  return { t: 'ents', c, d };
}

function handleNet(msg, conn) {
  switch (msg.t) {
    case 'hello': { // хост отдаёт мир новому игроку
      if (!net.isHost || !world || !player) return;
      net.send({
        t: 'welcome',
        seed: world.seed,
        modified: world.getModifiedForSave(),
        time: sky.time,
        mode: gameMode,
        wt: weather.type,
        hx: player.pos.x, hy: player.pos.y, hz: player.pos.z,
      }, conn);
      ui.setRoomInfo(net.roomCode, net.playerCount());
      break;
    }
    case 'welcome': { // гость получает мир
      if (net.isHost) return;
      weather.type = msg.wt;
      startGame(msg.seed, {
        guest: true,
        seed: msg.seed,
        modified: msg.modified,
        time: msg.time,
        mode: msg.mode,
        player: { x: msg.hx, y: msg.hy, z: msg.hz, yaw: 0, pitch: 0, health: 10 },
      });
      ui.setRoomInfo(net.roomCode, net.playerCount());
      break;
    }
    case 'pos': {
      const id = net.isHost ? conn.peer : msg.id;
      if (id && remotePlayers) remotePlayers.upsert(id, msg);
      if (net.isHost) { msg.id = conn.peer; net.relayExcept(msg, conn); }
      break;
    }
    case 'sb': { // правка блока
      if (!world) return;
      world.setBlock(msg.x, msg.y, msg.z, msg.id);
      if (net.isHost) {
        net.relayExcept(msg, conn);
        if (msg.drop != null && drops) {
          drops.spawn(msg.x + 0.5, msg.y + 0.4, msg.z + 0.5, msg.drop, 1);
        }
      }
      break;
    }
    case 'ents': if (remoteEnts) remoteEnts.applySnapshot(msg); break;
    case 'attack': { // гость ударил существо
      if (!net.isHost) return;
      const dir = new THREE.Vector3(msg.dx, 0, msg.dz).normalize();
      let a = animals.list.find((x) => x.eid === msg.eid);
      if (a) { animals.hit(a, 1, dir, onAnimalDrop); break; }
      a = mobs.list.find((x) => x.eid === msg.eid);
      if (a) mobs.hit(a, 1, dir, onAnimalDrop);
      break;
    }
    case 'give': ui.addItem(msg.id, msg.count); audio.pop(); break;
    case 'damage':
      if (player) {
        player.damage(msg.dmg);
        player.vel.x += msg.dx * 5;
        player.vel.z += msg.dz * 5;
        player.vel.y = Math.max(player.vel.y, 3.5);
      }
      break;
    case 'toss':
      if (net.isHost && drops) {
        drops.spawn(msg.x, msg.y, msg.z, msg.id, msg.count, { x: msg.vx, y: msg.vy, z: msg.vz }, 1.3);
      }
      break;
    case 'sync': sky.time = msg.time; weather.type = msg.wt; break;
    case 'bolt': weather.flash = 1; audio.thunder(0.4 + Math.random() * 2); break;
    case 'hostbye': onHostLost(); break;
  }
}

function updateNet(dt) {
  posTimer += dt;
  if (posTimer > 0.066) {
    posTimer = 0;
    const m = {
      t: 'pos',
      x: player.pos.x, y: player.pos.y, z: player.pos.z,
      yaw: player.yaw, pitch: player.pitch,
      sw: player.swingT > 0.2 ? 1 : 0,
      god: player.god, dead: player.dead,
    };
    if (net.isHost) m.id = 'host';
    net.send(m);
  }
  if (remotePlayers) remotePlayers.update(dt);
  if (net.isHost) {
    snapTimer += dt;
    if (snapTimer > 0.1) { snapTimer = 0; net.send(buildSnapshot()); }
    syncTimer += dt;
    if (syncTimer > 4) { syncTimer = 0; net.send({ t: 'sync', time: sky.time, wt: weather.type }); }
  } else if (remoteEnts) {
    remoteEnts.update(dt);
  }
}

// хост транслирует молнии гостям
weather.onLightning = () => {
  if (net.active && net.isHost) net.send({ t: 'bolt' });
};

// ---------- запуск/выход из игры ----------
function startGame(seed, save) {
  if (menuWorld) { menuWorld.dispose(); menuWorld = null; }
  if (world) { world.dispose(); world = null; }

  guestSession = !!(save && save.guest);
  startedFromSave = !!save && !save.guest;
  world = new World(scene, materials, seed, save ? save.modified : {});
  player = new Player(world, camera, scene, audio, materials);
  player.onDamage = () => { ui.flashDamage(); audio.hurt(); };
  drops = new Drops(scene, world, materials, audio);
  debris = new Debris(scene, world, materials);
  animals = new Animals(scene, world, audio);
  mobs = new Mobs(scene, world, audio, particles);

  // сетевые сущности
  if (remotePlayers) { remotePlayers.dispose(); remotePlayers = null; }
  if (remoteEnts) { remoteEnts.dispose(); remoteEnts = null; }
  if (net.active) {
    remotePlayers = new RemotePlayers(scene);
    if (!net.isHost) remoteEnts = new RemoteEntities(scene, materials);
  }

  // инвентарь и режим
  if (save && save.guest) {
    ui.resetInventory(save.mode === 'creative' ? 'creative' : 'survival');
    gameMode = ui.mode;
  } else if (save && save.inv) {
    ui.loadInvData(save.inv);
    gameMode = ui.mode;
  } else if (save && Array.isArray(save.hotbar)) {
    // старый формат сохранения (просто список id)
    ui.loadInvData({
      mode: 'creative',
      hotbar: save.hotbar.map(id => (typeof id === 'number' ? { id, count: -1 } : null)),
      bag: [], sel: save.hotbarSel || 0,
    });
    gameMode = 'creative';
  } else {
    ui.resetInventory(newWorldMode);
    gameMode = newWorldMode;
  }
  setGameMode(gameMode);

  if (save) {
    player.pos.set(save.player.x, save.player.y, save.player.z);
    player.yaw = save.player.yaw; player.pitch = save.player.pitch;
    player.health = save.player.health ?? 10;
    sky.time = save.time ?? 0.3;
    player.spawn.set(save.player.x, save.player.y, save.player.z);
  } else {
    sky.time = 0.3;
    player.pos.set(8.5, 60, 8.5);
  }

  ui.setHealth(player.health, player.maxHealth);
  state = 'loading';
  ui.show('loading');
  ui.showHUD(false);
}

function findSpawnColumn(cx, cz) {
  // ищем открытую колонку: суша, без дерева и листвы над головой
  for (let r = 0; r < 24; r += 2) {
    for (let dz = -r; dz <= r; dz += 2) for (let dx = -r; dx <= r; dx += 2) {
      if (Math.max(Math.abs(dx), Math.abs(dz)) !== r) continue;
      const x = cx + dx, z = cz + dz;
      const h = world.surfaceHeight(x, z);
      if (h <= 26) continue; // не в воде
      const surf = world.getBlock(x, h, z);
      if (surf === B.WOOD || surf === B.LEAVES) continue;
      let clear = true;
      for (let y = h + 1; y <= h + 4; y++) {
        if (world.getBlock(x, y, z) !== B.AIR) { clear = false; break; }
      }
      if (clear) return { x: x + 0.5, y: h + 1.01, z: z + 0.5 };
    }
  }
  return { x: cx + 0.5, y: world.surfaceHeight(cx, cz) + 2, z: cz + 0.5 };
}

function finalizeSpawn(isNew) {
  if (isNew) {
    const s = findSpawnColumn(Math.floor(player.pos.x), Math.floor(player.pos.z));
    player.pos.set(s.x, s.y, s.z);
  } else if (world.isSolid(Math.floor(player.pos.x), Math.floor(player.pos.y + 0.5), Math.floor(player.pos.z))) {
    // сохранённая позиция оказалась в блоке — поднимаем на поверхность
    player.pos.y = world.surfaceHeight(Math.floor(player.pos.x), Math.floor(player.pos.z)) + 1.01;
  }
  player.spawn.copy(player.pos);
  player.vel.set(0, 0, 0);
}

function exitToMenu() {
  saveGame();
  if (net.active) {
    if (net.isHost) net.send({ t: 'hostbye' });
    net.close();
  }
  if (remotePlayers) { remotePlayers.dispose(); remotePlayers = null; }
  if (remoteEnts) { remoteEnts.dispose(); remoteEnts = null; }
  ui.setRoomInfo(null, 0);
  guestSession = false;
  if (drops) { drops.dispose(); drops = null; }
  if (debris) { debris.dispose(); debris = null; }
  if (animals) { animals.dispose(); animals = null; }
  if (mobs) { mobs.dispose(); mobs = null; }
  if (world) { world.dispose(); world = null; }
  if (player) { scene.remove(player.model); player = null; }
  highlight.visible = false;
  crackMesh.visible = false;
  input.releaseLock();
  menuWorld = new World(scene, materials, (Math.random() * 1e9) | 0);
  state = 'menu';
  ui.showHUD(false);
  ui.show('main-menu');
}

function saveGame() {
  if (guestSession) return; // гость не трогает своё локальное сохранение
  if (world && player && !player.dead) {
    SaveSys.save(world, player, sky, ui.getInvData());
  }
}

window.addEventListener('beforeunload', saveGame);

// выброс предмета в мир (Q или drag&drop за пределы рюкзака)
function tossItem(id, count) {
  if (!player) return;
  const eye = player.getEye();
  const dir = player.getLookDir();
  const x = eye.x + dir.x * 0.6, y = eye.y - 0.2 + dir.y * 0.6, z = eye.z + dir.z * 0.6;
  const vx = dir.x * 6, vy = dir.y * 6 + 1.8, vz = dir.z * 6;
  if (isGuest()) {
    net.send({ t: 'toss', id, count, x, y, z, vx, vy, vz });
    return;
  }
  if (drops) drops.spawn(x, y, z, id, count, { x: vx, y: vy, z: vz }, 1.3);
}

// ---------- pointer lock и клавиши ----------
input.onLockChange = (locked) => {
  if (locked) {
    if (['ready', 'paused', 'inventory'].includes(state)) {
      state = 'playing';
      ui.show(null);
      ui.showHUD(true);
      ui.toggleInventory(false);
    }
  } else {
    if (state === 'playing') {
      state = 'paused';
      ui.show('pause-menu');
      saveGame();
    }
  }
};

input.onWheel = (dir) => {
  if (state === 'playing') ui.selectHotbar(ui.hotbarSel + dir);
};

input.onKey = (code, e) => {
  if (state === 'playing') {
    if (code === Binds.jump) {
      // двойной прыжок — полёт в творческом режиме
      const now = performance.now();
      if (now - lastSpaceTime < 280 && player.god) {
        player.flying = !player.flying;
        if (player.flying) { player.vel.y = 3; player.onGround = false; }
      }
      lastSpaceTime = now;
    }
    if (code === Binds.camera) { player.camMode = (player.camMode + 1) % 3; }
    if (code === 'F3') { debugOn = !debugOn; if (!debugOn) ui.setDebug(null); }
    if (code.startsWith('Digit')) {
      const n = +code.slice(5);
      if (n >= 1 && n <= 9) ui.selectHotbar(n - 1);
    }
    if (code === Binds.drop) {
      const t = ui.takeSelected(1);
      if (t) tossItem(t.id, t.count);
    }
    if (code === Binds.inventory) {
      state = 'inventory';
      ui.toggleInventory(true);
      input.releaseLock();
    }
  } else if (state === 'inventory') {
    if (code === Binds.inventory || code === 'Escape') {
      ui.toggleInventory(false);
      input.requestLock(); // вернёт state='playing' через onLockChange
    }
  }
};

// ---------- взаимодействие: бой, разлом, установка, еда ----------
function onAnimalDrop(id, count, pos) {
  drops.spawn(pos.x, pos.y, pos.z, id, count);
  particles.spawnBurst(pos.x, pos.y, pos.z, 0xc04038, 10, 2.5);
}

function updateInteraction(dt) {
  placeCooldown -= dt;
  attackCooldown -= dt;
  eatCooldown -= dt;

  const eye = player.getEye();
  const dir = player.getLookDir();
  const hit = world.raycast(eye, dir, 5.5, true);

  // ближайшее существо под прицелом: животное, моб или сетевая марионетка
  let cHit = null;
  if (isGuest()) {
    const rh = remoteEnts.tryHit(eye, dir, 4.2);
    if (rh) cHit = { dist: rh.dist, eid: rh.eid, remote: true };
  } else {
    const aHit = animals.tryHit(eye, dir, 4.2);
    const mHit = mobs.tryHit(eye, dir, 4.2);
    cHit = aHit ? { ...aHit, mgr: animals } : null;
    if (mHit && (!cHit || mHit.dist < cHit.dist)) cHit = { ...mHit, mgr: mobs };
  }
  const animalCloser = cHit && (!hit || cHit.dist < hit.dist);

  // замах руки при любом клике ЛКМ
  if (input.buttons.has(0) && player.swingT <= 0.05) player.triggerSwing();

  // --- атака существа ---
  if (animalCloser) {
    highlight.visible = false;
    if (input.buttons.has(0)) {
      breakTarget = null; breakProgress = 0;
      if (attackCooldown <= 0) {
        attackCooldown = 0.35;
        audio.hitAnimal();
        if (cHit.remote) {
          remoteEnts.flashEid(cHit.eid);
          net.send({ t: 'attack', eid: cHit.eid, dx: dir.x, dz: dir.z });
        } else {
          cHit.mgr.hit(cHit.animal, 1, dir, onAnimalDrop);
        }
      }
    }
  } else {
    highlight.visible = !!hit;
    if (hit) highlight.position.set(hit.x + 0.5, hit.y + 0.5, hit.z + 0.5);

    // --- ломание (удержание ЛКМ) ---
    if (input.buttons.has(0) && hit) {
      const key = hit.x + ',' + hit.y + ',' + hit.z;
      if (breakTarget !== key) { breakTarget = key; breakProgress = 0; }
      const def = BLOCKS[hit.id];
      const breakTime = gameMode === 'creative' ? 0.09 : def.hardness * 0.85;
      breakProgress += dt / breakTime;
      if (breakProgress >= 1) {
        world.setBlock(hit.x, hit.y, hit.z, B.AIR);
        // эффект разлома: rigid-body осколки + пыль
        debris.spawnBreak(hit.x + 0.5, hit.y + 0.5, hit.z + 0.5, hit.id);
        particles.spawnBurst(hit.x + 0.5, hit.y + 0.5, hit.z + 0.5, def.color || 0x888888, 8, 2);
        audio.breakBlock(def.sound);
        // дроп блока в выживании (дропы считает хост)
        let dropId = null;
        if (gameMode === 'survival') {
          dropId = DROP_MAP[hit.id] !== undefined ? DROP_MAP[hit.id] : hit.id;
          if (hit.id === B.LEAVES && Math.random() < 0.5) dropId = null; // листва сыплется не всегда
          if (dropId !== null && isSimHost()) {
            drops.spawn(hit.x + 0.5, hit.y + 0.4, hit.z + 0.5, dropId, 1);
          }
        }
        if (net.active) {
          net.send({ t: 'sb', x: hit.x, y: hit.y, z: hit.z, id: 0, drop: isGuest() ? dropId : null });
        }
        breakTarget = null;
        breakProgress = 0;
      }
    } else {
      breakTarget = null;
      breakProgress = 0;
    }
  }

  // индикатор и трещины на блоке
  ui.setBreakProgress(gameMode === 'survival' ? breakProgress : 0);
  if (breakProgress > 0 && hit) {
    crackMesh.visible = true;
    crackMesh.position.copy(highlight.position);
    crackMesh.material = crackMats[Math.min(4, (breakProgress * 5) | 0)];
  } else {
    crackMesh.visible = false;
  }

  // --- ПКМ: установка блока или еда ---
  if (input.buttons.has(2) && placeCooldown <= 0) {
    const blockId = ui.selectedBlock();
    const def = blockId !== null ? BLOCKS[blockId] : null;

    if (def && def.item) {
      // еда: восстанавливает здоровье в выживании
      if (def.food && gameMode === 'survival' && player.health < player.maxHealth && eatCooldown <= 0) {
        eatCooldown = 0.7;
        placeCooldown = 0.3;
        ui.consumeSelected();
        player.health = Math.min(player.maxHealth, player.health + def.food);
        ui.setHealth(player.health, player.maxHealth);
        audio.munch();
        player.triggerSwing();
      }
    } else if (def && hit && !animalCloser) {
      const px = hit.x + hit.nx, py = hit.y + hit.ny, pz = hit.z + hit.nz;
      const cur = world.getBlock(px, py, pz);
      const canReplace = cur === B.AIR || BLOCKS[cur].fluid;
      const wouldClip = def.solid && player.intersectsBlock(px, py, pz);
      if (canReplace && !wouldClip && py >= 0) {
        world.setBlock(px, py, pz, blockId);
        if (net.active) net.send({ t: 'sb', x: px, y: py, z: pz, id: blockId, drop: null });
        ui.consumeSelected();
        audio.placeBlock();
        placeCooldown = 0.22;
        player.triggerSwing();
      }
    }
  }
  if (!input.buttons.has(2)) placeCooldown = Math.min(placeCooldown, 0);
}

// ---------- атмосфера биома, лава рядом ----------
function updateAtmosphere(dt) {
  biomeCheckTimer -= dt;
  if (biomeCheckTimer <= 0 && world) {
    biomeCheckTimer = 0.5;
    currentBiome = world.gen.biomeAt(Math.floor(player.pos.x), Math.floor(player.pos.z));
  }
  const wantDust = currentBiome === BIOME.DESERT ? 1 : 0;
  const wantJungle = currentBiome === BIOME.JUNGLE ? 0.3 : 0;
  desertDust += (wantDust - desertDust) * Math.min(1, dt);
  jungleFog += (wantJungle - jungleFog) * Math.min(1, dt);

  if (currentBiome === BIOME.DESERT) { biomeTint.setHex(0xd8b070); tintAmount = desertDust; }
  else if (currentBiome === BIOME.JUNGLE) { biomeTint.setHex(0x86b890); tintAmount = jungleFog * 2; }
  else tintAmount = Math.max(0, tintAmount - dt);

  // поиск лавы рядом — свет и искры
  let lavaFound = null;
  for (let i = 0; i < 6; i++) {
    const x = Math.floor(player.pos.x + (Math.random() - 0.5) * 16);
    const y = Math.floor(player.pos.y + (Math.random() - 0.5) * 10);
    const z = Math.floor(player.pos.z + (Math.random() - 0.5) * 16);
    if (world.getBlock(x, y, z) === B.LAVA) { lavaFound = { x, y, z }; break; }
  }
  if (lavaFound) {
    lavaLight.position.set(lavaFound.x + 0.5, lavaFound.y + 1.2, lavaFound.z + 0.5);
    lavaLight.intensity = Math.min(30, lavaLight.intensity + dt * 60);
    if (Math.random() < dt * 3) particles.spawnLavaSpark(lavaFound.x + 0.5, lavaFound.y, lavaFound.z + 0.5);
  } else {
    lavaLight.intensity = Math.max(0, lavaLight.intensity - dt * 40);
  }
}

// эффективная погода с учётом биома
const effWeather = { rain: 0, fogFactor: 0, darkness: 0, flash: 0 };
function computeEffWeather() {
  effWeather.rain = currentBiome === BIOME.DESERT ? weather.rain * 0.3 : weather.rain;
  effWeather.fogFactor = clamp(weather.fogFactor + jungleFog + desertDust * 0.15, 0, 0.85);
  effWeather.darkness = weather.darkness;
  effWeather.flash = weather.flash;
  return effWeather;
}

// ---------- отладка ----------
let fpsTime = 0, fpsCount = 0, fps = 0;
function updateDebug(dt) {
  fpsTime += dt; fpsCount++;
  if (fpsTime > 0.5) { fps = Math.round(fpsCount / fpsTime); fpsTime = 0; fpsCount = 0; }
  if (!debugOn || !player) return;
  ui.setDebug(
    `FPS: ${fps}\n` +
    `XYZ: ${player.pos.x.toFixed(1)} / ${player.pos.y.toFixed(1)} / ${player.pos.z.toFixed(1)}\n` +
    `Биом: ${BIOME_NAMES[currentBiome]}\n` +
    `Погода: ${WEATHER_NAMES[weather.type]}\n` +
    `Время: ${(sky.time * 24).toFixed(1)} ч\n` +
    `Режим: ${gameMode === 'creative' ? 'Творческий' : 'Выживание'}\n` +
    `Чанков: ${world.chunks.size} | Животных: ${animals.list.length} | Мобов: ${mobs.list.length} | Дропов: ${drops.list.length}\n` +
    (net.active ? `Сеть: ${net.isHost ? 'хост' : 'гость'} · комната ${net.roomCode} · игроков ${net.playerCount()}\n` : '') +
    (player.flying ? 'ПОЛЁТ\n' : '') +
    `Сид: ${world.seed}`
  );
}

// ---------- главный цикл ----------
let lastT = performance.now();

function checkResize() {
  const w = window.innerWidth, h = window.innerHeight;
  const size = renderer.getSize(new THREE.Vector2());
  if (size.x !== w || size.y !== h) {
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    renderer.setSize(w, h);
  }
}

function loop() {
  requestAnimationFrame(loop);
  const now = performance.now();
  const dt = Math.min(0.05, (now - lastT) / 1000);
  lastT = now;
  checkResize();

  // анимация текстур воды и лавы
  materials.waterTexture.offset.x = (now * 0.00002) % 1;
  materials.waterTexture.offset.y = (now * 0.000035) % 1;
  materials.lavaTexture.offset.x = (now * 0.00001) % 1;
  materials.lavaTexture.offset.y = (Math.sin(now * 0.0004) * 0.05);

  if (state === 'menu') {
    menuAngle += dt * 0.06;
    const cx = Math.cos(menuAngle) * 60, cz = Math.sin(menuAngle) * 60;
    camera.position.set(cx, 52, cz);
    camera.lookAt(0, 28, 0);
    menuWorld.update(camera.position.x * 0.3, camera.position.z * 0.3, 6);
    weather.update(dt);
    sky.update(dt, camera.position, computeEffWeather(), null);
    particles.update(dt, camera.position, weather.rain, 0);
  } else if (state === 'loading') {
    world.update(player.pos.x, player.pos.z, 14);
    const p = world.readiness(player.pos.x, player.pos.z, 2);
    ui.setLoadProgress(p);
    if (p >= 1) {
      finalizeSpawn(!startedFromSave);
      state = 'ready';
      ui.show('click-to-play');
    }
    sky.update(dt, camera.position, computeEffWeather(), null);
  } else if (state === 'playing' || state === 'ready' || state === 'inventory') {
    const active = state === 'playing';
    if (active) {
      input.applyLook(player);
      player.update(dt, input);
      updateInteraction(dt);
      if (player.dead) {
        state = 'dead';
        input.releaseLock();
        ui.show('death-screen');
        ui.showHUD(false);
      }
    } else {
      player.updateCamera(false);
    }
    player.updateHand(dt, ui.selectedBlock());

    world.update(player.pos.x, player.pos.z, 7);
    weather.update(dt, isGuest());
    updateAtmosphere(dt);
    sky.update(dt, camera.position, computeEffWeather(), tintAmount > 0.05 ? biomeTint : null);
    particles.update(dt, player.pos, effWeather.rain, desertDust);

    // дропы, осколки, животные, ночные мобы (симуляцию считает хост)
    debris.update(dt);
    if (isSimHost()) {
      drops.update(dt, netTargets(), onPickupTarget);
      animals.update(dt, player.pos, onAnimalDrop);
      mobs.update(dt, netTargets(), sky.daylight, onMobHit, onAnimalDrop);
    }
    if (net.active) updateNet(dt);

    ui.setHealth(player.health, player.maxHealth);
    ui.setUnderwater(player.eyeInWater);
    ui.setLightning(weather.flash);
    audio.setUnderwater(player.eyeInWater);
    updateDebug(dt);

    saveTimer += dt;
    if (saveTimer > 20) { saveTimer = 0; saveGame(); }
  } else if (state === 'paused' || state === 'dead') {
    // мир на паузе, только рендер
  }

  renderer.render(scene, camera);
}

ui.show('main-menu');
loop();
