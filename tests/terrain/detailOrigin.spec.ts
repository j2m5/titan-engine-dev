import { afterEach, describe, expect, it } from 'vitest'
import { Texture, Vector3 } from 'three'
import { TerrainHeightField } from '@/core/terrain/TerrainHeightField'
import type { HeightMapData } from '@/core/terrain/heightMapFormat'
import { buildPatchIndex, buildTerrainPatchGeometry } from '@/core/terrain/terrainPatchGeometry'
import { DEFAULT_DETAIL_SCALE2_METERS, detailWrapFor, wrapIndex, wrappedComponent } from '@/core/terrain/detailWrap'
import { toThreeJSUnits } from '@/core/helpers/scaling'
import { Actor } from '@/core/models/Actor'
import { SphereSurfaceMaterial } from '@/core/materials/SphereSurfaceMaterial'
import { TerrainMaterial } from '@/core/materials/TerrainMaterial'
import { resourceStorage } from '@/core/services/ResourceStorage'
import { heightFieldStorage } from '@/core/services/HeightFieldStorage'
import { heightPathOf } from '@/core/terrain/heightPath'

/**
 * Домен детали — смещение на патч: вершинник считает vDetailPos = position +
 * detailOrigin, где detailOrigin = center − k·W (k = wrapIndex от центра,
 * double до квантования). Прежде домен был вершинным атрибутом dir·r − k·W.
 * Паритет считается так, как его считает GPU: float32(position) +
 * float32(detailOrigin) в float32.
 */

const SEGMENTS = 8
const GRID = (SEGMENTS + 1) * (SEGMENTS + 1)
const wrap = detailWrapFor(undefined)
/** Тысячная тайла мелкого слоя (7 м) — 7 мм в юнитах сцены. */
const TOLERANCE_UNITS = toThreeJSUnits(DEFAULT_DETAIL_SCALE2_METERS / 1000) * 1e-3

function bumpyField(): TerrainHeightField {
  const values = Array.from({ length: 16 * 8 }, (_, k) => (k * 4001) % 65535)
  const map: HeightMapData = { width: 16, height: 8, minMeters: -2000, maxMeters: 9000, data: new Uint16Array(values) }
  return new TerrainHeightField(map, 1736)
}

function build(depth: number, i: number, j: number) {
  return buildTerrainPatchGeometry(bumpyField(), 2, i, j, depth, SEGMENTS, buildPatchIndex(SEGMENTS), 0.001, wrap)
}

function origin(geometry: ReturnType<typeof build>['geometry'], name: string): number[] {
  return Array.from(geometry.getAttribute(name).array)
}

