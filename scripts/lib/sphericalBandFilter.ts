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
 * Размытие — гауссиана, приближённая тремя проходами скользящего
 * РАСШИРЕННОГО box-blur (каждый проход O(n) на любой радиус). Три прохода
 * суммируют дисперсии, так что целевая дисперсия одного прохода s = σ²/3.
 * Целый бокс радиуса m имеет дисперсию v_m = m(m+1)/3; берём m с
 * v_m ≤ s < v_{m+1} и добавляем крайние тапы ±(m+1) с весом
 * α = (2m+1)(s−v_m) / (2((m+1)²−s)) ∈ [0, 1) — дисперсия ядра ровно s,
 * ширина 2m+1+2α непрерывна по σ. Округление радиуса до целого давало
 * скачки ширины, а на карте — широтные швы там, где σ/cos φ пересекает
 * порог. Целый случай s = v_m даёт α = 0 — ровно целый бокс радиуса m.
 * При σ ≤ 0 проход — тождество.
 *
 * Отдельный экспорт `gaussianBlurSpherical` — то же размытие ТОЧНЫМ ядром,
 * для суб-текселных σ, где box-триплет — лишь грубое приближение гауссианы
 * (докблок функции).
 */

/**
 * Параметры одного прохода тройного расширенного бокса для std=σ: целый
 * радиус m и вес α крайних тапов ±(m+1) (формула в докблоке модуля).
 * Потолок: при m+α > maxRadius — целый бокс радиуса maxRadius.
 */
export function extendedBoxParams(sigmaTexels: number, maxRadius: number): { m: number; alpha: number } {
  if (!(sigmaTexels > 0)) return { m: 0, alpha: 0 }

  // в единицах 3·дисперсии: q = σ² = 3s, m(m+1) = 3·v_m
  const q = sigmaTexels * sigmaTexels
  let m = Math.floor((Math.sqrt(1 + 4 * q) - 1) / 2)

  // σ = ∞ или m за пределом точной целой арифметики — поиск m не сойдётся, только потолок
  if (!Number.isFinite(q) || m >= MAX_EXACT_BOX_RADIUS) {
    if (!Number.isFinite(maxRadius))
      throw new Error(`extendedBoxParams: σ=${sigmaTexels} без конечного потолка радиуса`)
    return { m: Math.max(0, Math.floor(maxRadius)), alpha: 0 }
  }
  // оценка m точна до ±1: заведомо выше потолка — сразу потолок
  if (m > maxRadius + 1) return { m: Math.max(0, Math.floor(maxRadius)), alpha: 0 }

  while (m > 0 && m * (m + 1) > q) m--
  while ((m + 1) * (m + 2) <= q) m++

  // σ = √(m(m+1)) теряет ulp при возведении в квадрат — прилипаем к целому боксу
  const eps = 1e-12 * Math.max(1, q)
  let alpha = 0
  if ((m + 1) * (m + 2) - q <= eps) m++
  else if (q - m * (m + 1) > eps) alpha = ((2 * m + 1) * (q - m * (m + 1))) / (2 * (3 * (m + 1) * (m + 1) - q))

  if (m + alpha > maxRadius) return { m: Math.max(0, Math.floor(maxRadius)), alpha: 0 }

  return { m, alpha }
}

/** Радиус, выше которого m·(m+1) уже не точен в double (2^50 < 2^53). */
const MAX_EXACT_BOX_RADIUS = 2 ** 25

/**
 * Проход расширенного бокса по кольцу src → dst длины n, O(n). Требует
 * m + 1 ≤ n (потолок width/4 это гарантирует): индексы выходят за кольцо
 * не дальше чем на n, поэтому заворот — одна поправка ±n.
 */
function boxPassWrap(src: Float64Array, dst: Float64Array, n: number, m: number, alpha: number): void {
  const norm = 2 * m + 1 + 2 * alpha

  let sum = 0
  for (let k = -m; k <= m; k++) sum += src[k < 0 ? k + n : k >= n ? k - n : k]

  for (let i = 0; i < n; i++) {
    let left = i - m - 1 // выбывает из окна и левый крайний тап
    if (left < 0) left += n
    let right = i + m + 1 // правый крайний тап
    if (right >= n) right -= n

    if (i > 0) {
      let add = i + m
      if (add >= n) add -= n
      sum += src[add] - src[left]
    }
    dst[i] = alpha > 0 ? (sum + alpha * (src[left] + src[right])) / norm : sum / norm
  }
}

