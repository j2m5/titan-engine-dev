/**
 * CPU-зеркало `waterWaveNormal` (`src/core/materials/shaders/lib/
 * WaterShaderTemplate.ts`) — без текстурной выборки: вместо `getNoise` во
 * всех трёх проекциях подставлено СРЕДНЕЕ по всему ассету значение декода
 * (см. `MEAN_NOISE` — то же самое, что `getNoise` вернул бы, будь текстура
 * идеально однородной; честный представительный образец для проверки
 * ЗНАКОВОГО инварианта — «perturbed смотрит наружу, не внутрь», — не для
 * проверки конкретного узора ряби). Та же экономия, что у остальных
 * CPU-зеркал (`brownDwarfSurfaceMirror.ts`, `tauMirror.ts`): числовой тест
 * держит формулу честной без реального WebGL-контекста.
 *
 * ВАЖНО: менять `waterWaveNormalPerturbed` строго синхронно с
 * `waterWaveNormal` в `WaterShaderTemplate.ts` — расхождение здесь не
 * поймает ничего.
 */

export type Vec3 = readonly [number, number, number]

/**
 * Декод усреднённой карты нормалей ассета `waternormals.jpg` (замер `sharp`
 * .stats(): mean R/G/B = 127.04/126.99/250.51 из 255 → `2·mean/255 − 1`).
 * B-канал (несущая z-компонента) статистически смещён к сильно
 * положительному — источник блокера финального ревью №1 (см. докблок
 * `waterWaveNormal`): без знаковой поправки несущая компонента любой
 * проекции была бы ВСЕГДА положительна.
 */
export const MEAN_NOISE: Vec3 = [-0.0036, -0.004, 0.9648]

function sign(x: number): number {
  return x > 0 ? 1 : x < 0 ? -1 : 0
}

function normalize(v: Vec3): Vec3 {
  const len = Math.hypot(v[0], v[1], v[2])

  return len < 1e-9 ? [0, 0, 0] : [v[0] / len, v[1] / len, v[2] / len]
}

function triplanarWeights(dirLocal: Vec3): Vec3 {
  const [dx, dy, dz] = dirLocal
  const wx = Math.abs(dx)
  const wy = Math.abs(dy)
  const wz = Math.abs(dz)
  const sum = Math.max(wx + wy + wz, 1e-6)

  return [wx / sum, wy / sum, wz / sum]
}

function blend(fromX: Vec3, fromY: Vec3, fromZ: Vec3, w: Vec3): Vec3 {
  return [
    fromX[0] * w[0] + fromY[0] * w[1] + fromZ[0] * w[2],
    fromX[1] * w[0] + fromY[1] * w[1] + fromZ[1] * w[2],
    fromX[2] * w[0] + fromY[2] * w[1] + fromZ[2] * w[2]
  ]
}

/**
 * ИСТОРИЧЕСКАЯ версия ДО фикса блокера финального ревью №1 — несущая
 * компонента каждой проекции НЕ домножается на знак оси. Не используется
 * рантаймом: держится здесь только для регрессионного теста «RED на
 * прежнем коде» (WaterWaves.spec.ts) — если знаковую поправку когда-нибудь
 * случайно уберут из шейдера, разница между этой функцией и
 * `waterWaveNormalPerturbed` документирует, что именно сломается.
 */
export function waterWaveNormalWithoutSignFix(dirLocal: Vec3, noise: Vec3 = MEAN_NOISE): Vec3 {
  const w = triplanarWeights(dirLocal)
  const [nx, ny, nz] = noise

  const fromX: Vec3 = [nz * 1.0, ny * 1.5, nx * 1.5]
  const fromY: Vec3 = [nx * 1.5, nz * 1.0, ny * 1.5]
  const fromZ: Vec3 = [nx * 1.5, ny * 1.5, nz * 1.0]

  return normalize(blend(fromX, fromY, fromZ, w))
}

/**
 * Текущая (исправленная) версия — синхронна с рантаймовым GLSL. Несущая
 * компонента каждой реориентированной проекции домножена на
 * `sign(dirLocal.ось)`.
 */
export function waterWaveNormalPerturbed(dirLocal: Vec3, noise: Vec3 = MEAN_NOISE): Vec3 {
  const w = triplanarWeights(dirLocal)
  const [dx, dy, dz] = dirLocal
  const [nx, ny, nz] = noise
  const sx = sign(dx)
  const sy = sign(dy)
  const sz = sign(dz)

  const fromX: Vec3 = [nz * 1.0 * sx, ny * 1.5, nx * 1.5]
  const fromY: Vec3 = [nx * 1.5, nz * 1.0 * sy, ny * 1.5]
  const fromZ: Vec3 = [nx * 1.5, ny * 1.5, nz * 1.0 * sz]

  return normalize(blend(fromX, fromY, fromZ, w))
}

export function dot(a: Vec3, b: Vec3): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
}

export function angleDeg(a: Vec3, b: Vec3): number {
  return (Math.acos(Math.min(1, Math.max(-1, dot(a, b)))) * 180) / Math.PI
}

/** 8 диагоналей октантов единичной сферы — покрывают все комбинации знаков осей. */
export const OCTANT_DIRECTIONS: readonly [string, Vec3][] = (() => {
  const s = 1 / Math.sqrt(3)
  const signs = [1, -1]
  const out: [string, Vec3][] = []

  for (const sx of signs) {
    for (const sy of signs) {
      for (const sz of signs) {
        const name = `${sx > 0 ? '+X' : '-X'}${sy > 0 ? '+Y' : '-Y'}${sz > 0 ? '+Z' : '-Z'}`
        out.push([name, [sx * s, sy * s, sz * s]])
      }
    }
  }

  return out
})()