describe('домен детали: смещение на патч', () => {
  it('detailOrigin = center − k·W по компонентам, k от центра; |компонента| ≤ W/2', () => {
    const { geometry, center } = build(8, 100, 100)
    const c = center.toArray()
    const o1 = origin(geometry, 'detailOrigin')
    const o2 = origin(geometry, 'detailOrigin2')
    for (let n = 0; n < 3; n++) {
      expect(o1[n]).toBe(Math.fround(wrappedComponent(c[n], wrapIndex(c[n], wrap.w1), wrap.w1)))
      expect(o2[n]).toBe(Math.fround(wrappedComponent(c[n], wrapIndex(c[n], wrap.w2), wrap.w2)))
      expect(Math.abs(o1[n])).toBeLessThanOrEqual(wrap.w1 / 2)
      expect(Math.abs(o2[n])).toBeLessThanOrEqual(wrap.w2 / 2)
    }
  })

  it.each([8, 11])('глубина %i: float32(position + detailOrigin) = прежний домен dir·r − k·W до 7 мм', (depth) => {
    const { geometry, center } = build(depth, 37 << (depth - 8), 41 << (depth - 8))
    const pos = geometry.getAttribute('position')
    const c = center.toArray()
    for (const [name, w] of [['detailOrigin', wrap.w1], ['detailOrigin2', wrap.w2]] as const) {
      const o = origin(geometry, name)
      const k = c.map((v) => wrapIndex(v, w))
      for (let v = 0; v < GRID; v++) {
        const p = [pos.getX(v), pos.getY(v), pos.getZ(v)]
        for (let n = 0; n < 3; n++) {
          const gpu = Math.fround(p[n] + o[n])
          const reference = wrappedComponent(p[n] + c[n], k[n], w)
          expect(Math.abs(gpu - reference)).toBeLessThan(TOLERANCE_UNITS)
        }
      }
    }
  })

  it('соседние патчи: на общей точке домены отличаются на кратное W', () => {
    const a = build(8, 100, 100)
    const b = build(8, 101, 100)
    const pa = a.geometry.getAttribute('position')
    const pb = b.geometry.getAttribute('position')
    const oa = origin(a.geometry, 'detailOrigin')
    const ob = origin(b.geometry, 'detailOrigin')
    // правое ребро a (столбец SEGMENTS) и левое ребро b (столбец 0), строка 0
    const ia = SEGMENTS
    const ib = 0
    const da = [pa.getX(ia) + oa[0], pa.getY(ia) + oa[1], pa.getZ(ia) + oa[2]]
    const db = [pb.getX(ib) + ob[0], pb.getY(ib) + ob[1], pb.getZ(ib) + ob[2]]
    for (let n = 0; n < 3; n++) {
      const q = (da[n] - db[n]) / wrap.w1
      expect(Math.abs(q - Math.round(q))).toBeLessThan(1e-3)
    }
    // общий узел мира: одна и та же точка тела у обоих патчей
    const wa = new Vector3(pa.getX(ia), pa.getY(ia), pa.getZ(ia)).add(a.center)
    const wb = new Vector3(pb.getX(ib), pb.getY(ib), pb.getZ(ib)).add(b.center)
    expect(wa.distanceTo(wb)).toBeLessThan(TOLERANCE_UNITS)
  })

  it('вершинных атрибутов detailPos/detailPos2 больше нет', () => {
    const { geometry } = build(8, 100, 100)
    expect(geometry.getAttribute('detailPos')).toBeUndefined()
    expect(geometry.getAttribute('detailPos2')).toBeUndefined()
  })
})

describe('USE_TERRAIN_DETAIL — только у материала патчей', () => {
  /** Луна (actorId 19): терраформ с картой высот и детальными картами. */
  const MOON_ID = 19

  function seed(name: string): void {
    const texture = new Texture()
    texture.name = name
    texture.image = { width: 4, height: 2 }
    resourceStorage.addTexture(texture)
  }

  afterEach(() => {
    heightFieldStorage.clear()
    resourceStorage.deleteAllTextures()
  })

  it('старая сфера Planet с загруженной картой не получает домен детали: атрибутов патча у неё нет', () => {
    const moon = Actor.find(MOON_ID)!
    // Материалы на промахе зовут PlaceholderTexture (canvas 2d нет в jsdom):
    // ключи-плейсхолдеры + диффуз; детальная нормаль — условие USE_TERRAIN_DETAIL
    for (const name of ['', 'default.png', 'night.jpg']) seed(name)
    for (const type of ['diffuse', 'detailNormal'] as const) {
      seed(moon.resources.where('resourceType', type).first()!.getAttribute('path') as string)
    }
    const map: HeightMapData = { width: 4, height: 2, minMeters: 0, maxMeters: 1000, data: new Uint16Array(8).fill(32768) }
    ;(heightFieldStorage as unknown as { maps: Map<string, HeightMapData> }).maps.set(heightPathOf(moon)!, map)

    const sphere = new SphereSurfaceMaterial(moon)
    const patches = new TerrainMaterial(moon)
    // дефайны карт собирает updateMaterial, конструктор их не трогает
    sphere.updateMaterial()
    patches.updateMaterial()

    expect(sphere.defines.USE_TERRAIN_DETAIL).toBeUndefined()
    expect(patches.defines.USE_TERRAIN_DETAIL).toBe('1')
  })
})
