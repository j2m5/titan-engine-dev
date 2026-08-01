// Зеркало GLSL-функции getRingShine (chunks/RingShine.ts) на CPU: те же
// формулы, чтобы геометрию можно было проверять числами без GPU.
// При правке шейдера править и здесь — тесты сверяют поведение, не текст.

export interface Vec3 {
  x: number
  y: number
  z: number
}

export const RING_SHINE_SAMPLES = 4

const dot = (a: Vec3, b: Vec3): number => a.x * b.x + a.y * b.y + a.z * b.z
const len = (a: Vec3): number => Math.sqrt(dot(a, a))
const sub = (a: Vec3, b: Vec3): Vec3 => ({ x: a.x - b.x, y: a.y - b.y, z: a.z - b.z })
const scale = (a: Vec3, k: number): Vec3 => ({ x: a.x * k, y: a.y * k, z: a.z * k })

export function shadowFromSphere(lightDir: Vec3, pos: Vec3, planetRadius: number): number {
  const l = len(lightDir)
  const sunDir = scale(lightDir, 1 / l)
  const pDotL = dot(pos, sunDir)
  if (pDotL <= 0) return 1

  const perp = Math.sqrt(Math.max(dot(pos, pos) - pDotL * pDotL, 0))
  const penumbra = planetRadius * 0.08
  const t = Math.min(Math.max((perp - planetRadius) / penumbra, 0), 1)
  const shade = t * t * (3 - 2 * t)

  return 0.04 + (1 - 0.04) * shade
}

/**
 * Сумма вклада колец в точке поверхности. `ringTexel(t)` отдаёт яркость и
 * покрытие полосы кольца в долевой координате t ∈ [0,1] (rgb уже умножен на a).
 */
export function ringShineSum(
  nLocal: Vec3,
  posLocal: Vec3,
  lightDirLocal: Vec3,
  planetRadius: number,
  innerRadius: number,
  outerRadius: number,
  ringTexel: (t: number) => number,
  strength: number
): number {
  const azimuth: Vec3 = { x: posLocal.x, y: 0, z: posLocal.z }
  const azimuthLen = len(azimuth)
  if (azimuthLen < 1e-6) return 0

  const dir = scale(azimuth, 1 / azimuthLen)
  let sum = 0

  for (let i = 0; i < RING_SHINE_SAMPLES; i++) {
    const t = (i + 0.5) / RING_SHINE_SAMPLES
    const r = innerRadius + (outerRadius - innerRadius) * t
    const ringPos = scale(dir, r)

    const toRing = sub(ringPos, posLocal)
    const dist = Math.max(len(toRing), 1e-6)
    const d = scale(toRing, 1 / dist)

    const cosReceiver = Math.max(dot(nLocal, d), 0)
    const faceFactor = Math.abs(d.y)
    const lit = shadowFromSphere(lightDirLocal, ringPos, planetRadius)

    sum += ringTexel(t) * lit * cosReceiver * faceFactor
  }

  return (sum * strength) / RING_SHINE_SAMPLES
}
