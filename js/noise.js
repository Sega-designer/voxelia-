// Детерминированный шум (value noise 2D/3D + fBm) на основе сида.

export function mulberry32(a) {
  return function () {
    a |= 0; a = a + 0x6D2B79F5 | 0;
    let t = Math.imul(a ^ a >>> 15, 1 | a);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}

export function strToSeed(str) {
  let h = 0;
  for (let i = 0; i < str.length; i++) h = Math.imul(31, h) + str.charCodeAt(i) | 0;
  return h >>> 0;
}

// Быстрый целочисленный хеш координат -> [0,1). Для растительности, руды и т.п.
export function ihash(x, z, seed) {
  let h = Math.imul(x, 374761393) + Math.imul(z, 668265263) + (seed | 0);
  h = Math.imul(h ^ h >>> 13, 1274126177);
  return ((h ^ h >>> 16) >>> 0) / 4294967296;
}

export class Noise {
  constructor(seed) {
    const r = mulberry32(seed);
    const perm = new Uint8Array(256);
    for (let i = 0; i < 256; i++) perm[i] = i;
    for (let i = 255; i > 0; i--) {
      const j = (r() * (i + 1)) | 0;
      const t = perm[i]; perm[i] = perm[j]; perm[j] = t;
    }
    this.p = new Uint8Array(512);
    for (let i = 0; i < 512; i++) this.p[i] = perm[i & 255];
    this.v = new Float32Array(256);
    for (let i = 0; i < 256; i++) this.v[i] = r();
  }

  h2(x, y) { return this.v[this.p[this.p[x & 255] + (y & 255)]]; }
  h3(x, y, z) { return this.v[this.p[this.p[this.p[x & 255] + (y & 255)] + (z & 255)]]; }

  n2(x, y) {
    const xi = Math.floor(x), yi = Math.floor(y);
    const xf = x - xi, yf = y - yi;
    const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
    const a = this.h2(xi, yi), b = this.h2(xi + 1, yi);
    const c = this.h2(xi, yi + 1), d = this.h2(xi + 1, yi + 1);
    return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
  }

  n3(x, y, z) {
    const xi = Math.floor(x), yi = Math.floor(y), zi = Math.floor(z);
    const xf = x - xi, yf = y - yi, zf = z - zi;
    const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf), w = zf * zf * (3 - 2 * zf);
    const c000 = this.h3(xi, yi, zi),     c100 = this.h3(xi + 1, yi, zi);
    const c010 = this.h3(xi, yi + 1, zi), c110 = this.h3(xi + 1, yi + 1, zi);
    const c001 = this.h3(xi, yi, zi + 1),     c101 = this.h3(xi + 1, yi, zi + 1);
    const c011 = this.h3(xi, yi + 1, zi + 1), c111 = this.h3(xi + 1, yi + 1, zi + 1);
    const x00 = c000 + (c100 - c000) * u, x10 = c010 + (c110 - c010) * u;
    const x01 = c001 + (c101 - c001) * u, x11 = c011 + (c111 - c011) * u;
    const y0 = x00 + (x10 - x00) * v, y1 = x01 + (x11 - x01) * v;
    return y0 + (y1 - y0) * w;
  }

  fbm2(x, y, oct = 4, lac = 2, gain = 0.5) {
    let sum = 0, amp = 1, f = 1, tot = 0;
    for (let i = 0; i < oct; i++) {
      sum += this.n2(x * f, y * f) * amp;
      tot += amp; f *= lac; amp *= gain;
    }
    return sum / tot;
  }
}
