// Блок-Страйк: HUD и экраны (DOM).
import { WEAPONS } from './weapons.js';
import { DIFFICULTIES } from './bots.js';

const $ = (id) => document.getElementById(id);

export const CsUI = {
  // ---------- миникарта (радар) ----------
  _mmBg: null,
  _mmW: 160, _mmD: 160,

  initMinimap(map, mapW, mapD) {
    this._mmW = mapW; this._mmD = mapD;
    const bg = document.createElement('canvas');
    bg.width = mapW; bg.height = mapD;
    const g = bg.getContext('2d');
    const sandShades = ['#c9b988', '#d5c595', '#e0d1a3', '#eaddb2', '#f0e4bd'];
    for (let z = 0; z < mapD; z++) for (let x = 0; x < mapW; x++) {
      const h = map.groundY(x, z);
      let color;
      if (h >= 6) {
        color = '#57492f'; // стены/застройка
      } else {
        const top = map.getBlock(x, h - 1, z);
        if (top === 13) color = '#a05540';                    // кирпич (плент)
        else if (top === 3) color = '#b6b0a2';                // камень (спавны)
        else if (top === 12) color = '#8a6a3c';               // ящики
        else color = sandShades[Math.min(4, Math.max(0, h - 1))];
        // крытые туннели — затемняем
        if (map.isSolid(x, 5, z) || map.isSolid(x, 6, z)) {
          color = '#6e5f40';
        }
      }
      g.fillStyle = color;
      g.fillRect(x, z, 1, 1);
    }
    this._mmBg = bg;
  },

  // teammates: [{x, z, yaw, isMe, alive}]
  updateMinimap(mates) {
    const cv = $('minimap');
    if (!cv || !this._mmBg) return;
    const g = cv.getContext('2d');
    const sx = cv.width / this._mmW, sz = cv.height / this._mmD;
    g.clearRect(0, 0, cv.width, cv.height);
    g.drawImage(this._mmBg, 0, 0, cv.width, cv.height);
    for (const m of mates) {
      if (!m.alive) continue;
      const px = m.x * sx, pz = m.z * sz;
      if (m.isMe) {
        // свой маркер — белая стрелка по направлению взгляда
        const ang = Math.atan2(-Math.cos(m.yaw), -Math.sin(m.yaw));
        g.save();
        g.translate(px, pz);
        g.rotate(ang);
        g.fillStyle = '#ffffff';
        g.strokeStyle = '#000';
        g.lineWidth = 1;
        g.beginPath();
        g.moveTo(6, 0); g.lineTo(-4, 4); g.lineTo(-2, 0); g.lineTo(-4, -4);
        g.closePath();
        g.fill(); g.stroke();
        g.restore();
      } else {
        g.fillStyle = '#48d858';
        g.strokeStyle = '#083810';
        g.beginPath();
        g.arc(px, pz, 3.2, 0, Math.PI * 2);
        g.fill(); g.stroke();
      }
    }
  },

  show(id) {
    for (const s of document.querySelectorAll('.screen')) s.classList.add('hidden');
    if (id) $(id).classList.remove('hidden');
  },

  showHUD(on) { $('cs-hud').classList.toggle('hidden', !on); },

  setHp(hp) {
    $('hp-num').textContent = Math.max(0, Math.ceil(hp));
    $('cs-hp').classList.toggle('low', hp <= 30);
  },

  setAmmo(ws) {
    const el = $('cs-ammo');
    if (!ws) { el.style.visibility = 'hidden'; return; }
    el.style.visibility = 'visible';
    el.classList.toggle('reloading', ws.reloading);
    if (ws.def.melee) {
      $('ammo-num').textContent = '—';
      $('ammo-reserve').textContent = '';
    } else {
      $('ammo-num').textContent = ws.reloading ? '…' : ws.ammo;
      $('ammo-reserve').textContent = '/ ' + ws.reserve;
    }
    $('wpn-name').textContent = ws.def.name;
  },

  setTimer(sec, low) {
    const m = Math.floor(Math.max(0, sec) / 60);
    const s = Math.floor(Math.max(0, sec) % 60);
    $('round-timer').textContent = `${m}:${s.toString().padStart(2, '0')}`;
    $('round-timer').classList.toggle('low', !!low);
  },

  setScore(ct, t, roundNo, target) {
    $('score-ct').textContent = ct;
    $('score-t').textContent = t;
    $('round-num').textContent = `Раунд ${roundNo} · до ${target} побед`;
    $('sb-ct-score').textContent = ct;
    $('sb-t-score').textContent = t;
  },

  killfeed(killerName, killerTeam, victimName, victimTeam, wpnKey, hs) {
    const row = document.createElement('div');
    row.className = 'kf-row';
    const wpn = WEAPONS[wpnKey] ? WEAPONS[wpnKey].name : wpnKey;
    row.innerHTML = `<span class="${killerTeam}">${killerName}</span>` +
      `<span class="wpn">[${wpn}${hs ? ' <span class="hs">·голова</span>' : ''}]</span>` +
      `<span class="${victimTeam}">${victimName}</span>`;
    $('killfeed').prepend(row);
    setTimeout(() => row.remove(), 4500);
    while ($('killfeed').children.length > 5) $('killfeed').lastChild.remove();
  },

  // слоты оружия: 1 — ствол, 3 — нож
  setSlots(gunName, knifeActive) {
    const el = $('wpn-slots');
    if (!gunName) { el.classList.add('hidden'); return; }
    el.classList.remove('hidden');
    el.innerHTML =
      `<span class="${knifeActive ? '' : 'on'}">1 · ${gunName}</span>` +
      `<span class="${knifeActive ? 'on' : ''}">3 · Нож</span>` +
      `<span class="hint">колёсико — смена</span>`;
  },

  hsPopup() {
    const el = $('hs-pop');
    el.classList.remove('hidden');
    el.style.animation = 'none';
    void el.offsetWidth; // перезапуск CSS-анимации
    el.style.animation = '';
    clearTimeout(this._hsT);
    this._hsT = setTimeout(() => el.classList.add('hidden'), 700);
  },

  hitmarker(head) {
    const el = $('hitmarker');
    el.classList.toggle('head', !!head);
    el.style.opacity = 1;
    clearTimeout(this._hmT);
    this._hmT = setTimeout(() => { el.style.opacity = 0; }, 120);
  },

  damageFlash() {
    const el = $('cs-damage-overlay');
    el.style.opacity = 1;
    clearTimeout(this._dmT);
    this._dmT = setTimeout(() => { el.style.opacity = 0; }, 220);
  },

  banner(text, cls, ms = 2500) {
    const el = $('round-banner');
    el.textContent = text;
    el.className = cls || 'info';
    clearTimeout(this._bnT);
    if (ms) this._bnT = setTimeout(() => el.classList.add('hidden'), ms);
  },
  hideBanner() { $('round-banner').classList.add('hidden'); },

  setScope(on) {
    $('scope-overlay').classList.toggle('hidden', !on);
    $('cs-crosshair').classList.toggle('hidden', on);
  },

  setSpectate(text) {
    const el = $('spectate-label');
    if (!text) { el.classList.add('hidden'); return; }
    el.classList.remove('hidden');
    el.textContent = text;
  },

  setSelectTimer(sec) {
    $('select-timer').textContent = sec > 0 ? `Бой через ${Math.ceil(sec)}…` : '';
  },

  setRoomInfo(code, count) {
    const el = $('cs-room-info');
    if (!code) { el.classList.add('hidden'); return; }
    el.classList.remove('hidden');
    el.innerHTML = `Комната: <span class="code">${code}</span> · игроков: ${count}`;
  },

  setMpStatus(text) { $('cs-mp-status').textContent = text || ''; },

  // --- лобби ---
  renderLobby(roster, myId, isHost, cb) {
    // roster: [{id, name, team, bot, diff}]
    for (const team of ['ct', 't']) {
      const list = $(team + '-list');
      list.innerHTML = '';
      for (const p of roster.filter((r) => r.team === team)) {
        const row = document.createElement('div');
        row.className = 'team-row' + (p.id === myId ? ' me' : '');
        const label = document.createElement('span');
        label.innerHTML = p.name + (p.bot ? ` <span class="diff">${DIFFICULTIES[p.diff].label}</span>` : (p.id === myId ? ' <span class="diff">(ты)</span>' : ''));
        row.appendChild(label);
        if (p.bot && isHost) {
          const kick = document.createElement('button');
          kick.className = 'kick';
          kick.textContent = '✕';
          kick.title = 'Кикнуть бота';
          kick.onclick = () => cb.onKick(p.id);
          row.appendChild(kick);
        }
        list.appendChild(row);
      }
    }
    $('btn-add-ct').disabled = !isHost;
    $('btn-add-t').disabled = !isHost;
    $('btn-start-match').disabled = !isHost;
    $('cfg-target').disabled = !isHost;
    $('cfg-time').disabled = !isHost;
  },

  setLobbyRoom(text) { $('lobby-room').textContent = text || ''; },

  // --- таблица счёта ---
  renderScoreboard(roster, pawns, myId) {
    for (const team of ['ct', 't']) {
      const table = $('sb-' + team);
      table.innerHTML = '';
      const rows = roster.filter((r) => r.team === team);
      rows.sort((a, b) => (pawns.get(b.id)?.kills || 0) - (pawns.get(a.id)?.kills || 0));
      for (const r of rows) {
        const pw = pawns.get(r.id);
        const tr = document.createElement('tr');
        if (pw && !pw.alive) tr.className = 'dead';
        if (r.id === myId) tr.classList.add('me');
        tr.innerHTML = `<td>${r.name}${r.bot ? ' 🤖' : ''}</td>` +
          `<td class="num">${pw ? pw.kills : 0}</td><td class="num">${pw ? pw.deaths : 0}</td>` +
          `<td class="num">${pw && pw.alive ? pw.hp : '☠'}</td>`;
        table.appendChild(tr);
      }
    }
  },

  toggleScoreboard(on) { $('scoreboard').classList.toggle('hidden', !on); },

  hotWeaponCard(key) {
    for (const c of document.querySelectorAll('.wcard')) {
      c.classList.toggle('hot', c.dataset.wpn === key);
    }
  },
};
