// БЛОК-СТРАЙК — точка входа: матч, раунды, стрельба, боты, сеть.
import * as THREE from 'three';
import { Settings, QUALITY, loadSettings, saveSettings, clamp, lerp } from '../config.js';
import { createMaterials } from '../blocks.js';
import { AudioSys } from '../audio.js';
import { Particles } from '../particles.js';
import { Input } from '../player/input.js';
import { Binds, loadBinds, renderBindEditor } from '../keybinds.js';
import { Net } from '../net.js';
import { CSMap, SPAWNS } from './csmap.js';
import { Pawn } from './pawn.js';
import { WEAPONS, WEAPON_ORDER, WeaponState, shotDir, castShot, damageFor, buildViewModel, Tracers } from './weapons.js';
import { Bot, buildNav, BOT_NAMES } from './bots.js';
import { CsUI } from './cshud.js';

loadSettings();
loadBinds();

const $ = (id) => document.getElementById(id);

// ---------- сцена ----------
const canvas = $('game-canvas');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: false });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setPixelRatio(QUALITY[Settings.quality].pixelRatio);
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x8fc4e8);
scene.fog = new THREE.Fog(0xd8cfa8, 70, 240);
const camera = new THREE.PerspectiveCamera(75, innerWidth / innerHeight, 0.05, 500);
scene.add(camera);

scene.add(new THREE.AmbientLight(0xffffff, 0.75));
const sun = new THREE.DirectionalLight(0xfff4e0, 1.1);
sun.position.set(60, 100, 30);
scene.add(sun);

const audio = new AudioSys();
const materials = createMaterials();
const map = new CSMap();
map.addToScene(scene, materials);
const nav = buildNav(map);
const particles = new Particles(scene);
const tracers = new Tracers(scene);
const input = new Input(canvas);

// вспышка выстрела у камеры
const muzzleLight = new THREE.PointLight(0xffc860, 0, 10);
camera.add(muzzleLight);
muzzleLight.position.set(0.3, -0.2, -0.8);

// ---------- состояние ----------
let state = 'menu'; // menu | lobby | select | live | roundend | matchend | paused
let roster = [];    // [{id, name, team, bot, diff}]
const pawns = new Map();
const botsAI = new Map();
let myId = 'me';
let config = { target: 12, roundTime: 105 };
let scores = { ct: 0, t: 0 };
let roundNo = 1;
let roundTimeLeft = 0;
let selectTimeLeft = 0;
let roundEndTimer = 0;
let myWeapon = null;   // активное оружие (ствол или нож)
let myGun = null;      // выбранный ствол раунда
let myKnife = null;    // нож всегда с собой
let gunChoice = 'ak';  // что выбрал игрок — то получат и боты
let switchT = 0;       // анимация смены оружия
let viewModel = null;
let spectateId = null;
let prevLMB = false, prevRMB = false;
let fov = 75;
let botCounter = 0;
let namePool = [];
let pausedBefore = 'live';

const net = new Net();
let posTimer = 0, botSnapTimer = 0, tickTimer = 0;
const isGuest = () => net.active && !net.isHost;
const isAuth = () => !net.active || net.isHost; // кто считает урон/раунды/ботов

const me = () => pawns.get(myId);
const myTeam = () => roster.find((r) => r.id === myId)?.team || 'ct';
const enemiesOf = (team) => [...pawns.values()].filter((p) => p.team !== team && p.alive);

// ---------- меню и кнопки ----------
function uiClick() { audio.init(); audio.uiClick(); }

$('btn-to-sandbox').onclick = () => { location.href = 'index.html'; };
$('btn-bots').onclick = () => { uiClick(); openLobby(false); };
$('btn-cs-mp').onclick = () => { uiClick(); CsUI.setMpStatus(''); CsUI.show('cs-mp-menu'); };
$('btn-cs-mp-back').onclick = () => { uiClick(); CsUI.show('cs-menu'); };
$('btn-cs-settings').onclick = () => { uiClick(); openSettings('cs-menu'); };
$('btn-cs-resume').onclick = () => { uiClick(); input.requestLock(); };
$('btn-cs-pause-settings').onclick = () => { uiClick(); openSettings('cs-pause'); };
$('btn-cs-leave').onclick = () => { uiClick(); leaveMatch(); };
$('btn-back-lobby').onclick = () => { uiClick(); cleanupMatch(); openLobby(net.active); };
$('cs-click').onclick = () => { audio.init(); input.requestLock(); };

