/**
 * Полосовой фильтр на эквиректангулярной карте: blur(σ_high) − blur(σ_low).
 * blur(σ_low) — низкочастотная часть (крупнее полосы), blur(σ_high) — почти
 * тождество (мельче полосы почти не режет); разность оставляет только полосу
 * между двумя масштабами (difference of Gaussians).
 *
 * σ задаются в ТЕКСЕЛЯХ ЭКВАТОРА. EW-проход (по долготе) честен по широте:
 * радиус окна строки масштабируется на 1/cos(широта), потому что на карте
 * фиксированной ширины дуга на тексель у полюса короче экваториальной
 * (см. тот же приём в slopeMapEncode.ts); кламп ≤ width/4 защищает от
 * вырождения радиуса в бесконечность у самого полюса, где cos → 0.
 * EW-проход заворачивает долготу по шву (x=0 == x=width). NS-проход
 * (по широте) — радиус константный: строки уже равномерны по углу, — и
 * клампит индексы у полюсов (без заворота: полюс не сшивается сам с собой).
 *
 * Размытие — гауссиана, приближённая тремя проходами скользящего box-blur
 * (каждый проход — O(n) на любой радиус через префиксную сумму окна).
 * Радиус одного box-окна для тройного прохода: три независимых box-блюра
 * ширины w=2r+1 суммируют дисперсии, σ² = 3·(w²−1)/12 = (w²−1)/4, откуда
 * w = √(4σ²+1), r = round((w−1)/2). При σ ≤ 0 радиус 0 — проход тождество.
 */

/** Радиус box-окна тройного прохода, приближающего гауссиану со std=σ (формула в докблоке модуля). */
function boxRadius(sigmaTexels: number): number {
  if (sigmaTexels <= 0) return 0

  const w = Math.sqrt(4 * sigmaTexels * sigmaTexels + 1)

  return Math.max(0, Math.round((w - 1) / 2))
}

/** Один box-проход по кольцевому (заворачивающемуся) массиву — скользящее окно, O(n). */
function boxBlurWrap(a: Float64Array, radius: number): Float64Array {
  const n = a.length
  if (radius <= 0) return a.slice()

  const windowSize = 2 * radius + 1
  const out = new Float64Array(n)

  let sum = 0
  for (let k = -radius; k <= radius; k++) sum += a[(k + n) % n]
  out[0] = sum / windowSize

  for (let i = 1; i < n; i++) {
    const addIdx = (i + radius) % n
    const removeIdx = (i - radius - 1 + n) % n
    sum += a[addIdx] - a[removeIdx]
    out[i] = sum / windowSize
  }

  return out
}

/** Один box-проход по массиву с клампом индексов на краях (полюса не заворачиваются), O(n). */
function boxBlurClamp(a: Float64Array, radius: number): Float64Array {
  const n = a.length
  if (radius <= 0) return a.slice()

  const clamp = (i: number): number => Math.max(0, Math.min(n - 1, i))
  const windowSize = 2 * radius + 1
  const out = new Float64Array(n)

  let sum = 0
  for (let k = -radius; k <= radius; k++) sum += a[clamp(k)]
  out[0] = sum / windowSize

  for (let i = 1; i < n; i++) {
    sum += a[clamp(i + radius)] - a[clamp(i - radius - 1)]
    out[i] = sum / windowSize
  }

  return out
}

/** Широта центра строки по полутексельной конвенции: y=0 — юг, y=height−1 — север. */
function rowLatitude(y: number, height: number): number {
  return Math.PI * ((y + 0.5) / height - 0.5)
}

/**
 * Гауссово (приближённое тройным box-blur) размытие эквиректангулярной карты
 * со std=σ в текселях экватора. EW честен по широте и заворачивает шов
 * долготы, NS константный и клампит полюса — детали в докблоке модуля.
 */
function blurSpherical(src: Float64Array, width: number, height: number, sigmaTexels: number): Float64Array {
  if (sigmaTexels <= 0) return src.slice()

  const maxRadius = Math.max(0, Math.floor(width / 4))

  // EW: радиус строки зависит от широты — считаем один раз на строку, три прохода переиспользуют его
  let ew = src.slice()
  const rowRadius = new Int32Array(height)
  for (let y = 0; y < height; y++) {
    const cosLat = Math.cos(rowLatitude(y, height))
    const effectiveSigma = sigmaTexels / cosLat
    rowRadius[y] = Math.min(maxRadius, boxRadius(effectiveSigma))
  }
  for (let pass = 0; pass < 3; pass++) {
    const next = new Float64Array(width * height)
    for (let y = 0; y < height; y++) {
      const row = ew.subarray(y * width, y * width + width)
      next.set(boxBlurWrap(row, rowRadius[y]), y * width)
    }
    ew = next
  }

  // NS: радиус константный (строки уже равномерны по углу), кламп индексов у полюсов
  const nsRadius = boxRadius(sigmaTexels)
  let ns = ew
  for (let pass = 0; pass < 3; pass++) {
    const next = new Float64Array(width * height)
    const col = new Float64Array(height)
    for (let x = 0; x < width; x++) {
      for (let y = 0; y < height; y++) col[y] = ns[y * width + x]
      const blurred = boxBlurClamp(col, nsRadius)
      for (let y = 0; y < height; y++) next[y * width + x] = blurred[y]
    }
    ns = next
  }

  return ns
}

/**
 * Разность размытий: blur(σ_high) − blur(σ_low). σ — в ТЕКСЕЛЯХ ЭКВАТОРА;
 * EW-радиус строки масштабируется 1/cos(широты) (кламп ≤ width/4), NS —
 * константный. EW — заворот по долготе, NS — кламп у полюсов. Размытие —
 * тройной скользящий box-blur (O(n) на любой радиус, приближение гауссианы).
 */
export function bandPassSpherical(
  src: Float64Array,
  width: number,
  height: number,
  sigmaLowTexels: number,
  sigmaHighTexels: number
): Float64Array {
  const low = blurSpherical(src, width, height, sigmaLowTexels)
  const high = blurSpherical(src, width, height, sigmaHighTexels)
  const out = new Float64Array(width * height)

  for (let i = 0; i < out.length; i++) out[i] = high[i] - low[i]

  return out
}
