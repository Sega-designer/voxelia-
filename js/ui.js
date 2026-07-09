// UI: меню, HUD, хотбар со стеками, рюкзак с drag&drop, режимы игры.
import { Settings, saveSettings } from './config.js';
import { BLOCKS, PLACEABLE, getIcon } from './blocks.js';
import { renderBindEditor } from './keybinds.js';

const $ = (id) => document.getElementById(id);
const STACK_MAX = 64;
const CREATIVE_HOTBAR = [1, 2, 3, 4, 5, 12, 6, 11, 13];

export class UI {
  constructor(callbacks) {
    // cb: { hasSave, onUiClick, onContinue, onNewWorld, onResume, onExit,
    //       onRespawn, onSettingsChanged, onCanvasClick, onTossItem, onModeSwitch }
    this.cb = callbacks;
    this.settingsReturn = 'main-menu';

    this.mode = 'creative';                        // 'creative' | 'survival'
    this.hotbar = CREATIVE_HOTBAR.map(id => ({ id, count: Infinity }));
    this.bag = new Array(18).fill(null);
    this.hotbarSel = 0;
    this.invOpen = false;
    this.drag = null;

    this.bindMenus();
    this.bindSettings();
    this.initDrag();
    this.renderHotbar();
    this.renderInventory();
    this.buildHearts(10, 10);
  }

  show(id) {
    for (const s of document.querySelectorAll('.screen')) s.classList.add('hidden');
    if (id) $(id).classList.remove('hidden');
  }

  showHUD(on) { $('hud').classList.toggle('hidden', !on); }

  bindMenus() {
    $('btn-play').onclick = () => { this.cb.onUiClick(); $('btn-continue').disabled = !this.cb.hasSave(); this.show('world-menu'); };
    $('btn-continue').onclick = () => { this.cb.onUiClick(); this.cb.onContinue(); };
    $('btn-newworld').onclick = () => { this.cb.onUiClick(); this.cb.onNewWorld($('seed-input').value.trim()); };
    $('btn-world-back').onclick = () => { this.cb.onUiClick(); this.show('main-menu'); };
    $('btn-mode').onclick = () => { this.cb.onUiClick(); this.cb.onModeToggleMenu(); };

    $('btn-mp').onclick = () => {
      this.cb.onUiClick();
      $('btn-mp-host-continue').disabled = !this.cb.hasSave();
      this.setMpStatus('');
      this.show('mp-menu');
    };
    $('btn-mp-back').onclick = () => { this.cb.onUiClick(); this.show('main-menu'); };
    $('btn-mp-mode').onclick = () => { this.cb.onUiClick(); this.cb.onModeToggleMenu(); };
    $('btn-mp-host-new').onclick = () => { this.cb.onUiClick(); this.cb.onHostNew(); };
    $('btn-mp-host-continue').onclick = () => { this.cb.onUiClick(); this.cb.onHostContinue(); };
    $('btn-mp-join').onclick = () => {
      this.cb.onUiClick();
      const code = $('mp-code').value.trim();
      if (code.length >= 3) this.cb.onJoin(code);
      else this.setMpStatus('Введите код комнаты');
    };

    $('btn-settings').onclick = () => { this.cb.onUiClick(); this.settingsReturn = 'main-menu'; this.show('settings-menu'); };
    $('btn-controls').onclick = () => { this.cb.onUiClick(); this.controlsReturn = 'main-menu'; this.show('controls-menu'); };
    $('btn-settings-back').onclick = () => { this.cb.onUiClick(); this.show(this.settingsReturn); };
    $('btn-controls-back').onclick = () => { this.cb.onUiClick(); this.show(this.controlsReturn || 'main-menu'); };

    $('btn-cs').onclick = () => { this.cb.onUiClick(); location.href = 'cs.html'; };
    $('btn-keys').onclick = () => {
      this.cb.onUiClick();
      renderBindEditor($('bind-editor'), ['common', 'sandbox']);
      this.show('keys-menu');
    };
    $('btn-keys-back').onclick = () => { this.cb.onUiClick(); this.show('settings-menu'); };

    $('btn-resume').onclick = () => { this.cb.onUiClick(); this.cb.onResume(); };
    $('btn-pause-settings').onclick = () => { this.cb.onUiClick(); this.settingsReturn = 'pause-menu'; this.show('settings-menu'); };
    $('btn-pause-controls').onclick = () => { this.cb.onUiClick(); this.controlsReturn = 'pause-menu'; this.show('controls-menu'); };
    $('btn-gamemode').onclick = () => { this.cb.onUiClick(); this.cb.onModeSwitch(); };
    $('btn-exit-menu').onclick = () => { this.cb.onUiClick(); this.cb.onExit(); };

    $('btn-respawn').onclick = () => { this.cb.onUiClick(); this.cb.onRespawn(); };
    $('btn-death-menu').onclick = () => { this.cb.onUiClick(); this.cb.onExit(); };

    $('click-to-play').onclick = () => this.cb.onCanvasClick();
  }