let settingsReturn = 'cs-menu';
function openSettings(ret) {
  settingsReturn = ret;
  $('cs-set-sens').value = Settings.sensitivity;
  $('cs-set-vol').value = Settings.volume;
  refreshSettingLabels();
  renderBindEditor($('cs-bind-editor'), ['common', 'cs']);
  CsUI.show('cs-settings');
}
function refreshSettingLabels() {
  $('cs-val-sens').textContent = Number(Settings.sensitivity).toFixed(1);
  $('cs-val-vol').textContent = Math.round(Settings.volume * 100) + '%';
}
$('cs-set-sens').oninput = () => { Settings.sensitivity = +$('cs-set-sens').value; refreshSettingLabels(); saveSettings(); };
$('cs-set-vol').oninput = () => { Settings.volume = +$('cs-set-vol').value; audio.setVolume(Settings.volume); refreshSettingLabels(); saveSettings(); };
$('btn-cs-settings-back').onclick = () => { uiClick(); CsUI.show(settingsReturn); };

// ---------- лобби ----------
function openLobby(keepNet) {
  if (!keepNet && net.active) shutdownNet();
  if (!roster.find((r) => r.id === myId)) {
    roster = [{ id: myId, name: net.active && !net.isHost ? 'Ты' : 'Игрок', team: 'ct', bot: false }];
  }
  state = 'lobby';
  CsUI.setLobbyRoom(net.active ? `Комната: ${net.roomCode} — жми «Начать матч», когда все зайдут` : '');
  renderLobby();
  CsUI.show('lobby');
}

function renderLobby() {
  CsUI.renderLobby(roster, myId, isAuth(), {
    onKick: (id) => { roster = roster.filter((r) => r.id !== id); lobbyChanged(); },
  });
}

function lobbyChanged() {
  renderLobby();
  if (net.active && net.isHost) net.send({ t: 'lobby', roster, config });
}

function addBot(team, diff) {
  if (!isAuth()) return;
  if (roster.filter((r) => r.bot).length >= 12) return;
  if (!namePool.length) namePool = [...BOT_NAMES].sort(() => Math.random() - 0.5);
  const name = namePool.pop() || 'Бот-' + (++botCounter);
  roster.push({ id: 'bot' + (++botCounter), name, team, bot: true, diff });
  lobbyChanged();
}
$('btn-add-ct').onclick = () => { uiClick(); addBot('ct', $('ct-diff').value); };
$('btn-add-t').onclick = () => { uiClick(); addBot('t', $('t-diff').value); };
$('btn-switch-team').onclick = () => {
  uiClick();
  const r = roster.find((x) => x.id === myId);
  if (!r) return;
  r.team = r.team === 'ct' ? 't' : 'ct';
  if (isGuest()) net.send({ t: 'team', team: r.team });
  else lobbyChanged();
};
$('cfg-target').onchange = () => { config.target = +$('cfg-target').value; lobbyChanged(); };
$('cfg-time').onchange = () => { config.roundTime = +$('cfg-time').value; lobbyChanged(); };
$('btn-lobby-back').onclick = () => { uiClick(); shutdownNet(); roster = []; CsUI.show('cs-menu'); state = 'menu'; };
$('btn-start-match').onclick = () => {
  uiClick();
  if (!isAuth()) return;
  // в каждой команде должен быть хоть кто-то
  const myT = myTeam();
  if (!roster.some((r) => r.team !== myT)) addBot(myT === 'ct' ? 't' : 'ct', 'normal');
  if (net.active) net.send({ t: 'start', roster, config });
  startMatch();
};

// ---------- матч ----------
function startMatch() {
  cleanupMatch();
  for (const r of roster) {
    const pawn = new Pawn(scene, map, r.team, r.name, r.id === myId);
    pawn.rosterId = r.id;
    pawns.set(r.id, pawn);
    if (r.bot && isAuth()) botsAI.set(r.id, new Bot(pawn, r.diff));
  }
  scores = { ct: 0, t: 0 };
  roundNo = 1;
  startRound();
  CsUI.showHUD(true);
  CsUI.show('cs-click');
  if (net.active) CsUI.setRoomInfo(net.roomCode, net.playerCount());
}

function cleanupMatch() {
  for (const p of pawns.values()) p.dispose();
  pawns.clear();
  botsAI.clear();
  setViewModel(null);
  CsUI.showHUD(false);
}

function startRound() {
  const slots = { ct: 0, t: 0 };
  for (const r of roster) {
    const pawn = pawns.get(r.id);
    const sp = SPAWNS[r.team];
    const pt = sp.points[slots[r.team]++ % sp.points.length];
    pawn.respawn(pt[0], pt[1], sp.yaw, map);
  }
  myWeapon = null;
  myGun = null;
  myKnife = null;
  setViewModel(null);
  spectateId = null;
  state = 'select';
  selectTimeLeft = 4;
  CsUI.setScope(false);
  CsUI.setSpectate(null);
  CsUI.hideBanner();
  CsUI.show('weapon-select');
  CsUI.hotWeaponCard(null);
  CsUI.setScore(scores.ct, scores.t, roundNo, config.target);
  if (net.active && net.isHost) sendPhase();
}

function pickWeapon(key) {
  gunChoice = key;
  myGun = new WeaponState(key);
  myKnife = key === 'knife' ? myGun : new WeaponState('knife');
  myWeapon = myGun;
  setViewModel(key);
  CsUI.hotWeaponCard(key);
  CsUI.setSlots(myGun.def.name, false);
  audio.uiClick();
}
for (const card of document.querySelectorAll('.wcard')) {
  card.onclick = () => pickWeapon(card.dataset.wpn);
}

