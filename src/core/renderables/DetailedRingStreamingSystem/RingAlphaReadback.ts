import type { Texture } from 'three'
import { RadialDensityProfile } from './RadialDensityProfile'
import type { RingGap } from './ringMoonlets'
import { ringBandBinsFromPixels, thresholdBlurAndMask } from './ringProfileBins'

/**
 * Максимум радиальных бинов профиля. Больше не нужно: сектора шириной в сотни
 * бинов усредняют профиль, а семплинг радиуса всё равно бьётся о разрешение
 * исходной текстуры.
 */
const MAX_PROFILE_BINS = 1024

/** Опции постобработки профиля альфы */
interface RingAlphaProfileOptions {
  /**
   * Альфа не выше порога считается пустотой (семантика alphaTest 2D-кольца:
   * гейт камней резал такие радиусы, теперь их вырезает сам профиль).
   */
  alphaTest?: number
  /**
   * Сигма гауссова размытия профиля в единицах радиуса. Смягчает кромки
   * субколец и позволяет камням чуть выходить за текстурное субкольцо
   * (против «астероидных заборов» на высокой плотности). 0 — резкие кромки.
   */
  blurRadius?: number
  /**
   * Щели лунок (в единицах radius): альфа бинов × маска щели до порога и
   * после размытия — щель пустеет в камнях, пыли и полосах (RGB полос не
   * маскируется; см. ringProfileBins.ts и ringMoonlets.ts).
   */
  gaps?: readonly RingGap[]
}

/** Изображение, которое можно нарисовать в 2D-canvas и прочитать обратно */
const isReadableImage = (image: unknown): image is CanvasImageSource & { width: number; height: number } => {
  if (typeof image !== 'object' || image === null) return false
  const { width, height } = image as { width?: unknown; height?: unknown }

  return typeof width === 'number' && width > 0 && typeof height === 'number' && height > 0
}

/**
 * Прочитать радиальный профиль альфы из текстуры 2D-кольца (A-lite readback).
 *
 * Маппинг тот же, что у RingShader и B-гейта камней: u = (r − inner) / (outer − inner),
 * т.е. колонка x текстуры ↔ радиус. Строки усредняются даунскейлом canvas до
 * высоты 1 (у радиальной полосы кольца они и так одинаковы), альфа-канал
 * колонок становится бинами профиля. Текстуры без альфы (jpg) дают α ≡ 1 —
 * профиль равномерный, поведение не меняется.
 *
 * Постобработка (см. RingAlphaProfileOptions, ringProfileBins.ts): маска щелей,
 * отсечка по alphaTest, гауссово размытие кромок субколец, снова маска щелей.
 *
 * Возвращает null, если изображение нечитаемо (compressed-текстура, отсутствие
 * 2D-контекста, CORS-tainted canvas) — вызывающий остаётся на равномерной
 * плотности с B-гейтом, визуал корректен.
 */
/**
 * Прочитать RGBA-колонки текстуры кольца, усреднённые по строкам (даунскейл
 * canvas до высоты 1). null — текстура нечитаема (см. readRingAlphaBins).
 */
function readRingPixels(texture: Texture, innerRadius: number, outerRadius: number): { pixels: Uint8ClampedArray; bins: number } | null {
  if (!(outerRadius > innerRadius)) return null

  // CompressedTexture (ktx2 и т.п.): mipmap-данные не рисуются в canvas
  if ((texture as { isCompressedTexture?: boolean }).isCompressedTexture) return null

  const image: unknown = texture.image
  if (!isReadableImage(image)) return null

  const bins = Math.min(image.width, MAX_PROFILE_BINS)

  try {
    const canvas = document.createElement('canvas')
    canvas.width = bins
    canvas.height = 1
    const context = canvas.getContext('2d', { willReadFrequently: true })
    if (!context) return null

    context.clearRect(0, 0, bins, 1)
    context.drawImage(image, 0, 0, bins, 1)
    return { pixels: context.getImageData(0, 0, bins, 1).data, bins }
  } catch {
    // SecurityError (tainted canvas) и прочие сбои чтения — профиля не будет
    return null
  }
}

/** Сигма размытия: единицы радиуса → бины профиля */
const sigmaInBins = (blurRadius: number | undefined, innerRadius: number, outerRadius: number, bins: number): number =>
  (blurRadius ?? 0) / ((outerRadius - innerRadius) / bins)

function readRingAlphaBins(
  texture: Texture,
  innerRadius: number,
  outerRadius: number,
  options: RingAlphaProfileOptions = {}
): Float32Array | null {
  const read = readRingPixels(texture, innerRadius, outerRadius)
  if (!read) return null

  const alpha = new Float32Array(read.bins)
  for (let i = 0; i < read.bins; i++) {
    alpha[i] = read.pixels[i * 4 + 3] / 255
  }

  const sigma = sigmaInBins(options.blurRadius, innerRadius, outerRadius, read.bins)
  return thresholdBlurAndMask(alpha, options.alphaTest ?? 0, sigma, innerRadius, outerRadius, options.gaps ?? [])
}

/** Цвет и альфа полос кольца по бинам (см. readRingBandBins) */
interface RingBandBins {
  /** RGB полос, по три значения 0..1 на бин */
  color: Float32Array
  /** Альфа полос 0..1 по бинам */
  alpha: Float32Array
}

/**
 * Прочитать цвет и альфу полос кольца по бинам — источник 1D-текстуры полос
 * (см. RingBandTexture): тинт камней по цвету полосы и оптическая толща слоя
 * для самозатенения. Без порога alphaTest (тусклые полосы — тусклая толща);
 * размытие одной сигмой и для цвета, и для альфы, чтобы кромки совпадали;
 * щели лунок гасят только альфу (см. ringBandBinsFromPixels).
 */
function readRingBandBins(
  texture: Texture,
  innerRadius: number,
  outerRadius: number,
  options: Pick<RingAlphaProfileOptions, 'blurRadius' | 'gaps'> = {}
): RingBandBins | null {
  const read = readRingPixels(texture, innerRadius, outerRadius)
  if (!read) return null

  const sigma = sigmaInBins(options.blurRadius, innerRadius, outerRadius, read.bins)
  return ringBandBinsFromPixels(read.pixels, read.bins, sigma, innerRadius, outerRadius, options.gaps ?? [])
}

/**
 * Прочитать радиальный профиль альфы и обернуть в RadialDensityProfile
 * (семплинг радиуса камней + веса секторов). См. readRingAlphaBins.
 */
function readRingAlphaProfile(
  texture: Texture,
  innerRadius: number,
  outerRadius: number,
  options: RingAlphaProfileOptions = {}
): RadialDensityProfile | null {
  const bins = readRingAlphaBins(texture, innerRadius, outerRadius, options)

  return bins ? new RadialDensityProfile(bins, innerRadius, outerRadius) : null
}

export { readRingAlphaProfile, readRingAlphaBins, readRingBandBins }
export type { RingAlphaProfileOptions, RingBandBins }
