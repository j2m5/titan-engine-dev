export interface NoiseRange {
  min: number
  max: number
}

const mod289 = (x: number): number => x - Math.floor(x * (1 / 289)) * 289
const permute = (x: number): number => mod289((x * 34 + 1) * x)
const GRADIENTS = Array.from({ length: 289 }, (_, p) => {
  // Та же таблица octahedron/taylorInvSqrt, что в snoiseGrad3.
  const ns = 1 / 7
  const j = p - 49 * Math.floor(p * ns * ns)
  const ix = Math.floor(j * ns)
  const iy = Math.floor(j - 7 * ix)
  let x = ix * (ns * 2) + (ns * 0.5 - 1)
  let y = iy * (ns * 2) + (ns * 0.5 - 1)
  const z = 1 - Math.abs(x) - Math.abs(y)
  if (z <= 0) {
    x -= Math.floor(x) * 2 + 1
    y -= Math.floor(y) * 2 + 1
  }
  const norm = 1.79284291400159 - 0.85373472095314 * (x * x + y * y + z * z)
  return [x * norm, y * norm, z * norm] as const
})

const ORDERS = [
  [0, 1, 2],
  [0, 2, 1],
  [1, 0, 2],
  [1, 2, 0],
  [2, 0, 1],
  [2, 1, 0]
] as const
const OFFSETS = ORDERS.map((order) => [
  [0, 0, 0],
  [order[0] === 0 ? 1 : 0, order[0] === 1 ? 1 : 0, order[0] === 2 ? 1 : 0],
  [order[2] === 0 ? 0 : 1, order[2] === 1 ? 0 : 1, order[2] === 2 ? 0 : 1],
  [1, 1, 1]
])
// GLSL step на тройном равенстве выбирает именно эту вырожденную ветку.
OFFSETS.push([
  [0, 0, 0],
  [0, 0, 0],
  [1, 1, 1],
  [1, 1, 1]
])

/**
 * Диапазон неизменённого snoiseGrad3, включая разрывы между его ветками.
 * У фиксированной ветки |Hessian| < 240: используем 256 с запасом.
 * Поэтому Taylor: |f(q)-f(c)| <= |grad f(c)|r +128r². Перечисление
 * веток ограничено 8 skew-ячейками ×7; большой шар — грубый |noise|<3.6.
 * Доказательство и особая ветка равенства — в спецификации коллизий.
 */
export function simplexNoise3Bounds(x: number, y: number, z: number, radius: number, out: NoiseRange): NoiseRange {
  const rounding = 1e-12 * (1 + Math.abs(x) + Math.abs(y) + Math.abs(z))
  const r = radius + rounding
  if (!Number.isFinite(r) || r > 0.2 || Math.max(Math.abs(x), Math.abs(y), Math.abs(z)) > 1e9) {
    out.min = -3.6
    out.max = 3.6
    return out
  }
  const skew = (x + y + z) / 3
  const delta = Math.SQRT2 * r
  const ix0 = Math.floor(x + skew - delta),
    ix1 = Math.floor(x + skew + delta)
  const iy0 = Math.floor(y + skew - delta),
    iy1 = Math.floor(y + skew + delta)
  const iz0 = Math.floor(z + skew - delta),
    iz1 = Math.floor(z + skew + delta)
  out.min = Infinity
  out.max = -Infinity
  for (let iz = iz0; iz <= iz1; iz++)
    for (let iy = iy0; iy <= iy1; iy++)
      for (let ix = ix0; ix <= ix1; ix++) {
        const unskew = (ix + iy + iz) / 6
        const c = [x - ix + unskew, y - iy + unskew, z - iz + unskew]
        for (let branch = 0; branch < 7; branch++) {
          if (branch < 6) {
            const order = ORDERS[branch]
            if (c[order[0]] - c[order[1]] < -delta || c[order[1]] - c[order[2]] < -delta) continue
          } else if (Math.max(...c) - Math.min(...c) > delta) continue
          let value = 0,
            gx = 0,
            gy = 0,
            gz = 0
          for (let corner = 0; corner < 4; corner++) {
            const o = OFFSETS[branch][corner]
            const dx = c[0] - o[0] + corner / 6
            const dy = c[1] - o[1] + corner / 6
            const dz = c[2] - o[2] + corner / 6
            const m = Math.max(0.6 - (dx * dx + dy * dy + dz * dz), 0)
            if (m === 0) continue
            const hash = permute(permute(permute(mod289(iz) + o[2]) + mod289(iy) + o[1]) + mod289(ix) + o[0])
            const g = GRADIENTS[hash]
            const dot = g[0] * dx + g[1] * dy + g[2] * dz
            const m2 = m * m,
              m3 = m2 * m,
              m4 = m2 * m2
            value += m4 * dot
            gx += m4 * g[0] - 8 * m3 * dot * dx
            gy += m4 * g[1] - 8 * m3 * dot * dy
            gz += m4 * g[2] - 8 * m3 * dot * dz
          }
          value *= 42
          const error = 42 * Math.hypot(gx, gy, gz) * r + 128 * r * r + 1e-10
          out.min = Math.min(out.min, value - error)
          out.max = Math.max(out.max, value + error)
        }
      }
  return out
}
