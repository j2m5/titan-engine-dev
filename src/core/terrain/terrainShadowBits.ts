import { DataUtils } from 'three'
import type { HeightMapData } from '@/core/terrain/heightMapFormat'

/**
 * Потолок ширины низкой карты тени: 4096×2048 R16F = 16 МБ видеопамяти на
 * тело; при 2048 тексель 10 км на Марсе разваливает тени каньонов в ступени.
 */
export const SHADOW_MAP_MAX_WIDTH = 4096

/** Целый множитель — дробный дал бы неравные блоки и муар на шве. */
export function shadowMapDownsampleFactor(width: number): number {
  return Math.max(1, Math.ceil(width / SHADOW_MAP_MAX_WIDTH))
}

/** Тело низкой карты тени: half-float биты нормированной высоты, строка 0 — север. */
export interface ShadowHeightBits {
  bits: Uint16Array
  width: number
  height: number
}

/**
 * Коробочное среднее блока factor×factor в нормированную высоту raw/65535 —
 * та же нормировка, что в файле, множители уезжают юниформами. Среднее, не
 * максимум: максимум раздувает вершины в плато и кладёт ложную тень на равнину.
 * Хвост, не кратный множителю, отбрасывается (≤ factor текселей на краю).
 * Чистая функция: зовётся и в воркере постройки, и на главном потоке.
 */
export function buildShadowHeightBits(map: HeightMapData): ShadowHeightBits {
  const factor = shadowMapDownsampleFactor(map.width)
  const width = Math.floor(map.width / factor)
  const height = Math.floor(map.height / factor)
  const bits = new Uint16Array(width * height)
  const blockTexels = factor * factor

  for (let y = 0; y < height; y++) {
    const srcY = y * factor
    for (let x = 0; x < width; x++) {
      const srcX = x * factor
      let sum = 0
      for (let dy = 0; dy < factor; dy++) {
        const row = (srcY + dy) * map.width
        for (let dx = 0; dx < factor; dx++) sum += map.data[row + srcX + dx]
      }
      bits[y * width + x] = DataUtils.toHalfFloat(sum / (blockTexels * 65535))
    }
  }

  return { bits, width, height }
}
