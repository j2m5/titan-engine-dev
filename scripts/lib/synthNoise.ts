/**
 * Автономный сидированный шум оффлайн-скриптов — НЕ импортирует и не
 * переиспользует рантайм-шумы src/ (те живут в GLSL/рантайм-пайплайне и не
 * годятся для Node-скриптов; см. Global Constraints арки: «хеш-функции
 * проекта не менять»). Value noise (интерполяция значений в узлах решётки,
 * не градиентов, как у Перлина) — простой и достаточный базис для НЧ-подложки
 * тела без DEM.
 *
 * Хеш узла решётки — свой маленький finalizer-миксер на `Math.imul`: три
 * раунда «умножить на нечётную константу → ксор-сдвиг» дают лавинный эффект
 * (один бит входа переворачивает ~половину битов выхода) — стандартный приём
 * хеш-миксеров, реализация не скопирована из внешнего источника.
 *
 * Интерполяция — трилинейная по 8 узлам решётки с квинтик-фейдом Перлина
 * `fade(t)=6t^5−15t^4+10t^3` (а не кубический smoothstep `3t²−2t³`): фейд и
 * его производная нулевые на границах ячейки (t=0,1), поле C¹-непрерывно
 * (значение И первая производная совпадают на стыке ячеек) — это и даёт
 * аналитический бонд на градиент, использованный в спектральном тесте
 * подложки (см. `synthBaseField` ниже и `tests/scripts/synthNoise.spec.ts`):
 * `fade'(t) = 30t²(t−1)²`, максимум в t=0.5: `fade'(0.5) = 30·0.25·0.25 = 15/8`.
 */

/** Раунд finalizer-миксера: умножение на нечётную константу + ксор-сдвиг для лавинного перемешивания битов. */
function mix32(value: number, constant: number): number {
  let h = Math.imul(value ^ (value >>> 15), constant)
  h ^= h >>> 13

  return h
}

/** Детерминированный хеш целочисленного узла решётки (ix,iy,iz,seed) → беззнаковое 32-бит. */
function hashLatticeNode(ix: number, iy: number, iz: number, seed: number): number {
  let h = mix32(ix | 0, 0x27d4eb2f)
  h = mix32(h ^ (iy | 0), 0x85ebca6b)
  h = mix32(h ^ (iz | 0), 0xc2b2ae35)
  h = mix32(h ^ (seed | 0), 0x9e3779b1)

  return h >>> 0
}

/** Значение узла решётки в [-1, 1] — хеш узла, нормированный из [0, 2^32) линейно. */
function latticeValue(ix: number, iy: number, iz: number, seed: number): number {
  return (hashLatticeNode(ix, iy, iz, seed) / 0xffffffff) * 2 - 1
}

/** Квинтик-фейд Перлина: fade(0)=0, fade(1)=1, fade'(0)=fade'(1)=0 — C¹-непрерывность на стыке ячеек решётки. */
function fade(t: number): number {
  return t * t * t * (t * (t * 6 - 15) + 10)
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t
}

/**
 * Value noise в 3D, детерминирован по (x,y,z,seed), диапазон [−1,1]
 * (трилинейная интерполяция значений узлов решётки, каждое само в [−1,1] —
 * выпуклая комбинация не выходит за диапазон входов). Единица решётки — 1.0
 * по каждой оси; частота волны задаётся масштабом входных координат вызывающим
 * кодом (см. `synthBaseField`).
 */
export function synthValueNoise3(x: number, y: number, z: number, seed: number): number {
  const x0 = Math.floor(x)
  const y0 = Math.floor(y)
  const z0 = Math.floor(z)
  const fx = fade(x - x0)
  const fy = fade(y - y0)
  const fz = fade(z - z0)

  const h000 = latticeValue(x0, y0, z0, seed)
  const h100 = latticeValue(x0 + 1, y0, z0, seed)
  const h010 = latticeValue(x0, y0 + 1, z0, seed)
  const h110 = latticeValue(x0 + 1, y0 + 1, z0, seed)
  const h001 = latticeValue(x0, y0, z0 + 1, seed)
  const h101 = latticeValue(x0 + 1, y0, z0 + 1, seed)
  const h011 = latticeValue(x0, y0 + 1, z0 + 1, seed)
  const h111 = latticeValue(x0 + 1, y0 + 1, z0 + 1, seed)

  const x00 = lerp(h000, h100, fx)
  const x10 = lerp(h010, h110, fx)
  const x01 = lerp(h001, h101, fx)
  const x11 = lerp(h011, h111, fx)

  const y0v = lerp(x00, x10, fy)
  const y1v = lerp(x01, x11, fy)

  return lerp(y0v, y1v, fz)
}

/** Смещение сида на октаву: разные октавы должны сэмплировать НЕЗАВИСИМЫЕ узлы решётки, не только другую частоту. */
function octaveSeed(seed: number, octave: number): number {
  return (seed ^ Math.imul(octave + 1, 0x9e3779b1)) | 0
}

/**
 * Подложка тела: сумма `octaves` октав `synthValueNoise3`, сэмплированных на
 * единичной сфере в направлении (dirX,dirY,dirZ) (нормализация — забота
 * вызывающего кода). Волны от λ0=2π/baseFrequency (в радианах на единичной
 * сфере), частоты кратны 2 (`freq_o = baseFrequency·2^o`), амплитуды —
 * геометрическая прогрессия с коэффициентом 0.5 (`amp_o = amp0·0.5^o`),
 * нормированная так, что Σamp_o = 1 — это гарантирует |synthBaseField| ≤ 1
 * ВСЕГДА (выпуклая комбинация значений в [-1,1] с весами, суммирующимися
 * в 1), независимо от octaves; калибровка физического размаха — забота
 * вызывающего кода (домножение на амплитуду в метрах).
 *
 * `amp0 = 1 / (2·(1 − 0.5^octaves))` — сумма геометрической прогрессии
 * `Σ_{o=0}^{octaves−1} 0.5^o = 2·(1 − 0.5^octaves)`, нормировочный множитель —
 * обратная величина.
 */
export function synthBaseField(
  dirX: number,
  dirY: number,
  dirZ: number,
  seed: number,
  octaves: number,
  baseFrequency: number
): number {
  const totalWeight = 2 * (1 - Math.pow(0.5, octaves))
  const amp0 = 1 / totalWeight

  let sum = 0
  let amplitude = amp0
  let frequency = baseFrequency

  for (let o = 0; o < octaves; o++) {
    sum += amplitude * synthValueNoise3(dirX * frequency, dirY * frequency, dirZ * frequency, octaveSeed(seed, o))
    amplitude *= 0.5
    frequency *= 2
  }

  return sum
}