// смена ствол ↔ нож (колёсико, 1 / 3)
function switchTo(which) {
  if (state !== 'live' || !myGun) return;
  const w = which === 'knife' ? myKnife : myGun;
  if (!w || myWeapon === w) return;
  myWeapon = w;
  myWeapon.zoomed = false;
  switchT = 0.35;
  setViewModel(w.key);
  audio.zoomClick();
  CsUI.setSlots(myGun.def.name, myWeapon === myKnife && myKnife !== myGun);
  CsUI.setScope(false);
}

function goLive() {
  if (!myGun) pickWeapon('ak');
  // все боты получают то же оружие, что выбрал игрок
  if (isAuth()) {
    for (const bot of botsAI.values()) bot.weapon = new WeaponState(gunChoice);
  }
  state = 'live';
  roundTimeLeft = config.roundTime;
  CsUI.show(document.pointerLockElement ? null : 'cs-click');
  audio.roundStartSnd();
  CsUI.banner('Бой!', 'info', 1200);
  if (net.active && net.isHost) sendPhase();
}

function endRound(winner) {
  scores[winner]++;
  state = 'roundend';
  roundEndTimer = 4;
  const won = winner === myTeam();
  CsUI.banner(won ? 'Раунд выигран!' : 'Раунд проигран', won ? 'win' : 'lose', 3500);
  if (won) audio.winSnd(); else audio.loseSnd();
  CsUI.setScore(scores.ct, scores.t, roundNo, config.target);
  if (net.active && net.isHost) sendPhase(winner);
}

function endMatch() {
  state = 'matchend';
  input.releaseLock();
  const won = scores[myTeam()] > scores[myTeam() === 'ct' ? 't' : 'ct'];
  $('match-result').textContent = won ? '🏆 Победа!' : 'Поражение';
  $('match-score').textContent = `${scores.ct} : ${scores.t}`;
  CsUI.show('match-end');
  CsUI.showHUD(false);
  if (won) audio.winSnd(); else audio.loseSnd();
}

function leaveMatch() {
  cleanupMatch();
  shutdownNet();
  roster = roster.filter((r) => r.id === myId);
  input.releaseLock();
  state = 'menu';
  CsUI.show('cs-menu');
}

function checkRoundEnd() {
  if (state !== 'live' || !isAuth()) return;
  const ctAlive = [...pawns.values()].some((p) => p.team === 'ct' && p.alive);
  const tAlive = [...pawns.values()].some((p) => p.team === 't' && p.alive);
  if (!ctAlive || !tAlive) endRound(ctAlive ? 'ct' : 't');
}

// ---------- стрельба ----------
function muzzlePoint() {
  const eye = me().eye();
  const d = me().lookDir();
  const right = new THREE.Vector3(-d.z, 0, d.x).normalize();
  return eye.addScaledVector(d, 0.4).addScaledVector(right, 0.14).add(new THREE.Vector3(0, -0.12, 0));
}

function fireMyWeapon() {
  if (switchT > 0) return; // достаём оружие
  const p = me();
  const ws = myWeapon;
  const def = ws.def;
  if (!ws.canFire()) {
    if (!def.melee && ws.ammo === 0 && !ws.reloading) { audio.emptyClick(); ws.cd = 0.25; }
    return;
  }
  ws.cd = def.rate;
  const spread = ws.spreadFor(p); // разброс считаем ДО отдачи этого выстрела
  if (!def.melee) ws.ammo--;
  // отдача: растёт с темпом очереди, гасится приседом — но контролируется мышью
  const kick = ws.onFire(p);
  if (!def.melee) {
    p.pitch = Math.min(Math.PI / 2, p.pitch + kick);
    p.yaw += (Math.random() - 0.5) * kick * 0.5;
  }
  muzzleLight.intensity = def.melee ? 0 : 6;

  const dir = shotDir(p.lookDir(), spread);
  const maxDist = def.melee ? def.range : 300;
  const res = castShot(map, p.eye(), dir, enemiesOf(p.team), maxDist);
  audio.gunShot(def.key === 'knife' ? 'knife' : def.key);

  if (!def.melee) {
    tracers.spawn(muzzlePoint(), res.point);
    if (res.mapHit) particles.spawnBurst(res.point.x, res.point.y, res.point.z, 0xd8cfa8, 5, 1.5);
  }
  broadcastShot(res.point, def.key);
  notifyBotsHear(p.pos);

  if (res.pawn) {
    let backstab = false;
    if (def.melee) {
      const vd = res.pawn.lookDir();
      backstab = vd.dot(dir) > 0.45;
      audio.knifeHit();
    }
    const dmg = damageFor(def, res.part, backstab);
    particles.spawnBurst(res.point.x, res.point.y, res.point.z, 0xa01818, 8, 2);
    CsUI.hitmarker(res.part === 'head');
    if (res.part === 'head' && !def.melee) {
      audio.headshotDing();
      CsUI.hsPopup();
    } else {
      audio.hitmark();
    }
    dealDamage(res.pawn, dmg, res.part, myId, def.key);
  }
}