/** Проход расширенного бокса src → dst длины n с клампом индексов на краях (полюса не заворачиваются), O(n). */
function boxPassClamp(src: Float64Array, dst: Float64Array, n: number, m: number, alpha: number): void {
  const last = n - 1
  const norm = 2 * m + 1 + 2 * alpha

  let sum = 0
  for (let k = -m; k <= m; k++) sum += src[k < 0 ? 0 : k > last ? last : k]

  for (let i = 0; i < n; i++) {
    const leftRaw = i - m - 1
    const left = leftRaw < 0 ? 0 : leftRaw
    const rightRaw = i + m + 1
    const right = rightRaw > last ? last : rightRaw

    if (i > 0) {
      const add = i + m
      sum += src[add > last ? last : add] - src[left]
    }
    dst[i] = alpha > 0 ? (sum + alpha * (src[left] + src[right])) / norm : sum / norm
  }
}

/** Три прохода расширенного бокса над buf (на месте), tmp — рабочий буфер той же длины. */
function tripleBox(
  buf: Float64Array,
  tmp: Float64Array,
  m: number,
  alpha: number,
  pass: (src: Float64Array, dst: Float64Array, n: number, m: number, alpha: number) => void
): void {
  if (m <= 0 && alpha <= 0) return
  const n = buf.length
  pass(buf, tmp, n, m, alpha)
  pass(tmp, buf, n, m, alpha)
  pass(buf, tmp, n, m, alpha)
  buf.set(tmp)
}

/**
 * Широта центра строки по полутексельной конвенции: y=0 — север, y=height−1 — юг
 * (см. dirToUv/heightMapFormat). Фильтру важен только |lat| (cos чётный), знак
 * полушария на математику не влияет.
 */
function rowLatitude(y: number, height: number): number {
  return Math.PI * ((y + 0.5) / height - 0.5)
}

/**
 * Гауссово (приближённое тройным box-blur) размытие эквиректангулярной карты
 * со std=σ в текселях экватора. EW честен по широте и заворачивает шов
 * долготы, NS константный и клампит полюса — детали в докблоке модуля.
 *
 * O(n) на любой радиус (в отличие от `gaussianBlurSpherical`, точного ядра
 * ценой O(n·σ)) — экспортирован отдельно от `bandPassSpherical` ради
 * высокочастотного фильтра elevation-входа (`buildElevationHeightField`,
 * `highPassSigmaTexels`): там нужен ОДИН блюр большого σ (сотни текселей),
 * а не разность двух — точное ядро на таком σ было бы неприемлемо медленным.
 */
export function blurSpherical(src: Float64Array, width: number, height: number, sigmaTexels: number): Float64Array {
  if (sigmaTexels <= 0) return src.slice()

  const maxRadius = Math.max(0, Math.floor(width / 4))

  // EW: три прохода на строку подряд — параметры (m, α) зависят от широты
  const out = src.slice()
  const row = new Float64Array(width)
  const rowTmp = new Float64Array(width)
  for (let y = 0; y < height; y++) {
    const cosLat = Math.cos(rowLatitude(y, height))
    const { m, alpha } = extendedBoxParams(sigmaTexels / cosLat, maxRadius)
    if (m <= 0 && alpha <= 0) continue
    row.set(out.subarray(y * width, y * width + width))
    tripleBox(row, rowTmp, m, alpha, boxPassWrap)
    out.set(row, y * width)
  }

  // NS: параметры константные (строки уже равномерны по углу), кламп индексов у полюсов
  const nsBox = extendedBoxParams(sigmaTexels, Number.POSITIVE_INFINITY)
  if (nsBox.m <= 0 && nsBox.alpha <= 0) return out
  const col = new Float64Array(height)
  const colTmp = new Float64Array(height)
  for (let x = 0; x < width; x++) {
    for (let y = 0; y < height; y++) col[y] = out[y * width + x]
    tripleBox(col, colTmp, nsBox.m, nsBox.alpha, boxPassClamp)
    for (let y = 0; y < height; y++) out[y * width + x] = col[y]
  }

  return out
}

