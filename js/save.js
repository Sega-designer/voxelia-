// Сохранение мира в localStorage: сид, позиция игрока, изменённые блоки, время суток.
const WORLD_KEY = 'voxelia_world_v1';

export const SaveSys = {
  hasSave() {
    return localStorage.getItem(WORLD_KEY) !== null;
  },

  save(world, player, sky, invData) {
    try {
      const data = {
        seed: world.seed,
        time: sky.time,
        player: {
          x: player.pos.x, y: player.pos.y, z: player.pos.z,
          yaw: player.yaw, pitch: player.pitch,
          health: player.health,
        },
        inv: invData, // режим, хотбар и рюкзак со стеками
        modified: world.getModifiedForSave(),
      };
      localStorage.setItem(WORLD_KEY, JSON.stringify(data));
      return true;
    } catch (e) {
      console.warn('Не удалось сохранить мир:', e);
      return false;
    }
  },

  load() {
    try {
      const raw = localStorage.getItem(WORLD_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch (e) {
      return null;
    }
  },

  clear() {
    localStorage.removeItem(WORLD_KEY);
  },
};
