import { afterEach, describe, expect, it, vi } from 'vitest'
import { DataUtils, HalfFloatType, LinearFilter, RedFormat, RepeatWrapping, ClampToEdgeWrapping } from 'three'
import type { HeightMapData } from '@/core/terrain/heightMapFormat'
import {
  disposeTerrainShadowMap,
  disposeTerrainShadowMaps,
  installTerrainShadowBits,
  onTerrainShadowMapReady,
  requestTerrainShadowMap,
  terrainShadowMapFor
} from '@/core/terrain/terrainShadowMap'
import { SHADOW_MAP_MAX_WIDTH, buildShadowHeightBits, shadowMapDownsampleFactor } from '@/core/terrain/terrainShadowBits'
import { TerrainHeightField } from '@/core/terrain/TerrainHeightField'
import type { TerrainPatchBuilder } from '@/core/terrain/terrainPatchBuilder'
import { toThreeJSUnits } from '@/core/helpers/scaling'

function makeMap(width: number, height: number, fill: (x: number, y: number) => number, minMeters = 0, maxMeters = 65535): HeightMapData {
  const data = new Uint16Array(width * height)
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) data[y * width + x] = fill(x, y)
  return { width, height, minMeters, maxMeters, data }
}

afterEach(() => disposeTerrainShadowMaps())

describe('terrainShadowBits: множитель даунсэмпла', () => {
  it('8192 → 2, 4096 → 1, 2048 → 1, 8000 → 2', () => {
    expect(SHADOW_MAP_MAX_WIDTH).toBe(4096)
    expect(shadowMapDownsampleFactor(8192)).toBe(2)
    expect(shadowMapDownsampleFactor(4096)).toBe(1)
    expect(shadowMapDownsampleFactor(2048)).toBe(1)
    expect(shadowMapDownsampleFactor(8000)).toBe(2)
  })
})

describe('terrainShadowBits: биты низкой карты', () => {
  it('блок усредняется, не берётся максимум; хвост не кратный множителю отбрасывается', () => {
    // 8192×2 → множитель 2 → 4096×1; карта крошечная по высоте, ширина — как у Луны
    const map = makeMap(SHADOW_MAP_MAX_WIDTH * 2, 2, (x, y) => (x === 0 && y === 0 ? 65535 : 0), 0, 1000)
    const { bits, width, height } = buildShadowHeightBits(map)
    expect(width).toBe(SHADOW_MAP_MAX_WIDTH)
    expect(height).toBe(1)
    // блок (0..1, 0..1): один пик 65535 из четырёх → среднее 0.25, не 1.0
    expect(DataUtils.fromHalfFloat(bits[0])).toBeCloseTo(0.25, 3)
    expect(DataUtils.fromHalfFloat(bits[1])).toBe(0)
  })
})

describe('terrainShadowMap: заглушка до готовности', () => {
  it('до установки — ровная сфера на датуме 1×1, масштабы и тексель уже по карте', () => {
    const map = makeMap(8, 4, () => 32768, -2000, 6000)
    const shadow = terrainShadowMapFor(map)
    expect(shadow.ready).toBe(false)
    expect(shadow.texture.image.width).toBe(1)
    expect(shadow.texture.type).toBe(HalfFloatType)
    expect(shadow.heightMinUnits).toBeCloseTo(toThreeJSUnits(-2), 12)
    expect(shadow.heightRangeUnits).toBeCloseTo(toThreeJSUnits(8), 12)
    expect(shadow.texelAngle).toBeCloseTo((2 * Math.PI) / 8, 12)
    // h = min + v·range = 0 → v = 2000/8000
    expect(DataUtils.fromHalfFloat((shadow.texture.image.data as Uint16Array)[0])).toBeCloseTo(0.25, 3)
  })

  it('установка битов: текстура полной карты R16F без мипов, заглушка диспознута, подписчики зовутся один раз', () => {
    const map = makeMap(8, 4, () => 32768, -2000, 6000)
    const shadow = terrainShadowMapFor(map)
    const placeholder = shadow.texture
    let placeholderDisposed = 0
    placeholder.addEventListener('dispose', () => placeholderDisposed++)
    const ready = vi.fn()
    onTerrainShadowMapReady(map, ready)

    expect(installTerrainShadowBits(map, buildShadowHeightBits(map))).toBe(true)

    expect(shadow.ready).toBe(true)
    expect(shadow.texture).not.toBe(placeholder)
    expect(placeholderDisposed).toBe(1)
    expect(ready).toHaveBeenCalledTimes(1)
    expect(ready).toHaveBeenCalledWith(shadow)
    expect(shadow.texture.image.width).toBe(8)
    expect(shadow.texture.format).toBe(RedFormat)
    expect(shadow.texture.generateMipmaps).toBe(false)
    expect(shadow.texture.minFilter).toBe(LinearFilter)
    expect(shadow.texture.magFilter).toBe(LinearFilter)
    expect(shadow.texture.wrapS).toBe(RepeatWrapping)
    expect(shadow.texture.wrapT).toBe(ClampToEdgeWrapping)
    expect(DataUtils.fromHalfFloat((shadow.texture.image.data as Uint16Array)[0])).toBeCloseTo(32768 / 65535, 3)
    // повторная установка — no-op
    expect(installTerrainShadowBits(map, buildShadowHeightBits(map))).toBe(false)
    expect(ready).toHaveBeenCalledTimes(1)
  })

  it('отписка до готовности — подписчик не зовётся', () => {
    const map = makeMap(4, 2, () => 0)
    terrainShadowMapFor(map)
    const ready = vi.fn()
    onTerrainShadowMapReady(map, ready)()
    installTerrainShadowBits(map, buildShadowHeightBits(map))
    expect(ready).not.toHaveBeenCalled()
  })

  it('биты после dispose карты игнорируются: запись не воскресает', () => {
    const map = makeMap(4, 2, () => 0)
    const shadow = terrainShadowMapFor(map)
    disposeTerrainShadowMap(map)
    expect(installTerrainShadowBits(map, buildShadowHeightBits(map))).toBe(false)
    expect(shadow.ready).toBe(false)
    expect(terrainShadowMapFor(map)).not.toBe(shadow)
  })

  it('одна запись на карту; dispose закрывает текущую текстуру; после dispose строится новая', () => {
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

describe('requestTerrainShadowMap: постройка через строитель', () => {
  it('один запрос на карту, даже от двух полей разного радиуса; ответ строителя ставит карту', () => {
    const map = makeMap(8, 4, (x) => x * 1000)
    const requests: Array<(bits: ReturnType<typeof buildShadowHeightBits>) => void> = []
    const builder = {
      requestShadow: (field: TerrainHeightField, onDone: (bits: ReturnType<typeof buildShadowHeightBits>) => void) => {
        expect(field.heightMap).toBe(map)
        requests.push(onDone)
      }
    } as unknown as TerrainPatchBuilder
    requestTerrainShadowMap(new TerrainHeightField(map, 1000), builder)
    requestTerrainShadowMap(new TerrainHeightField(map, 2000), builder)
    expect(requests).toHaveLength(1)

    requests[0](buildShadowHeightBits(map))
    expect(terrainShadowMapFor(map).ready).toBe(true)
  })
})