/** Опора дискретного гауссова ядра — ±3σ (хвост за ней < 0.3% массы). */
const GAUSSIAN_SUPPORT_SIGMAS = 3

/** Нормированное дискретное гауссово ядро радиуса min(⌈3σ⌉, maxRadius). */
function gaussianKernel(sigmaTexels: number, maxRadius: number): Float64Array {
  const radius = Math.min(maxRadius, Math.max(1, Math.ceil(GAUSSIAN_SUPPORT_SIGMAS * sigmaTexels)))
  const kernel = new Float64Array(2 * radius + 1)
  let sum = 0

  for (let k = -radius; k <= radius; k++) {
    const weight = Math.exp(-(k * k) / (2 * sigmaTexels * sigmaTexels))
    kernel[k + radius] = weight
    sum += weight
  }
  for (let i = 0; i < kernel.length; i++) kernel[i] /= sum

  return kernel
}

/** Свёртка кольцевого (заворачивающегося) массива нормированным ядром. */
function convolveWrap(a: Float64Array, kernel: Float64Array): Float64Array {
  const n = a.length
  const radius = (kernel.length - 1) / 2
  const out = new Float64Array(n)

  for (let i = 0; i < n; i++) {
    let acc = 0
    for (let k = -radius; k <= radius; k++) acc += a[(((i + k) % n) + n) % n] * kernel[k + radius]
    out[i] = acc
  }

  return out
}

/** Свёртка массива нормированным ядром с клампом индексов на краях (полюса не заворачиваются). */
function convolveClamp(a: Float64Array, kernel: Float64Array): Float64Array {
  const n = a.length
  const radius = (kernel.length - 1) / 2
  const out = new Float64Array(n)

  for (let i = 0; i < n; i++) {
    let acc = 0
    for (let k = -radius; k <= radius; k++) acc += a[Math.max(0, Math.min(n - 1, i + k))] * kernel[k + radius]
    out[i] = acc
  }

  return out
}

/**
 * Гауссово размытие эквиректангулярной карты ТОЧНЫМ ядром (не box-триплетом),
 * σ — в текселях экватора. Конвенции те же, что у `bandPassSpherical`:
 * EW-радиус строки растёт как 1/cos(широты) (кламп ≤ width/4), долгота
 * заворачивается по шву; NS-радиус константный, индексы клампятся у полюсов.
 *
 * Почему не переиспользован box-триплет `blurSpherical`: на суб-текселных σ
 * (наш случай — срез 8-битных ступенек честной карты высот, σ≈0.7) его ядро —
 * три тапа на проход, совпадающее с гауссианой только по дисперсии. Прямая
 * свёртка стоит O(n·σ) — на суб-текселных σ это 7 отсчётов на ось, дешевле
 * трёх box-проходов; для КРУПНЫХ σ (полоса рельефа) остаётся box-триплет.
 */
export function gaussianBlurSpherical(
  src: Float64Array,
  width: number,
  height: number,
  sigmaTexels: number
): Float64Array {
  if (sigmaTexels <= 0) return src.slice()

  const maxRadius = Math.max(1, Math.floor(width / 4))

  // EW: своё ядро на строку — эффективная σ растёт как 1/cos(широты)
  const ew = new Float64Array(width * height)
  for (let y = 0; y < height; y++) {
    const cosLat = Math.cos(rowLatitude(y, height))
    const kernel = gaussianKernel(sigmaTexels / cosLat, maxRadius)
    ew.set(convolveWrap(src.subarray(y * width, y * width + width), kernel), y * width)
  }

  // NS: ядро одно на всю карту (строки равномерны по углу), кламп у полюсов
  const nsKernel = gaussianKernel(sigmaTexels, maxRadius)
  const out = new Float64Array(width * height)
  const col = new Float64Array(height)
  for (let x = 0; x < width; x++) {
    for (let y = 0; y < height; y++) col[y] = ew[y * width + x]
    const blurred = convolveClamp(col, nsKernel)
    for (let y = 0; y < height; y++) out[y * width + x] = blurred[y]
  }

  return out
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
