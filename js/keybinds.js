// Переназначаемые клавиши управления (общие для песочницы и Блок-Страйка).
const KEY = 'voxelia_binds_v1';

export const BIND_DEFS = [
  // общие
  { id: 'forward',   label: 'Вперёд',              def: 'KeyW',        scope: 'common' },
  { id: 'back',      label: 'Назад',               def: 'KeyS',        scope: 'common' },
  { id: 'left',      label: 'Влево',               def: 'KeyA',        scope: 'common' },
  { id: 'right',     label: 'Вправо',              def: 'KeyD',        scope: 'common' },
  { id: 'jump',      label: 'Прыжок',              def: 'Space',       scope: 'common' },
  { id: 'crouch',    label: 'Присесть',            def: 'ControlLeft', scope: 'common' },
  { id: 'sprint',    label: 'Бег / тихий шаг',     def: 'ShiftLeft',   scope: 'common' },
  // песочница
  { id: 'inventory', label: 'Рюкзак',              def: 'KeyE',        scope: 'sandbox' },
  { id: 'drop',      label: 'Выбросить предмет',   def: 'KeyQ',        scope: 'sandbox' },
  { id: 'camera',    label: 'Смена камеры',        def: 'F5',          scope: 'sandbox' },
  // блок-страйк
  { id: 'reload',    label: 'Перезарядка',         def: 'KeyR',        scope: 'cs' },
  { id: 'buy',       label: 'Выбор оружия',        def: 'KeyB',        scope: 'cs' },
  { id: 'scoreboard',label: 'Таблица счёта',       def: 'Tab',         scope: 'cs' },
];

export const Binds = {};

export function loadBinds() {
  for (const d of BIND_DEFS) Binds[d.id] = d.def;
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const saved = JSON.parse(raw);
      for (const d of BIND_DEFS) {
        if (typeof saved[d.id] === 'string' && saved[d.id]) Binds[d.id] = saved[d.id];
      }
    }
  } catch (e) {}
}

export function saveBinds() {
  try { localStorage.setItem(KEY, JSON.stringify(Binds)); } catch (e) {}
}

export function setBind(id, code) {
  // клавиша может быть только у одного действия
  for (const d of BIND_DEFS) {
    if (d.id !== id && Binds[d.id] === code) Binds[d.id] = '';
  }
  Binds[id] = code;
  saveBinds();
}

const CODE_LABELS = {
  Space: 'Пробел', ControlLeft: 'Ctrl', ControlRight: 'Ctrl (пр.)',
  ShiftLeft: 'Shift', ShiftRight: 'Shift (пр.)', AltLeft: 'Alt', AltRight: 'Alt (пр.)',
  Tab: 'Tab', Enter: 'Enter', Backspace: 'Backspace', CapsLock: 'CapsLock',
  ArrowUp: '↑', ArrowDown: '↓', ArrowLeft: '←', ArrowRight: '→',
  Backquote: '`', Minus: '-', Equal: '=', BracketLeft: '[', BracketRight: ']',
  Semicolon: ';', Quote: "'", Comma: ',', Period: '.', Slash: '/', Backslash: '\\',
};

export function labelForCode(code) {
  if (!code) return '—';
  if (CODE_LABELS[code]) return CODE_LABELS[code];
  if (code.startsWith('Key')) return code.slice(3);
  if (code.startsWith('Digit')) return code.slice(5);
  if (code.startsWith('Numpad')) return 'Num ' + code.slice(6);
  return code;
}

// --- редактор клавиш ---
// Одно состояние захвата и один глобальный слушатель на модуль.
let captureState = null; // { id, btn, container, scopes }

document.addEventListener('keydown', (e) => {
  if (!captureState) return;
  e.preventDefault();
  e.stopPropagation();
  const { id, container, scopes } = captureState;
  captureState = null;
  if (e.code !== 'Escape') setBind(id, e.code);
  // перерисовываем: клавиша могла сняться с другого действия
  renderBindEditor(container, scopes);
}, { capture: true });

export function isCapturingBind() { return captureState !== null; }

// Рендер редактора клавиш в контейнер. scopes — какие группы показывать.
export function renderBindEditor(container, scopes) {
  container.innerHTML = '';
  captureState = null;

  for (const d of BIND_DEFS) {
    if (!scopes.includes(d.scope)) continue;
    const row = document.createElement('div');
    row.className = 'bind-row';
    const name = document.createElement('span');
    name.textContent = d.label;
    const btn = document.createElement('button');
    btn.className = 'bind-btn';
    btn.dataset.bind = d.id;
    btn.textContent = labelForCode(Binds[d.id]);
    btn.onclick = () => {
      // сбрасываем визуал предыдущего захвата без пересоздания DOM
      for (const b of container.querySelectorAll('.bind-btn')) {
        b.textContent = labelForCode(Binds[b.dataset.bind]);
        b.classList.remove('capturing');
      }
      captureState = { id: d.id, btn, container, scopes };
      btn.textContent = 'нажми клавишу…';
      btn.classList.add('capturing');
    };
    row.append(name, btn);
    container.appendChild(row);
  }
}
