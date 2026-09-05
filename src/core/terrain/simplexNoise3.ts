/**
 * Порт GLSL `snoise(vec3)` из `src/core/materials/shaders/lib/chunks/Noise.ts`
 * (~строка 122, реализация Ashima Arts). Векторные операции разложены в скаляры
 * МЕХАНИЧЕСКИ — порядок, группировка и имена операций сохранены построчно.
 * Правки — ТОЛЬКО синхронно с чанком (референс-пин в tests/terrain/ProceduralSurfaceField.spec.ts
 * обязан упасть при любом расхождении формул CPU/GPU).
 */

// x - floor(x/289)*289. В чанке используется и как функция mod289(), и как
// GLSL mod(i, 289.0) для vec3 i — обе формы тождественны, здесь один хелпер.
function mod289(x: number): number {
  return x - Math.floor(x * (1.0 / 289.0)) * 289.0
}

function permute(x: number): number {
  return mod289(((x * 34.0) + 1.0) * x)
}

function taylorInvSqrt(r: number): number {
  return 1.79284291400159 - 0.85373472095314 * r
}

// GLSL step(edge, x): 0, если x < edge, иначе 1.
function step(edge: number, x: number): number {
  return x >= edge ? 1.0 : 0.0
}

export function simplexNoise3(vx: number, vy: number, vz: number): number {
  const C1 = 1.0 / 6.0
  const C2 = 1.0 / 3.0

  // First corner
  const s = (vx + vy + vz) * C2 // dot(v, C.yyy)
  let ix = Math.floor(vx + s)
  let iy = Math.floor(vy + s)
  let iz = Math.floor(vz + s)

  const t = (ix + iy + iz) * C1 // dot(i, C.xxx)
  const x0x = vx - ix + t
  const x0y = vy - iy + t
  const x0z = vz - iz + t

  // Other corners
  const gx = step(x0y, x0x) // g = step(x0.yzx, x0.xyz)
  const gy = step(x0z, x0y)
  const gz = step(x0x, x0z)
  const lx = 1.0 - gx // l = 1.0 - g
  const ly = 1.0 - gy
  const lz = 1.0 - gz

  const i1x = Math.min(gx, lz) // i1 = min(g.xyz, l.zxy)
  const i1y = Math.min(gy, lx)
  const i1z = Math.min(gz, ly)
  const i2x = Math.max(gx, lz) // i2 = max(g.xyz, l.zxy)
  const i2y = Math.max(gy, lx)
  const i2z = Math.max(gz, ly)

  const x1x = x0x - i1x + C1
  const x1y = x0y - i1y + C1
  const x1z = x0z - i1z + C1
  const x2x = x0x - i2x + 2.0 * C1
  const x2y = x0y - i2y + 2.0 * C1
  const x2z = x0z - i2z + 2.0 * C1
  const x3x = x0x - 1.0 + 3.0 * C1
  const x3y = x0y - 1.0 + 3.0 * C1
  const x3z = x0z - 1.0 + 3.0 * C1

  // Permutations
  ix = mod289(ix)
  iy = mod289(iy)
  iz = mod289(iz)

  const pA0 = iz + 0.0 // i.z + vec4(0.0, i1.z, i2.z, 1.0)
  const pA1 = iz + i1z
  const pA2 = iz + i2z
  const pA3 = iz + 1.0
  const p1_0 = permute(pA0)
  const p1_1 = permute(pA1)
  const p1_2 = permute(pA2)
  const p1_3 = permute(pA3)

  const pB0 = p1_0 + iy + 0.0 // + i.y + vec4(0.0, i1.y, i2.y, 1.0)
  const pB1 = p1_1 + iy + i1y
  const pB2 = p1_2 + iy + i2y
  const pB3 = p1_3 + iy + 1.0
  const p2_0 = permute(pB0)
  const p2_1 = permute(pB1)
  const p2_2 = permute(pB2)
  const p2_3 = permute(pB3)

  const pC0 = p2_0 + ix + 0.0 // + i.x + vec4(0.0, i1.x, i2.x, 1.0)
  const pC1 = p2_1 + ix + i1x
  const pC2 = p2_2 + ix + i2x
  const pC3 = p2_3 + ix + 1.0
  const p0v = permute(pC0) // vec4 p
  const p1v = permute(pC1)
  const p2v = permute(pC2)
  const p3v = permute(pC3)

  // Gradients: (N*N points uniformly over a square, mapped onto an octahedron.)
  const n_ = 1.0 / 7.0 // N=7
  const nsx = n_ * 2.0 - 0.0 // ns = n_*D.wyz - D.xzx, D = (0.0, 0.5, 1.0, 2.0)
  const nsy = n_ * 0.5 - 1.0
  const nsz = n_ * 1.0 - 0.0

  const j0 = p0v - 49.0 * Math.floor(p0v * nsz * nsz) // mod(p, N*N)
  const j1 = p1v - 49.0 * Math.floor(p1v * nsz * nsz)
  const j2 = p2v - 49.0 * Math.floor(p2v * nsz * nsz)
  const j3 = p3v - 49.0 * Math.floor(p3v * nsz * nsz)

  const x_0 = Math.floor(j0 * nsz)
  const x_1 = Math.floor(j1 * nsz)
  const x_2 = Math.floor(j2 * nsz)
  const x_3 = Math.floor(j3 * nsz)

  const y_0 = Math.floor(j0 - 7.0 * x_0) // mod(j, N)
  const y_1 = Math.floor(j1 - 7.0 * x_1)
  const y_2 = Math.floor(j2 - 7.0 * x_2)
  const y_3 = Math.floor(j3 - 7.0 * x_3)

  const gx0 = x_0 * nsx + nsy // x = x_*ns.x + ns.yyyy
  const gx1 = x_1 * nsx + nsy
  const gx2 = x_2 * nsx + nsy
  const gx3 = x_3 * nsx + nsy

  const gy0 = y_0 * nsx + nsy // y = y_*ns.x + ns.yyyy
  const gy1 = y_1 * nsx + nsy
  const gy2 = y_2 * nsx + nsy
  const gy3 = y_3 * nsx + nsy

  const h0 = 1.0 - Math.abs(gx0) - Math.abs(gy0)
  const h1 = 1.0 - Math.abs(gx1) - Math.abs(gy1)
  const h2 = 1.0 - Math.abs(gx2) - Math.abs(gy2)
  const h3 = 1.0 - Math.abs(gx3) - Math.abs(gy3)

  // b0 = vec4(x.xy, y.xy); b1 = vec4(x.zw, y.zw)
  const b0_0 = gx0
  const b0_1 = gx1
  const b0_2 = gy0
  const b0_3 = gy1
  const b1_0 = gx2
  const b1_1 = gx3
  const b1_2 = gy2
  const b1_3 = gy3

  const s0_0 = Math.floor(b0_0) * 2.0 + 1.0 // s0 = floor(b0)*2.0 + 1.0
  const s0_1 = Math.floor(b0_1) * 2.0 + 1.0
  const s0_2 = Math.floor(b0_2) * 2.0 + 1.0
  const s0_3 = Math.floor(b0_3) * 2.0 + 1.0
  const s1_0 = Math.floor(b1_0) * 2.0 + 1.0 // s1 = floor(b1)*2.0 + 1.0
  const s1_1 = Math.floor(b1_1) * 2.0 + 1.0
  const s1_2 = Math.floor(b1_2) * 2.0 + 1.0
  const s1_3 = Math.floor(b1_3) * 2.0 + 1.0

  const sh0 = -step(h0, 0.0) // sh = -step(h, vec4(0.0))
  const sh1 = -step(h1, 0.0)
  const sh2 = -step(h2, 0.0)
  const sh3 = -step(h3, 0.0)

  // a0 = b0.xzyw + s0.xzyw*sh.xxyy
  const a0_0 = b0_0 + s0_0 * sh0
  const a0_1 = b0_2 + s0_2 * sh0
  const a0_2 = b0_1 + s0_1 * sh1
  const a0_3 = b0_3 + s0_3 * sh1

  // a1 = b1.xzyw + s1.xzyw*sh.zzww
  const a1_0 = b1_0 + s1_0 * sh2
  const a1_1 = b1_2 + s1_2 * sh2
  const a1_2 = b1_1 + s1_1 * sh3
  const a1_3 = b1_3 + s1_3 * sh3

  // p0 = vec3(a0.xy, h.x); p1 = vec3(a0.zw, h.y); p2 = vec3(a1.xy, h.z); p3 = vec3(a1.zw, h.w)
  let p0x = a0_0, p0y = a0_1, p0z = h0
  let p1x = a0_2, p1y = a0_3, p1z = h1
  let p2x = a1_0, p2y = a1_1, p2z = h2
  let p3x = a1_2, p3y = a1_3, p3z = h3

  // Normalise gradients
  const norm0 = taylorInvSqrt(p0x * p0x + p0y * p0y + p0z * p0z)
  const norm1 = taylorInvSqrt(p1x * p1x + p1y * p1y + p1z * p1z)
  const norm2 = taylorInvSqrt(p2x * p2x + p2y * p2y + p2z * p2z)
  const norm3 = taylorInvSqrt(p3x * p3x + p3y * p3y + p3z * p3z)

  p0x *= norm0; p0y *= norm0; p0z *= norm0
  p1x *= norm1; p1y *= norm1; p1z *= norm1
  p2x *= norm2; p2y *= norm2; p2z *= norm2
  p3x *= norm3; p3y *= norm3; p3z *= norm3

  // Mix final noise value
  let m0 = Math.max(0.6 - (x0x * x0x + x0y * x0y + x0z * x0z), 0.0)
  let m1 = Math.max(0.6 - (x1x * x1x + x1y * x1y + x1z * x1z), 0.0)
  let m2 = Math.max(0.6 - (x2x * x2x + x2y * x2y + x2z * x2z), 0.0)
  let m3 = Math.max(0.6 - (x3x * x3x + x3y * x3y + x3z * x3z), 0.0)
  m0 *= m0; m1 *= m1; m2 *= m2; m3 *= m3

  const dot0 = p0x * x0x + p0y * x0y + p0z * x0z
  const dot1 = p1x * x1x + p1y * x1y + p1z * x1z
  const dot2 = p2x * x2x + p2y * x2y + p2z * x2z
  const dot3 = p3x * x3x + p3y * x3y + p3z * x3z

  return 42.0 * (m0 * m0 * dot0 + m1 * m1 * dot1 + m2 * m2 * dot2 + m3 * m3 * dot3)
}

