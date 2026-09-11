import { afterEach, describe, expect, it } from 'vitest'
import { DataUtils, HalfFloatType, LinearFilter, RedFormat, RepeatWrapping, ClampToEdgeWrapping } from 'three'
import type { HeightMapData } from '@/core/terrain/heightMapFormat'
import {
  SHADOW_MAP_MAX_WIDTH,
  disposeTerrainShadowMap,
  disposeTerrainShadowMaps,
  shadowMapDownsampleFactor,
  terrainShadowMapFor
} from '@/core/terrain/terrainShadowMap'
import { toThreeJSUnits } from '@/core/helpers/scaling'

function makeMap(width: number, height: number, fill: (x: number, y: number) => number, minMeters = 0, maxMeters = 65535): HeightMapData {
  const data = new Uint16Array(width * height)
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) data[y * width + x] = fill(x, y)
  return { width, height, minMeters, maxMeters, data }
}

afterEach(() => disposeTerrainShadowMaps())

describe('terrainShadowMap: множитель даунсэмпла', () => {
  it('8192 → 2, 4096 → 1, 2048 → 1, 8000 → 2', () => {
    expect(SHADOW_MAP_MAX_WIDTH).toBe(4096)
    expect(shadowMapDownsampleFactor(8192)).toBe(2)
    expect(shadowMapDownsampleFactor(4096)).toBe(1)
    expect(shadowMapDownsampleFactor(2048)).toBe(1)
    expect(shadowMapDownsampleFactor(8000)).toBe(2)
  })
})

describe('terrainShadowMap: текстура', () => {
  it('блок усредняется, не берётся максимум; хвост не кратный множителю отбрасывается', () => {
    // 8192×2 → множитель 2 → 4096×1; карта крошечная по высоте, ширина — как у Луны
    const width = SHADOW_MAP_MAX_WIDTH * 2
    const map = makeMap(width, 2, (x, y) => (x === 0 && y === 0 ? 65535 : 0), 0, 1000)
    const shadow = terrainShadowMapFor(map)
    expect(shadow.width).toBe(SHADOW_MAP_MAX_WIDTH)
    expect(shadow.height).toBe(1)
    const bits = shadow.texture.image.data as Uint16Array
    // блок (0..1, 0..1): один пик 65535 из четырёх → среднее 0.25, не 1.0
    expect(DataUtils.fromHalfFloat(bits[0])).toBeCloseTo(0.25, 3)
    expect(DataUtils.fromHalfFloat(bits[1])).toBe(0)
  })

  it('формат R16F без мипов, wrap по S, clamp по T; масштабы в юнитах сцены; тексель = 2π/ширина', () => {
    const map = makeMap(8, 4, () => 32768, -2000, 6000)
    const shadow = terrainShadowMapFor(map)
    expect(shadow.texture.format).toBe(RedFormat)
    expect(shadow.texture.type).toBe(HalfFloatType)
    expect(shadow.texture.generateMipmaps).toBe(false)
    expect(shadow.texture.minFilter).toBe(LinearFilter)
    expect(shadow.texture.magFilter).toBe(LinearFilter)
    expect(shadow.texture.wrapS).toBe(RepeatWrapping)
    expect(shadow.texture.wrapT).toBe(ClampToEdgeWrapping)
    // needsUpdate у three — сеттер без геттера (пишет version++), читаем version
    expect(shadow.texture.version).toBeGreaterThan(0)
    expect(shadow.heightMinUnits).toBeCloseTo(toThreeJSUnits(-2), 12)
    expect(shadow.heightRangeUnits).toBeCloseTo(toThreeJSUnits(8), 12)
    expect(shadow.texelAngle).toBeCloseTo((2 * Math.PI) / 8, 12)
    // значение нормированное: 32768/65535
    expect(DataUtils.fromHalfFloat((shadow.texture.image.data as Uint16Array)[0])).toBeCloseTo(32768 / 65535, 3)
  })

  it('одна текстура на карту: повторный вызов возвращает тот же объект; после dispose строится новая', () => {
    const map = makeMap(4, 2, () => 0)
    const a = terrainShadowMapFor(map)
    expect(terrainShadowMapFor(map)).toBe(a)
    let disposed = 0
    a.texture.addEventListener('dispose', () => disposed++)
    expect(disposeTerrainShadowMap(map)).toBe(true)
    expect(disposed).toBe(1)
    expect(disposeTerrainShadowMap(map)).toBe(false)
    expect(terrainShadowMapFor(map)).not.toBe(a)
  })

  it('disposeTerrainShadowMaps закрывает все', () => {
    const m1 = makeMap(4, 2, () => 0)
    const m2 = makeMap(4, 2, () => 0)
    let disposed = 0
    terrainShadowMapFor(m1).texture.addEventListener('dispose', () => disposed++)
    terrainShadowMapFor(m2).texture.addEventListener('dispose', () => disposed++)
    disposeTerrainShadowMaps()
    expect(disposed).toBe(2)
    expect(disposeTerrainShadowMap(m1)).toBe(false)
  })
})
