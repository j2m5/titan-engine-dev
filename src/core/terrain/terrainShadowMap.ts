import { ClampToEdgeWrapping, DataTexture, DataUtils, HalfFloatType, LinearFilter, RedFormat, RepeatWrapping } from 'three'
import type { HeightMapData } from '@/core/terrain/heightMapFormat'
import { toThreeJSUnits } from '@/core/helpers/scaling'

/**
 * Потолок ширины низкой карты тени: 4096×2048 R16F = 16 МБ видеопамяти на
 * тело; при 2048 тексель 10 км на Марсе разваливает тени каньонов в ступени.
 */
export const SHADOW_MAP_MAX_WIDTH = 4096

/** Целый множитель — дробный дал бы неравные блоки и муар на шве. */
export function shadowMapDownsampleFactor(width: number): number {
  return Math.max(1, Math.ceil(width / SHADOW_MAP_MAX_WIDTH))
}

/** Низкая карта высот и её масштабы — ровно вход чанка terrainShadowMarch. */
export interface TerrainShadowMap {
  texture: DataTexture
  /** Нижняя граница карты, юниты сцены (высота над датумом, может быть < 0). */
  heightMinUnits: number
  /** Размах карты (max − min), юниты сцены: h = min + texel·range. */
  heightRangeUnits: number
  /** Угловой размер текселя по долготе, радианы: 2π / ширина. */
  texelAngle: number
  width: number
  height: number
}

/**
 * Одна карта тени на карту высот. Поля высот (`terrainHeightFieldFor`) кэшируются
 * по (карта, радиус, полоса) и могут существовать в нескольких экземплярах на
 * одну карту — текстура от радиуса не зависит, поэтому живёт здесь, по карте.
 * GL-ресурс не умирает со сборщиком: диспоз — из HeightFieldStorage.release/clear.
 */
const shadowMaps = new Map<HeightMapData, TerrainShadowMap>()

export function terrainShadowMapFor(map: HeightMapData): TerrainShadowMap {
  let shadow = shadowMaps.get(map)
  if (!shadow) {
    shadow = buildTerrainShadowMap(map)
    shadowMaps.set(map, shadow)
  }
  return shadow
}

export function disposeTerrainShadowMap(map: HeightMapData): boolean {
  const shadow = shadowMaps.get(map)
  if (!shadow) return false
  shadow.texture.dispose()
  shadowMaps.delete(map)
  return true
}

export function disposeTerrainShadowMaps(): void {
  for (const shadow of shadowMaps.values()) shadow.texture.dispose()
  shadowMaps.clear()
}

/**
 * Коробочное среднее блока factor×factor в нормированную высоту raw/65535 —
 * та же нормировка, что в файле, множители уезжают юниформами. Среднее, не
 * максимум: максимум раздувает вершины в плато и кладёт ложную тень на равнину.
 * Хвост, не кратный множителю, отбрасывается (≤ factor текселей на краю).
 */
function buildTerrainShadowMap(map: HeightMapData): TerrainShadowMap {
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

  const texture = new DataTexture(bits, width, height, RedFormat, HalfFloatType)
  texture.wrapS = RepeatWrapping
  texture.wrapT = ClampToEdgeWrapping
  texture.minFilter = LinearFilter
  texture.magFilter = LinearFilter
  texture.generateMipmaps = false
  texture.needsUpdate = true

  return {
    texture,
    heightMinUnits: toThreeJSUnits(map.minMeters / 1000),
    heightRangeUnits: toThreeJSUnits((map.maxMeters - map.minMeters) / 1000),
    texelAngle: (2 * Math.PI) / width,
    width,
    height
  }
}