// авторитарное применение урона (оффлайн/хост) или заявка гостя
function dealDamage(target, dmg, part, killerId, wpnKey) {
  if (!isAuth()) {
    net.send({ t: 'dmg', to: target.rosterId, dmg, part, wpn: wpnKey });
    return;
  }
  applyDamageAuth(target, dmg, part, killerId, wpnKey);
}

function applyDamageAuth(target, dmg, part, killerId, wpnKey) {
  if (!target.alive || state !== 'live') return;
  const died = target.applyDamage(dmg);
  if (target.rosterId === myId) onMyDamage();
  if (net.active && net.isHost) {
    net.send({ t: 'hp', id: target.rosterId, hp: target.hp, dead: !target.alive, by: killerId, wpn: wpnKey, part });
  }
  if (died) onPawnDied(target, killerId, wpnKey, part === 'head');
}

function onMyDamage() {
  CsUI.damageFlash();
  audio.hurt();
  CsUI.setHp(me().hp);
}

function onPawnDied(target, killerId, wpnKey, hs) {
  const killer = pawns.get(killerId);
  if (killer) killer.kills++;
  const kr = roster.find((r) => r.id === killerId);
  const vr = roster.find((r) => r.id === target.rosterId);
  CsUI.killfeed(kr ? kr.name : '?', kr ? kr.team : 'ct', vr.name, vr.team, wpnKey, hs);
  if (target.pos.distanceTo(me().pos) < 40) audio.deathSnd();
  if (target.rosterId === myId) enterSpectate();
  checkRoundEnd();
}

function enterSpectate() {
  CsUI.setScope(false);
  const mate = [...pawns.values()].find((p) => p.team === myTeam() && p.alive && p.rosterId !== myId);
  spectateId = mate ? mate.rosterId : null;
  CsUI.setSpectate(mate ? `Наблюдение: ${roster.find((r) => r.id === spectateId).name} · ЛКМ — следующий` : 'Ждём конца раунда…');
}

function cycleSpectate() {
  const mates = [...pawns.values()].filter((p) => p.team === myTeam() && p.alive);
  if (!mates.length) return;
  const i = mates.findIndex((p) => p.rosterId === spectateId);
  spectateId = mates[(i + 1) % mates.length].rosterId;
  CsUI.setSpectate(`Наблюдение: ${roster.find((r) => r.id === spectateId).name} · ЛКМ — следующий`);
}

// выстрел бота (авторитарная сторона)
function botFire(bot, target) {
  const p = bot.pawn;
  const ws = bot.weapon;
  const def = ws.def;
  if (!ws.canFire()) return;
  ws.cd = def.rate;
  const spread = ws.spreadFor(p) * 1.2;
  if (!def.melee) ws.ammo--;
  ws.onFire(p);
  const dir = shotDir(p.lookDir(), spread);
  const res = castShot(map, p.eye(), dir, enemiesOf(p.team), def.melee ? def.range : 300);
  const distToMe = p.pos.distanceTo(me().pos);
  if (distToMe < 70) audio.gunShot(def.key === 'knife' ? 'knife' : def.key);
  if (!def.melee) {
    tracers.spawn(p.eye().addScaledVector(dir, 0.5), res.point);
    if (res.mapHit) particles.spawnBurst(res.point.x, res.point.y, res.point.z, 0xd8cfa8, 4, 1.2);
  }
  broadcastShot(res.point, def.key, p);
  notifyBotsHear(p.pos);
  if (res.pawn) {
    particles.spawnBurst(res.point.x, res.point.y, res.point.z, 0xa01818, 7, 2);
    applyDamageAuth(res.pawn, damageFor(def, res.part), res.part, bot.pawn.rosterId, def.key);
  }
}

function notifyBotsHear(origin) {
  for (const bot of botsAI.values()) {
    if (bot.pawn.alive && bot.pawn.pos.distanceTo(origin) < 34) bot.hear(origin);
  }
}

// ---------- вьюмодель ----------
function setViewModel(key) {
  if (viewModel) { camera.remove(viewModel); viewModel = null; }
  if (!key) return;
  viewModel = buildViewModel(key);
  viewModel.position.set(0.32, -0.3, -0.5);
  camera.add(viewModel);
}

