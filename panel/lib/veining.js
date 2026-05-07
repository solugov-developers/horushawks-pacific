// Generates a deterministic SVG veining (marble) string from a seed.
// Usage: veining({ seed: 'home', w: 1200, h: 320, strokes: 5, color: '#94591E' })

function mulberry32(seed) {
  let t = seed >>> 0;
  return function() {
    t |= 0; t = (t + 0x6D2B79F5) | 0;
    let r = Math.imul(t ^ (t >>> 15), 1 | t);
    r = (r + Math.imul(r ^ (r >>> 7), 61 | r)) ^ r;
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

function hashStr(str) {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function veining({ seed = Date.now(), w = 1200, h = 320, strokes = 5, color = '#94591E' } = {}) {
  const s = typeof seed === 'string' ? hashStr(seed) : (seed >>> 0);
  const rng = mulberry32(s);
  const paths = [];
  for (let i = 0; i < strokes; i++) {
    const yBase = h * (0.1 + 0.8 * rng());
    const amp = 30 + 80 * rng();
    const segments = 4 + Math.floor(rng() * 3);
    let d = `M -20 ${yBase.toFixed(1)}`;
    for (let j = 1; j <= segments; j++) {
      const x1 = (w * (j - 0.5)) / segments;
      const x2 = (w * j) / segments;
      const y1 = yBase + (rng() - 0.5) * amp;
      const y2 = yBase + (rng() - 0.5) * amp;
      d += ` C ${x1.toFixed(1)} ${y1.toFixed(1)}, ${x2.toFixed(1)} ${y2.toFixed(1)}, ${(x2 + 20).toFixed(1)} ${y2.toFixed(1)}`;
    }
    const op = (0.18 + 0.45 * rng()).toFixed(2);
    const sw = (0.3 + 0.5 * rng()).toFixed(2);
    paths.push(`<path d="${d}" stroke="${color}" stroke-width="${sw}" fill="none" opacity="${op}" stroke-linecap="round"/>`);
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" preserveAspectRatio="none" aria-hidden="true">${paths.join('')}</svg>`;
}

module.exports = { veining };