  bindSettings() {
    const sens = $('set-sens'), vol = $('set-vol'), dist = $('set-dist');
    const quality = $('set-quality'), shadows = $('set-shadows');

    sens.value = Settings.sensitivity;
    vol.value = Settings.volume;
    dist.value = Settings.renderDistance;
    quality.value = Settings.quality;
    shadows.checked = Settings.shadows;
    this.refreshSettingLabels();

    const apply = () => {
      Settings.sensitivity = parseFloat(sens.value);
      Settings.volume = parseFloat(vol.value);
      Settings.renderDistance = parseInt(dist.value);
      Settings.quality = quality.value;
      Settings.shadows = shadows.checked;
      this.refreshSettingLabels();
      saveSettings();
      this.cb.onSettingsChanged();
    };
    for (const el of [sens, vol, dist, quality, shadows]) el.oninput = apply;
  }

  refreshSettingLabels() {
    $('val-sens').textContent = Number(Settings.sensitivity).toFixed(1);
    $('val-vol').textContent = Math.round(Settings.volume * 100) + '%';
    $('val-dist').textContent = Settings.renderDistance;
  }

  // ---------- режимы ----------
  modeName(mode) { return mode === 'creative' ? 'Творческий' : 'Выживание'; }

  setMode(mode) {
    this.mode = mode;
    if (mode === 'survival') {
      // конечные стеки вместо бесконечных
      for (const arr of [this.hotbar, this.bag]) {
        arr.forEach(s => { if (s && !isFinite(s.count)) s.count = STACK_MAX; });
      }
    }
    $('btn-gamemode').textContent = 'Сменить режим на: ' + this.modeName(mode === 'creative' ? 'survival' : 'creative');
    this.renderHotbar();
    this.renderInventory();
    this.setHealthVisible(mode === 'survival');
  }

  resetInventory(mode) {
    this.bag = new Array(18).fill(null);
    this.hotbar = mode === 'creative'
      ? CREATIVE_HOTBAR.map(id => ({ id, count: Infinity }))
      : new Array(9).fill(null);
    this.hotbarSel = 0;
    this.setMode(mode);
  }

  setMenuModeLabel(mode) {
    $('btn-mode').textContent = 'Режим: ' + this.modeName(mode);
    $('btn-mp-mode').textContent = 'Режим: ' + this.modeName(mode);
  }

  setMpStatus(text) {
    $('mp-status').textContent = text || '';
  }

  setRoomInfo(code, count) {
    const el = $('room-info');
    if (!code) { el.classList.add('hidden'); return; }
    el.classList.remove('hidden');
    el.innerHTML = `Комната: <span class="code">${code}</span><br>Игроков: ${count}`;
  }

  // ---------- инвентарь: данные ----------
  selectedBlock() {
    const s = this.hotbar[this.hotbarSel];
    return s ? s.id : null;
  }

  // Съедает 1 предмет из выбранного слота при установке блока (в выживании)
  consumeSelected() {
    const s = this.hotbar[this.hotbarSel];
    if (!s) return false;
    if (this.mode === 'survival') {
      s.count--;
      if (s.count <= 0) this.hotbar[this.hotbarSel] = null;
      this.renderHotbar();
      if (this.invOpen) this.renderInventory();
    }
    return true;
  }

  // Забрать n предметов из выбранного слота (для выброса). Возвращает {id, count} или null.
  takeSelected(n = 1) {
    const s = this.hotbar[this.hotbarSel];
    if (!s) return null;
    if (this.mode === 'creative' || !isFinite(s.count)) return { id: s.id, count: n };
    const t = Math.min(n, s.count);
    s.count -= t;
    if (s.count <= 0) this.hotbar[this.hotbarSel] = null;
    this.renderHotbar();
    return { id: s.id, count: t };
  }

  // Добавить предметы в рюкзак. Возвращает, сколько поместилось.
  addItem(id, count) {
    if (this.mode === 'creative') return count; // в творческом дроп просто исчезает
    let left = count;
    const stackInto = (arr) => {
      for (const s of arr) {
        if (!left) return;
        if (s && s.id === id && isFinite(s.count) && s.count < STACK_MAX) {
          const t = Math.min(left, STACK_MAX - s.count);
          s.count += t; left -= t;
        }
      }
    };
    const emptyInto = (arr) => {
      for (let i = 0; i < arr.length; i++) {
        if (!left) return;
        if (!arr[i]) {
          const t = Math.min(left, STACK_MAX);
          arr[i] = { id, count: t }; left -= t;
        }
      }
    };
    stackInto(this.hotbar); stackInto(this.bag);
    emptyInto(this.hotbar); emptyInto(this.bag);
    const taken = count - left;
    if (taken > 0) {
      this.renderHotbar();
      if (this.invOpen) this.renderInventory();
    }
    return taken;
  }