function updateViewModel(dt) {
  if (!viewModel || !myWeapon) return;
  const ws = myWeapon;
  const p = me();
  const hSpeed = p ? Math.hypot(p.vel.x, p.vel.z) : 0;
  const bob = Math.min(1, hSpeed / 4) * (p && p.onGround ? 1 : 0.2);
  const t = p ? p.walkPhase * 1.8 : 0;
  const kick = ws.kickT;
  const reload = ws.reloading ? Math.sin((1 - ws.reloadT / ws.def.reload) * Math.PI) : 0;
  // провал оружия при смене (достаём из-за спины)
  const sw = switchT > 0 ? switchT / 0.35 : 0;

  viewModel.position.set(
    0.32 + Math.cos(t) * 0.01 * bob,
    -0.3 + Math.abs(Math.sin(t)) * 0.015 * bob - reload * 0.18 - sw * 0.28,
    -0.5 + kick * 0.09
  );
  let boltRoll = 0;
  // лёгкая анимация затвора АВП после выстрела
  if (ws.def.key === 'awp' && viewModel.userData.bolt && ws.cd > 0) {
    const prog = 1 - Math.max(0, ws.cd) / ws.def.rate; // 0..1 за перезарядку затвора
    const k = clamp(prog / 0.45, 0, 1);
    const s = Math.sin(k * Math.PI);
    const bolt = viewModel.userData.bolt;
    bolt.position.z = viewModel.userData.boltZ + s * 0.09;
    bolt.rotation.x = s * 0.9;
    boltRoll = s * 0.08;
  }
  viewModel.rotation.set(kick * 0.28 + reload * 0.9 + sw * 0.9, 0, boltRoll);
  viewModel.visible = !(ws.def.zoom && ws.zoomed);
  muzzleLight.intensity = Math.max(0, muzzleLight.intensity - dt * 60);
}

// ---------- сеть ----------
function shutdownNet() {
  if (net.active) {
    if (net.isHost) net.send({ t: 'csbye' });
    net.close();
  }
  CsUI.setRoomInfo(null, 0);
}

function setupNetHandlers() {
  net.onMessage = handleNet;
  net.onPeerJoin = (conn) => {
    if (state !== 'lobby') { conn.close(); return; }
    const team = roster.filter((r) => r.team === 'ct' && !r.bot).length <= roster.filter((r) => r.team === 't' && !r.bot).length ? 'ct' : 't';
    roster.push({ id: conn.peer, name: 'Друг-' + (net.conns.length), team, bot: false });
    lobbyChanged();
    CsUI.setLobbyRoom(`Комната: ${net.roomCode} · игроков: ${net.playerCount()}`);
  };
  net.onPeerLeave = (conn) => {
    roster = roster.filter((r) => r.id !== conn.peer);
    const pw = pawns.get(conn.peer);
    if (pw) { pw.dispose(); pawns.delete(conn.peer); }
    if (state === 'lobby') lobbyChanged();
    checkRoundEnd();
  };
  net.onClosed = () => {
    CsUI.banner('Хост покинул игру', 'lose', 3000);
    setTimeout(() => leaveMatch(), 1500);
  };
}

$('btn-cs-host').onclick = () => {
  uiClick();
  CsUI.setMpStatus('Создание комнаты…');
  setupNetHandlers();
  net.host((err, code) => {
    if (err) { CsUI.setMpStatus('Ошибка: ' + (err.type || err.message || err)); return; }
    myId = 'host';
    roster = [{ id: myId, name: 'Хост', team: 'ct', bot: false }];
    openLobby(true);
  });
};

$('btn-cs-join').onclick = () => {
  uiClick();
  const code = $('cs-code').value.trim();
  if (code.length < 3) { CsUI.setMpStatus('Введите код комнаты'); return; }
  CsUI.setMpStatus('Подключение…');
  setupNetHandlers();
  net.join(code, (err) => {
    if (err) {
      CsUI.setMpStatus(err.type === 'peer-unavailable' ? 'Комната не найдена' : 'Ошибка: ' + (err.type || err.message || err));
      net.close();
      return;
    }
    myId = net.peer.id;
    net.send({ t: 'cshello' });
    CsUI.setMpStatus('Ожидание лобби…');
  });
};

function sendPhase(winner = null) {
  net.send({
    t: 'phase', state, roundNo, scores, winner,
    timeLeft: state === 'live' ? roundTimeLeft : selectTimeLeft,
  });
}

