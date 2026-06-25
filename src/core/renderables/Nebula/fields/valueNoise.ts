export function hash3(x: number, y: number, z: number, seed: number): number {
  let h = (seed | 0) ^ 0x9e3779b9
  h = Math.imul(h ^ Math.floor(x * 374761393), 0x85ebca6b)
  h = Math.imul(h ^ Math.floor(y * 668265263), 0xc2b2ae35)
  h = Math.imul(h ^ Math.floor(z * 2246822519), 0x27d4eb2f)
  h ^= h >>> 15
  return (h >>> 0) / 4294967296
}

function smooth(t: number): number {
  return t * t * t * (t * (t * 6 - 15) + 10)
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t
}

export function valueNoise3(x: number, y: number, z: number, seed: number): number {
  const xi = Math.floor(x)
  const yi = Math.floor(y)
  const zi = Math.floor(z)
  const xf = x - xi
  const yf = y - yi
  const zf = z - zi
  const u = smooth(xf)
  const v = smooth(yf)
  const w = smooth(zf)

  const c000 = hash3(xi, yi, zi, seed)
  const c100 = hash3(xi + 1, yi, zi, seed)
  const c010 = hash3(xi, yi + 1, zi, seed)
  const c110 = hash3(xi + 1, yi + 1, zi, seed)
  const c001 = hash3(xi, yi, zi + 1, seed)
  const c101 = hash3(xi + 1, yi, zi + 1, seed)
  const c011 = hash3(xi, yi + 1, zi + 1, seed)
  const c111 = hash3(xi + 1, yi + 1, zi + 1, seed)

  const x00 = lerp(c000, c100, u)
  const x10 = lerp(c010, c110, u)
  const x01 = lerp(c001, c101, u)
  const x11 = lerp(c011, c111, u)
  const y0 = lerp(x00, x10, v)
  const y1 = lerp(x01, x11, v)
  return lerp(y0, y1, w) * 2 - 1
}

export function fbm3(
  p: { x: number; y: number; z: number },
  seed: number,
  octaves: number,
  lacunarity: number,
  gain: number
): number {
  let sum = 0
  let amp = 0.5
  let freq = 1
  let norm = 0
  for (let i = 0; i < octaves; i++) {
    sum += amp * valueNoise3(p.x * freq, p.y * freq, p.z * freq, seed + i * 1013)
    norm += amp
    amp *= gain
    freq *= lacunarity
  }
  return norm > 0 ? sum / norm : 0
}