  getInvData() {
    const ser = (arr) => arr.map(s => s ? { id: s.id, count: isFinite(s.count) ? s.count : -1 } : null);
    return { mode: this.mode, hotbar: ser(this.hotbar), bag: ser(this.bag), sel: this.hotbarSel };
  }

  loadInvData(data) {
    const de = (arr, n) => {
      const out = new Array(n).fill(null);
      if (Array.isArray(arr)) arr.forEach((s, i) => {
        if (s && i < n) out[i] = { id: s.id, count: s.count === -1 ? Infinity : s.count };
      });
      return out;
    };
    this.hotbar = de(data.hotbar, 9);
    this.bag = de(data.bag, 18);
    this.hotbarSel = data.sel || 0;
    this.setMode(data.mode === 'survival' ? 'survival' : 'creative');
  }

  // ---------- отрисовка ----------
  renderSlotContent(el, stack) {
    el.style.backgroundImage = stack ? `url(${getIcon(stack.id)})` : '';
    el.title = stack && BLOCKS[stack.id] ? BLOCKS[stack.id].name : '';
    const old = el.querySelector('.cnt');
    if (old) old.remove();
    if (stack && isFinite(stack.count) && stack.count > 1) {
      const c = document.createElement('span');
      c.className = 'cnt';
      c.textContent = stack.count;
      el.appendChild(c);
    }
  }

  renderHotbar() {
    const bar = $('hotbar');
    bar.innerHTML = '';
    this.hotbar.forEach((stack, i) => {
      const slot = document.createElement('div');
      slot.className = 'hslot' + (i === this.hotbarSel ? ' selected' : '');
      this.renderSlotContent(slot, stack);
      const num = document.createElement('span');
      num.className = 'num';
      num.textContent = i + 1;
      slot.appendChild(num);
      bar.appendChild(slot);
    });
  }

  renderInventory() {
    const grid = $('inv-grid');
    grid.innerHTML = '';
    const creative = this.mode === 'creative';
    $('inv-title').textContent = creative ? 'Блоки' : 'Рюкзак';
    $('inv-hint').textContent = creative
      ? 'Клик — в выбранный слот. Тащите блоки в хотбар. E / Esc — закрыть.'
      : 'Перетаскивайте предметы. Бросьте за окно — выкинуть. Q — выбросить блок из рук.';
    grid.classList.toggle('palette', creative);

    if (creative) {
      for (const id of PLACEABLE) {
        grid.appendChild(this.makeSlot('palette', id, { id, count: Infinity }));
      }
    } else {
      this.bag.forEach((s, i) => grid.appendChild(this.makeSlot('bag', i, s)));
    }

    const row = $('inv-hotbar-row');
    row.innerHTML = '';
    this.hotbar.forEach((s, i) => {
      const el = this.makeSlot('hotbar', i, s);
      if (i === this.hotbarSel) el.classList.add('selected');
      row.appendChild(el);
    });
  }

  makeSlot(zone, idx, stack) {
    const el = document.createElement('div');
    el.className = 'islot';
    el.dataset.zone = zone;
    el.dataset.idx = idx;
    this.renderSlotContent(el, stack);
    el.addEventListener('pointerdown', (e) => this.startDrag(zone, idx, e));
    return el;
  }

  selectHotbar(i) {
    this.hotbarSel = ((i % 9) + 9) % 9;
    this.renderHotbar();
    if (this.invOpen) this.renderInventory();
  }

  toggleInventory(open) {
    this.invOpen = open;
    $('inventory').classList.toggle('hidden', !open);
    if (open) this.renderInventory();
    else if (this.drag) this.cancelDrag();
  }

  // ---------- drag & drop ----------
  initDrag() {
    document.addEventListener('pointermove', (e) => {
      if (this.drag) this.moveGhost(e);
    });
    document.addEventListener('pointerup', (e) => {
      if (this.drag) this.endDrag(e);
    });
  }

  moveGhost(e) {
    const g = $('drag-ghost');
    g.style.left = (e.clientX - 22) + 'px';
    g.style.top = (e.clientY - 22) + 'px';
  }