function handleNet(msg, conn) {
  switch (msg.t) {
    case 'cshello': // хост шлёт лобби новичку
      net.send({ t: 'lobby', roster, config }, conn);
      break;
    case 'lobby':
      if (isGuest()) {
        roster = msg.roster;
        config = msg.config;
        $('cfg-target').value = config.target;
        $('cfg-time').value = config.roundTime;
        if (state === 'menu' || state === 'lobby') {
          state = 'lobby';
          CsUI.setLobbyRoom(`Комната: ${net.roomCode}`);
          renderLobby();
          CsUI.show('lobby');
        }
      }
      break;
    case 'team': { // гость сменил команду
      if (!net.isHost) return;
      const r = roster.find((x) => x.id === conn.peer);
      if (r) { r.team = msg.team; lobbyChanged(); }
      break;
    }
    case 'start':
      if (isGuest()) {
        roster = msg.roster;
        config = msg.config;
        startMatch();
      }
      break;
    case 'phase':
      if (isGuest()) {
        scores = msg.scores;
        roundNo = msg.roundNo;
        if (msg.state === 'select' && state !== 'select') startRound();
        else if (msg.state === 'live' && state === 'select') goLive();
        else if (msg.state === 'roundend' && state === 'live') {
          state = 'roundend';
          const won = msg.winner === myTeam();
          CsUI.banner(won ? 'Раунд выигран!' : 'Раунд проигран', won ? 'win' : 'lose', 3500);
          if (won) audio.winSnd(); else audio.loseSnd();
          CsUI.setScore(scores.ct, scores.t, roundNo, config.target);
        } else if (msg.state === 'matchend') endMatch();
        break;
      }
      break;
    case 'tick':
      if (isGuest()) roundTimeLeft = msg.timeLeft;
      break;
    case 'pos': {
      const id = net.isHost ? conn.peer : msg.id;
      const pw = pawns.get(id);
      if (pw && id !== myId) {
        pw.netTarget = { x: msg.x, y: msg.y, z: msg.z, yaw: msg.yaw, pitch: msg.pitch, cr: msg.cr };
      }
      if (net.isHost) { msg.id = conn.peer; net.relayExcept(msg, conn); }
      break;
    }
    case 'bots':
      if (isGuest()) {
        for (const [id, x, y, z, yaw, cr] of msg.list) {
          const pw = pawns.get(id);
          if (pw) pw.netTarget = { x, y, z, yaw, pitch: 0, cr };
        }
      }
      break;
    case 'shot': { // визуал чужого выстрела
      const from = new THREE.Vector3(msg.o[0], msg.o[1], msg.o[2]);
      const to = new THREE.Vector3(msg.p[0], msg.p[1], msg.p[2]);
      if (msg.wpn !== 'knife') tracers.spawn(from, to);
      if (from.distanceTo(me() ? me().pos : from) < 70) audio.gunShot(msg.wpn);
      notifyBotsHear(from);
      if (net.isHost) net.relayExcept(msg, conn);
      break;
    }
    case 'dmg': { // заявка гостя на урон
      if (!net.isHost) return;
      const target = [...pawns.values()].find((p) => p.rosterId === msg.to);
      if (target) applyDamageAuth(target, msg.dmg, msg.part, conn.peer, msg.wpn);
      break;
    }
    case 'hp': { // авторитетное здоровье от хоста
      if (net.isHost) return;
      const pw = pawns.get(msg.id);
      if (!pw) return;
      pw.hp = msg.hp;
      pw.flashT = 0.15;
      if (msg.id === myId) { CsUI.setHp(pw.hp); if (msg.hp > 0) onMyDamage(); }
      if (msg.dead && pw.alive) {
        pw.die();
        const killer = pawns.get(msg.by);
        if (killer) killer.kills++;
        const kr = roster.find((r) => r.id === msg.by);
        const vr = roster.find((r) => r.id === msg.id);
        if (kr && vr) CsUI.killfeed(kr.name, kr.team, vr.name, vr.team, msg.wpn, msg.part === 'head');
        if (msg.id === myId) { onMyDamage(); enterSpectate(); }
        if (msg.by === myId) CsUI.hitmarker(msg.part === 'head');
      }
      break;
    }
    case 'csbye':
      CsUI.banner('Хост покинул игру', 'lose', 3000);
      setTimeout(() => leaveMatch(), 1500);
      break;
  }
}

function broadcastShot(point, wpnKey, pawn = null) {
  if (!net.active) return;
  const from = pawn ? pawn.eye() : muzzlePoint();
  net.send({ t: 'shot', wpn: wpnKey, o: [from.x, from.y, from.z], p: [point.x, point.y, point.z] });
}

function updateNet(dt) {
  posTimer += dt;
  if (posTimer > 0.05 && me()) {
    posTimer = 0;
    const p = me();
    const m = { t: 'pos', x: p.pos.x, y: p.pos.y, z: p.pos.z, yaw: p.yaw, pitch: p.pitch, cr: p.crouching };
    if (net.isHost) m.id = myId;
    net.send(m);
  }
  if (net.isHost) {
    botSnapTimer += dt;
    if (botSnapTimer > 0.08) {
      botSnapTimer = 0;
      const list = [];
      for (const [id, bot] of botsAI) {
        const p = bot.pawn;
        list.push([id, +p.pos.x.toFixed(2), +p.pos.y.toFixed(2), +p.pos.z.toFixed(2), +p.yaw.toFixed(2), p.crouching]);
      }
      net.send({ t: 'bots', list });
    }
    tickTimer += dt;
    if (tickTimer > 2 && state === 'live') { tickTimer = 0; net.send({ t: 'tick', timeLeft: roundTimeLeft }); }
  }
  // интерполяция сетевых бойцов
  for (const pw of pawns.values()) {
    if (pw.rosterId === myId || !pw.netTarget || !pw.alive) continue;
    const k = 1 - Math.exp(-14 * dt);
    pw.pos.x = lerp(pw.pos.x, pw.netTarget.x, k);
    pw.pos.y = lerp(pw.pos.y, pw.netTarget.y, k);
    pw.pos.z = lerp(pw.pos.z, pw.netTarget.z, k);
    let dy = pw.netTarget.yaw - pw.yaw;
    while (dy > Math.PI) dy -= Math.PI * 2;
    while (dy < -Math.PI) dy += Math.PI * 2;
    pw.yaw += dy * k;
    pw.pitch = pw.netTarget.pitch;
    pw.crouching = pw.netTarget.cr;
    pw.walkPhase += Math.hypot(pw.netTarget.x - pw.pos.x, pw.netTarget.z - pw.pos.z) * 3;
    pw.updateModel(4);
  }
}