export interface NoiseGrad3 {
  value: number
  dx: number
  dy: number
  dz: number
}

/**
 * snoise(vec3) + аналитический градиент — порт GLSL `snoiseGrad` (Noise.ts, ~строка 344).
 * value бит-в-бит равен simplexNoise3 (тот же код до m); градиент — формула
 * Ashima/Gustavson: 42·Σ( -8·m³·(p·x)·x + m⁴·p ) по четырём вершинам симплекса. Пишет в out.
 */
export function snoiseGrad3(vx: number, vy: number, vz: number, out: NoiseGrad3): NoiseGrad3 {
  const C1 = 1.0 / 6.0
  const C2 = 1.0 / 3.0

  // First corner
  const s = (vx + vy + vz) * C2 // dot(v, C.yyy)
  let ix = Math.floor(vx + s)
  let iy = Math.floor(vy + s)
  let iz = Math.floor(vz + s)

  const t = (ix + iy + iz) * C1 // dot(i, C.xxx)
  const x0x = vx - ix + t
  const x0y = vy - iy + t
  const x0z = vz - iz + t

  // Other corners
  const gx = step(x0y, x0x) // g = step(x0.yzx, x0.xyz)
  const gy = step(x0z, x0y)
  const gz = step(x0x, x0z)
  const lx = 1.0 - gx // l = 1.0 - g
  const ly = 1.0 - gy
  const lz = 1.0 - gz

  const i1x = Math.min(gx, lz) // i1 = min(g.xyz, l.zxy)
  const i1y = Math.min(gy, lx)
  const i1z = Math.min(gz, ly)
  const i2x = Math.max(gx, lz) // i2 = max(g.xyz, l.zxy)
  const i2y = Math.max(gy, lx)
  const i2z = Math.max(gz, ly)

  const x1x = x0x - i1x + C1
  const x1y = x0y - i1y + C1
  const x1z = x0z - i1z + C1
  const x2x = x0x - i2x + 2.0 * C1
  const x2y = x0y - i2y + 2.0 * C1
  const x2z = x0z - i2z + 2.0 * C1
  const x3x = x0x - 1.0 + 3.0 * C1
  const x3y = x0y - 1.0 + 3.0 * C1
  const x3z = x0z - 1.0 + 3.0 * C1

  // Permutations
  ix = mod289(ix)
  iy = mod289(iy)
  iz = mod289(iz)

  const pA0 = iz + 0.0 // i.z + vec4(0.0, i1.z, i2.z, 1.0)
  const pA1 = iz + i1z
  const pA2 = iz + i2z
  const pA3 = iz + 1.0
  const p1_0 = permute(pA0)
  const p1_1 = permute(pA1)
  const p1_2 = permute(pA2)
  const p1_3 = permute(pA3)

  const pB0 = p1_0 + iy + 0.0 // + i.y + vec4(0.0, i1.y, i2.y, 1.0)
  const pB1 = p1_1 + iy + i1y
  const pB2 = p1_2 + iy + i2y
  const pB3 = p1_3 + iy + 1.0
  const p2_0 = permute(pB0)
  const p2_1 = permute(pB1)
  const p2_2 = permute(pB2)
  const p2_3 = permute(pB3)

  const pC0 = p2_0 + ix + 0.0 // + i.x + vec4(0.0, i1.x, i2.x, 1.0)
  const pC1 = p2_1 + ix + i1x
  const pC2 = p2_2 + ix + i2x
  const pC3 = p2_3 + ix + 1.0
  const p0v = permute(pC0) // vec4 p
  const p1v = permute(pC1)
  const p2v = permute(pC2)
  const p3v = permute(pC3)

  // Gradients: (N*N points uniformly over a square, mapped onto an octahedron.)
  const n_ = 1.0 / 7.0 // N=7
  const nsx = n_ * 2.0 - 0.0 // ns = n_*D.wyz - D.xzx, D = (0.0, 0.5, 1.0, 2.0)
  const nsy = n_ * 0.5 - 1.0
  const nsz = n_ * 1.0 - 0.0

  const j0 = p0v - 49.0 * Math.floor(p0v * nsz * nsz) // mod(p, N*N)
  const j1 = p1v - 49.0 * Math.floor(p1v * nsz * nsz)
  const j2 = p2v - 49.0 * Math.floor(p2v * nsz * nsz)
  const j3 = p3v - 49.0 * Math.floor(p3v * nsz * nsz)

  const x_0 = Math.floor(j0 * nsz)
  const x_1 = Math.floor(j1 * nsz)
  const x_2 = Math.floor(j2 * nsz)
  const x_3 = Math.floor(j3 * nsz)

  const y_0 = Math.floor(j0 - 7.0 * x_0) // mod(j, N)
  const y_1 = Math.floor(j1 - 7.0 * x_1)
  const y_2 = Math.floor(j2 - 7.0 * x_2)
  const y_3 = Math.floor(j3 - 7.0 * x_3)

  const gx0 = x_0 * nsx + nsy // x = x_*ns.x + ns.yyyy
  const gx1 = x_1 * nsx + nsy
  const gx2 = x_2 * nsx + nsy
  const gx3 = x_3 * nsx + nsy

  const gy0 = y_0 * nsx + nsy // y = y_*ns.x + ns.yyyy
  const gy1 = y_1 * nsx + nsy
  const gy2 = y_2 * nsx + nsy
  const gy3 = y_3 * nsx + nsy

  const h0 = 1.0 - Math.abs(gx0) - Math.abs(gy0)
  const h1 = 1.0 - Math.abs(gx1) - Math.abs(gy1)
  const h2 = 1.0 - Math.abs(gx2) - Math.abs(gy2)
  const h3 = 1.0 - Math.abs(gx3) - Math.abs(gy3)

  // b0 = vec4(x.xy, y.xy); b1 = vec4(x.zw, y.zw)
  const b0_0 = gx0
  const b0_1 = gx1
  const b0_2 = gy0
  const b0_3 = gy1
  const b1_0 = gx2
  const b1_1 = gx3
  const b1_2 = gy2
  const b1_3 = gy3

  const s0_0 = Math.floor(b0_0) * 2.0 + 1.0 // s0 = floor(b0)*2.0 + 1.0
  const s0_1 = Math.floor(b0_1) * 2.0 + 1.0
  const s0_2 = Math.floor(b0_2) * 2.0 + 1.0
  const s0_3 = Math.floor(b0_3) * 2.0 + 1.0
  const s1_0 = Math.floor(b1_0) * 2.0 + 1.0 // s1 = floor(b1)*2.0 + 1.0
  const s1_1 = Math.floor(b1_1) * 2.0 + 1.0
  const s1_2 = Math.floor(b1_2) * 2.0 + 1.0
  const s1_3 = Math.floor(b1_3) * 2.0 + 1.0

  const sh0 = -step(h0, 0.0) // sh = -step(h, vec4(0.0))
  const sh1 = -step(h1, 0.0)
  const sh2 = -step(h2, 0.0)
  const sh3 = -step(h3, 0.0)

  // a0 = b0.xzyw + s0.xzyw*sh.xxyy
  const a0_0 = b0_0 + s0_0 * sh0
  const a0_1 = b0_2 + s0_2 * sh0
  const a0_2 = b0_1 + s0_1 * sh1
  const a0_3 = b0_3 + s0_3 * sh1

  // a1 = b1.xzyw + s1.xzyw*sh.zzww
  const a1_0 = b1_0 + s1_0 * sh2
  const a1_1 = b1_2 + s1_2 * sh2
  const a1_2 = b1_1 + s1_1 * sh3
  const a1_3 = b1_3 + s1_3 * sh3

  // p0 = vec3(a0.xy, h.x); p1 = vec3(a0.zw, h.y); p2 = vec3(a1.xy, h.z); p3 = vec3(a1.zw, h.w)
  let p0x = a0_0, p0y = a0_1, p0z = h0
  let p1x = a0_2, p1y = a0_3, p1z = h1
  let p2x = a1_0, p2y = a1_1, p2z = h2
  let p3x = a1_2, p3y = a1_3, p3z = h3

  // Normalise gradients
  const norm0 = taylorInvSqrt(p0x * p0x + p0y * p0y + p0z * p0z)
  const norm1 = taylorInvSqrt(p1x * p1x + p1y * p1y + p1z * p1z)
  const norm2 = taylorInvSqrt(p2x * p2x + p2y * p2y + p2z * p2z)
  const norm3 = taylorInvSqrt(p3x * p3x + p3y * p3y + p3z * p3z)

  p0x *= norm0; p0y *= norm0; p0z *= norm0
  p1x *= norm1; p1y *= norm1; p1z *= norm1
  p2x *= norm2; p2y *= norm2; p2z *= norm2
  p3x *= norm3; p3y *= norm3; p3z *= norm3

  // Mix final noise value
  const mu0 = Math.max(0.6 - (x0x * x0x + x0y * x0y + x0z * x0z), 0.0) // m (не в квадрате)
  const mu1 = Math.max(0.6 - (x1x * x1x + x1y * x1y + x1z * x1z), 0.0)
  const mu2 = Math.max(0.6 - (x2x * x2x + x2y * x2y + x2z * x2z), 0.0)
  const mu3 = Math.max(0.6 - (x3x * x3x + x3y * x3y + x3z * x3z), 0.0)
  const m0 = mu0 * mu0 // m^2 (GLSL m2)
  const m1 = mu1 * mu1
  const m2 = mu2 * mu2
  const m3 = mu3 * mu3

  const dot0 = p0x * x0x + p0y * x0y + p0z * x0z
  const dot1 = p1x * x1x + p1y * x1y + p1z * x1z
  const dot2 = p2x * x2x + p2y * x2y + p2z * x2z
  const dot3 = p3x * x3x + p3y * x3y + p3z * x3z

  out.value = 42.0 * (m0 * m0 * dot0 + m1 * m1 * dot1 + m2 * m2 * dot2 + m3 * m3 * dot3)

  // grad = 42·Σ [ -8·m^3·(p·x)·x  +  m^4·p ]; m^3 = m2·m = m0·mu0
  const temp0 = m0 * mu0 * dot0 // m^3·(p·x)
  const temp1 = m1 * mu1 * dot1
  const temp2 = m2 * mu2 * dot2
  const temp3 = m3 * mu3 * dot3

  out.dx = -8.0 * (temp0 * x0x + temp1 * x1x + temp2 * x2x + temp3 * x3x)
  out.dy = -8.0 * (temp0 * x0y + temp1 * x1y + temp2 * x2y + temp3 * x3y)
  out.dz = -8.0 * (temp0 * x0z + temp1 * x1z + temp2 * x2z + temp3 * x3z)

  out.dx += m0 * m0 * p0x + m1 * m1 * p1x + m2 * m2 * p2x + m3 * m3 * p3x
  out.dy += m0 * m0 * p0y + m1 * m1 * p1y + m2 * m2 * p2y + m3 * m3 * p3y
  out.dz += m0 * m0 * p0z + m1 * m1 * p1z + m2 * m2 * p2z + m3 * m3 * p3z

  out.dx *= 42.0
  out.dy *= 42.0
  out.dz *= 42.0

  return out
}