  startDrag(zone, idx, e) {
    if (!this.invOpen || this.drag) return;
    e.preventDefault();
    let stack;
    if (zone === 'palette') {
      stack = { id: idx, count: Infinity };
    } else {
      const arr = zone === 'hotbar' ? this.hotbar : this.bag;
      stack = arr[idx];
      if (!stack) return;
      arr[idx] = null;
    }
    this.drag = { stack, zone, idx };
    const g = $('drag-ghost');
    g.style.display = 'block';
    g.style.backgroundImage = `url(${getIcon(stack.id)})`;
    this.moveGhost(e);
    this.renderHotbar();
    this.renderInventory();
  }

  cancelDrag() {
    if (!this.drag) return;
    this.returnToSource(this.drag);
    this.drag = null;
    $('drag-ghost').style.display = 'none';
    this.renderHotbar();
    this.renderInventory();
  }

  returnToSource(d) {
    if (d.zone === 'palette') return;
    const arr = d.zone === 'hotbar' ? this.hotbar : this.bag;
    if (!arr[d.idx]) { arr[d.idx] = d.stack; return; }
    // место занято — куда влезет, иначе выброс
    for (const a of [this.hotbar, this.bag]) {
      for (let i = 0; i < a.length; i++) {
        if (!a[i]) { a[i] = d.stack; return; }
      }
    }
    if (this.cb.onTossItem) this.cb.onTossItem(d.stack.id, isFinite(d.stack.count) ? d.stack.count : 1);
  }

  endDrag(e) {
    const d = this.drag;
    this.drag = null;
    $('drag-ghost').style.display = 'none';

    const el = document.elementFromPoint(e.clientX, e.clientY);
    const slot = el && el.closest ? el.closest('.islot') : null;
    const inPanel = el && el.closest ? el.closest('.inv-panel') : null;

    if (slot && slot.dataset.zone === 'palette') {
      if (d.zone === 'palette' && +slot.dataset.idx === d.idx) {
        // клик по палитре — положить в выбранный слот хотбара
        this.hotbar[this.hotbarSel] = { id: d.stack.id, count: Infinity };
      }
      // предмет, брошенный в палитру, исчезает (как в творческом режиме)
    } else if (slot) {
      const zone = slot.dataset.zone;
      const idx = +slot.dataset.idx;
      const arr = zone === 'hotbar' ? this.hotbar : this.bag;
      const target = arr[idx];
      if (!target) {
        arr[idx] = d.stack;
      } else if (target.id === d.stack.id && isFinite(target.count) && isFinite(d.stack.count)) {
        // объединение стеков
        const t = Math.min(d.stack.count, STACK_MAX - target.count);
        target.count += t;
        d.stack.count -= t;
        if (d.stack.count > 0) this.returnToSource(d);
      } else {
        // обмен местами
        arr[idx] = d.stack;
        this.returnToSource({ ...d, stack: target });
      }
    } else if (inPanel) {
      this.returnToSource(d); // отпустили внутри панели мимо слотов
    } else {
      // за пределами окна — выбрасываем в мир
      const n = isFinite(d.stack.count) ? d.stack.count : 1;
      if (this.cb.onTossItem) this.cb.onTossItem(d.stack.id, n);
    }

    this.renderHotbar();
    this.renderInventory();
  }

  // ---------- сердца и индикаторы ----------
  buildHearts(health, max) {
    const box = $('hearts');
    box.innerHTML = '';
    for (let i = 0; i < max; i++) {
      const h = document.createElement('span');
      h.className = 'heart';
      h.textContent = i < health ? '❤' : '🖤';
      box.appendChild(h);
    }
  }

  setHealthVisible(on) {
    $('hearts').style.display = on ? 'flex' : 'none';
  }

  setHealth(health, max) {
    if (this._lastHealth === health) return;
    this._lastHealth = health;
    this.buildHearts(health, max);
  }

  setLoadProgress(p) {
    $('loadbar-fill').style.width = Math.round(p * 100) + '%';
  }

  setBreakProgress(p) {
    const el = $('break-progress');
    el.classList.toggle('active', p > 0);
    $('break-fill').style.width = Math.round(p * 100) + '%';
  }

  flashDamage() {
    const el = $('damage-overlay');
    el.style.opacity = 1;
    setTimeout(() => { el.style.opacity = 0; }, 180);
  }

  setUnderwater(on) {
    $('underwater-overlay').style.opacity = on ? 1 : 0;
  }

  setLightning(v) {
    $('lightning-overlay').style.opacity = v * 0.8;
  }

  setDebug(text) {
    const el = $('debug-info');
    if (text === null) { el.classList.add('hidden'); return; }
    el.classList.remove('hidden');
    el.textContent = text;
  }
}