// ---------- ввод ----------
input.onLockChange = (locked) => {
  if (locked) {
    if (['paused'].includes(state)) { state = pausedBefore; CsUI.show(null); }
    else CsUI.show(state === 'select' ? 'weapon-select' : null);
  } else if (state === 'live' || state === 'select' || state === 'roundend') {
    pausedBefore = state;
    state = 'paused';
    CsUI.show('cs-pause');
  }
};

input.onKey = (code) => {
  if (state === 'select') {
    const n = ['Digit1', 'Digit2', 'Digit3', 'Digit4'].indexOf(code);
    if (n >= 0) pickWeapon(WEAPON_ORDER[n]);
    if (code === Binds.buy) CsUI.show('weapon-select');
  } else if (state === 'live') {
    if (code === 'Digit1') switchTo('gun');
    if (code === 'Digit3') switchTo('knife');
    if (code === Binds.reload && myWeapon) {
      if (myWeapon.startReload()) audio.reloadSnd();
    }
  }
};

// колёсико мыши — быстрая смена ствол ↔ нож
input.onWheel = () => {
  if (state === 'live') switchTo(myWeapon === myKnife && myKnife !== myGun ? 'gun' : 'knife');
};

function applyLook(dt) {
  const p = me();
  if (!p || !p.alive) { input.mouseDX = 0; input.mouseDY = 0; return; }
  const zoomK = (myWeapon && myWeapon.def.zoom && myWeapon.zoomed) ? 0.25 : 1;
  const s = 0.0022 * Settings.sensitivity * zoomK;
  p.yaw -= input.mouseDX * s;
  p.pitch = clamp(p.pitch - input.mouseDY * s, -Math.PI / 2 + 0.01, Math.PI / 2 - 0.01);
  input.mouseDX = 0;
  input.mouseDY = 0;
}

// ---------- игровой цикл ----------
let lastT = performance.now();
let sbVisible = false;
let sbTimer = 0;

function checkResize() {
  const w = innerWidth, h = innerHeight;
  const size = renderer.getSize(new THREE.Vector2());
  if (size.x !== w || size.y !== h) {
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    renderer.setSize(w, h);
  }
}

