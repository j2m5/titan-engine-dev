import { ClampToEdgeWrapping, DataTexture, LinearFilter, RedFormat, UnsignedByteType } from 'three'

/**
 * Нормированный радиальный профиль пыли: байты для 1D-текстуры + множитель.
 *
 * Нормировка держит СРЕДНЕЕ модуляции по радиусу равным 1:
 * mean(bytes / 255 · scale) ≈ 1. Грейзинг-луч в средней плоскости интегрирует
 * плотность равномерно по радиусу, поэтому целевой tau калибровки
 * (dustTauGrazing) сохраняется — пыль лишь перераспределяется в субкольца.
 */
interface DustRadialProfileData {
  /** Значения текселей R-канала (квантование до 8 бит, как на GPU) */
  bytes: Uint8Array
  /** Множитель модуляции (uDustRadialMapScale): bytes/255 · scale, среднее ≈ 1 */
  scale: number
}

/**
 * Нормировать бины альфы под 8-битную текстуру профиля пыли.
 * null — профиль вырожден (полностью прозрачная текстура): модуляцию
 * не применять, пыль остаётся равномерной.
 */
const normalizeDustBins = (bins: Float32Array): DustRadialProfileData | null => {
  let max = 0
  let sum = 0
  for (const a of bins) {
    if (a > max) max = a
    sum += a
  }
  const mean = sum / bins.length
  if (max <= 0 || mean <= 0) return null

  const bytes = new Uint8Array(bins.length)
  for (let i = 0; i < bins.length; i++) {
    bytes[i] = Math.round((bins[i] / max) * 255)
  }

  return { bytes, scale: max / mean }
}

/**
 * Собрать 1D-текстуру радиального профиля пыли (R-канал, LinearFilter,
 * clamp) из бинов альфы текстуры кольца. Маппинг u — тот же, что у
 * RingShader/гейта камней: u = (r − inner) / (outer − inner).
 */
const createDustRadialTexture = (bins: Float32Array): { texture: DataTexture; scale: number } | null => {
  const normalized = normalizeDustBins(bins)
  if (!normalized) return null

  const texture = new DataTexture(normalized.bytes, normalized.bytes.length, 1, RedFormat, UnsignedByteType)
  texture.magFilter = LinearFilter
  texture.minFilter = LinearFilter
  texture.wrapS = ClampToEdgeWrapping
  texture.wrapT = ClampToEdgeWrapping
  texture.generateMipmaps = false
  texture.needsUpdate = true
  texture.name = 'DustRadialProfile'

  return { texture, scale: normalized.scale }
}

export { normalizeDustBins, createDustRadialTexture }
export type { DustRadialProfileData }