function updateLive(dt) {
  const p = me();
  const alive = p && p.alive;

  // движение игрока
  if (alive && state === 'live') {
    applyLook(dt);
    const f = input.keys;
    const wish = {
      mx: (f.has(Binds.right) ? 1 : 0) - (f.has(Binds.left) ? 1 : 0),
      mz: (f.has(Binds.back) ? 1 : 0) - (f.has(Binds.forward) ? 1 : 0),
      jump: f.has(Binds.jump),
      crouch: f.has(Binds.crouch),
      walk: f.has(Binds.sprint),
      speed: myWeapon ? myWeapon.def.speed : 5,
    };
    const prevStep = p.stepDist;
    p.update(dt, wish);
    if (p.stepDist - prevStep > 0 && p.stepDist > 2.2 && !wish.walk && !wish.crouch) {
      p.stepDist = 0;
      audio.step('sand');
      notifyBotsHear(p.pos);
    }

    // оружие
    switchT = Math.max(0, switchT - dt);
    if (myWeapon) {
      myWeapon.update(dt);
      if (myKnife && myKnife !== myWeapon) myKnife.update(dt);
      if (myGun && myGun !== myWeapon) myGun.update(dt);
      const lmb = input.buttons.has(0), rmb = input.buttons.has(2);
      if (myWeapon.def.zoom && rmb && !prevRMB) {
        myWeapon.zoomed = !myWeapon.zoomed;
        audio.zoomClick();
      }
      if (myWeapon.def.melee && rmb && !prevRMB && myWeapon.cd <= 0 && switchT <= 0) {
        // тяжёлый удар ножом
        myWeapon.cd = myWeapon.def.heavyRate;
        const dir = p.lookDir();
        const res = castShot(map, p.eye(), dir, enemiesOf(p.team), myWeapon.def.range);
        audio.gunShot('knife');
        myWeapon.kickT = 1;
        if (res.pawn) {
          const backstab = res.pawn.lookDir().dot(dir) > 0.45;
          audio.knifeHit();
          CsUI.hitmarker(false);
          particles.spawnBurst(res.point.x, res.point.y, res.point.z, 0xa01818, 8, 2);
          dealDamage(res.pawn, Math.round(myWeapon.def.heavyDmg * (backstab ? myWeapon.def.backMul : 1)), 'body', myId, 'knife');
        }
      }
      if (lmb && (myWeapon.def.auto || !prevLMB)) fireMyWeapon();
      prevLMB = lmb; prevRMB = rmb;
      CsUI.setScope(myWeapon.def.zoom && myWeapon.zoomed);
      CsUI.setAmmo(myWeapon);
    }

    // камера от первого лица (крен всегда 0)
    camera.position.copy(p.eye());
    camera.rotation.order = 'YXZ';
    camera.rotation.set(p.pitch, p.yaw, 0);
  } else if (state === 'live' || state === 'roundend') {
    // наблюдатель
    applyLook(dt);
    const lmb = input.buttons.has(0);
    if (lmb && !prevLMB) cycleSpectate();
    prevLMB = lmb;
    const target = spectateId ? pawns.get(spectateId) : null;
    if (target && target.alive) {
      camera.position.copy(target.eye());
      camera.rotation.order = 'YXZ';
      camera.rotation.set(target.pitch, target.yaw, 0);
    } else {
      camera.position.set(80, 34, 80);
      camera.lookAt(80, 0, 79);
    }
    CsUI.setScope(false);
  }

  // плавный зум АВП
  const wantFov = (alive && myWeapon && myWeapon.def.zoom && myWeapon.zoomed) ? 22 : 75;
  if (Math.abs(fov - wantFov) > 0.5) {
    fov = lerp(fov, wantFov, 1 - Math.exp(-14 * dt));
    camera.fov = fov;
    camera.updateProjectionMatrix();
  }

  // боты (оффлайн или на хосте)
  if (isAuth() && state === 'live') {
    for (const bot of botsAI.values()) {
      bot.update(dt, {
        map, nav,
        enemies: enemiesOf(bot.pawn.team),
        fire: (b, target) => botFire(b, target),
      });
    }
  }

  // таймер раунда
  if (state === 'live' && isAuth()) {
    roundTimeLeft -= dt;
    if (roundTimeLeft <= 0) endRound('ct'); // время вышло — победа обороны
  }
  if (state === 'live' && isGuest()) roundTimeLeft -= dt;
  CsUI.setTimer(roundTimeLeft, roundTimeLeft < 15);
  if (alive) CsUI.setHp(p.hp);

  updateViewModel(dt);
  if (net.active) updateNet(dt);

  // таблица счёта по удержанию Tab
  const sb = input.keys.has(Binds.scoreboard);
  if (sb !== sbVisible) { sbVisible = sb; CsUI.toggleScoreboard(sb); }
  if (sb) {
    sbTimer -= dt;
    if (sbTimer <= 0) { sbTimer = 0.3; CsUI.renderScoreboard(roster, pawns, myId); }
  }
}

function loop() {
  requestAnimationFrame(loop);
  const now = performance.now();
  const dt = Math.min(0.05, (now - lastT) / 1000);
  lastT = now;
  checkResize();

  if (state === 'select') {
    if (isAuth()) {
      selectTimeLeft -= dt;
      CsUI.setSelectTimer(selectTimeLeft);
      if (selectTimeLeft <= 0) goLive();
    } else {
      selectTimeLeft = Math.max(0, selectTimeLeft - dt);
      CsUI.setSelectTimer(selectTimeLeft);
    }
    if (net.active) updateNet(dt);
    // камера — вид со своего спавна (без крена от меню)
    const p = me();
    if (p) {
      camera.position.copy(p.eye());
      camera.rotation.order = 'YXZ';
      camera.rotation.set(p.pitch, p.yaw, 0);
    }
  } else if (state === 'live' || state === 'roundend') {
    updateLive(dt);
    if (state === 'roundend' && isAuth()) {
      roundEndTimer -= dt;
      if (roundEndTimer <= 0) {
        if (scores.ct >= config.target || scores.t >= config.target) {
          endMatch();
          if (net.active && net.isHost) { state = 'matchend'; sendPhase(); }
        } else {
          roundNo++;
          startRound();
        }
      }
    }
  } else if (state === 'paused') {
    if (net.active) { updateLive(dt); } // сетевая игра не останавливается
  } else if (state === 'menu' || state === 'lobby') {
    // фоновая камера кружит над картой
    const t = now * 0.00008;
    camera.position.set(80 + Math.cos(t) * 68, 30, 80 + Math.sin(t) * 68);
    camera.lookAt(80, 2, 80);
  }

  tracers.update(dt);
  particles.update(dt, camera.position, 0, 0);
  renderer.render(scene, camera);
}

// громкость из настроек
audio.setVolume(Settings.volume);
CsUI.show('cs-menu');
loop();
