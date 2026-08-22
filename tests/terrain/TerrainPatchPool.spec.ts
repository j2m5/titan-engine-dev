import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { BufferAttribute, DynamicDrawUsage, Texture } from 'three'
import {
  MAX_LIVE_PATCHES,
  TerrainPatchPool,
  type PatchHandle
} from '@/core/terrain/TerrainPatchPool'
import { buildPatchIndex, buildTerrainPatchGeometry, buildTerrainPatchInto } from '@/core/terrain/terrainPatchGeometry'
import { detailWrapFor } from '@/core/terrain/detailWrap'
import { TerrainHeightField } from '@/core/terrain/TerrainHeightField'
import { PlanetMaterial } from '@/core/materials/PlanetMaterial'
import { Actor } from '@/core/models/Actor'
import { resourceStorage } from '@/core/services/ResourceStorage'
import type { HeightMapData } from '@/core/terrain/heightMapFormat'

// Луна (actorId 19) — тело с height-ресурсом
function moon(): Actor {
  return Actor.find(19)!
}

function seedTexture(name: string): void {
  const texture = new Texture()
  texture.name = name
  texture.image = { width: 4, height: 2 }
  resourceStorage.addTexture(texture)
}

// PlanetMaterial в конструкторе ходит за плейсхолдерами (см. PlanetMaterialMaps.spec, TerrainSphere.spec)
function seedPlaceholderKeys(): void {
  seedTexture('')
  seedTexture('default.png')
  seedTexture('night.jpg')
  seedTexture(moon().resources.where('resourceType', 'diffuse').first()!.getAttribute('path') as string)
}

function makeMap(width: number, height: number, values: number[], minMeters = 0, maxMeters = 65535): HeightMapData {
  return { width, height, minMeters, maxMeters, data: new Uint16Array(values) }
}

const R_KM = 1736
// небольшой случайный рельеф — паритет должен держаться не на константе
function bumpyField(): TerrainHeightField {
  const values = Array.from({ length: 16 * 8 }, (_, k) => (k * 4001) % 65535)
  return new TerrainHeightField(makeMap(16, 8, values, -2000, 9000), R_KM)
}

const SEGMENTS = 8
const DEPTH = 1
const SKIRT = 0.001

function makePool(): TerrainPatchPool {
  return new TerrainPatchPool(new PlanetMaterial(moon()), SEGMENTS)
}

describe('TerrainPatchPool', () => {
  beforeEach(() => seedPlaceholderKeys())
  afterEach(() => resourceStorage.deleteAllTextures())

  it('into даёт побайтно те же атрибуты и bounding-сферу, что fresh', () => {
    const field = bumpyField()
    const pool = makePool()
    const handle = pool.acquire()!
    const wrap = detailWrapFor(undefined)
    buildTerrainPatchInto(field, 2, 1, 0, DEPTH, SEGMENTS, SKIRT, handle, wrap)
    const fresh = buildTerrainPatchGeometry(field, 2, 1, 0, DEPTH, SEGMENTS, buildPatchIndex(SEGMENTS), SKIRT, wrap)

    expect(Array.from(handle.geometry.getAttribute('position').array)).toEqual(
      Array.from(fresh.geometry.getAttribute('position').array)
    )
    expect(handle.mesh.position.distanceTo(fresh.center)).toBe(0)
    expect(handle.geometry.boundingSphere!.radius).toBeCloseTo(fresh.geometry.boundingSphere!.radius, 12)
  })

  it('повторное использование не создаёт новых геометрий', () => {
    const pool = makePool()
    const a = pool.acquire()!
    pool.release(a)
    const b = pool.acquire()!
    expect(b.geometry).toBe(a.geometry)
    expect(pool.liveCount).toBe(1)
  })

  it('упор в потолок: acquire возвращает null, не бросает', () => {
    const pool = makePool()
    const handles: PatchHandle[] = []
    for (let k = 0; k < MAX_LIVE_PATCHES; k++) handles.push(pool.acquire()!)
    expect(pool.acquire()).toBeNull()
    pool.release(handles[0])
    expect(pool.acquire()).not.toBeNull()
  })

  it('индекс один по ссылке у всех геометрий пула', () => {
    const pool = makePool()
    const a = pool.acquire()!
    const b = pool.acquire()!
    expect(a.geometry.getIndex()).toBe(b.geometry.getIndex())
  })

  // guard дешёвого инварианта: повторный release того же handle — тихий
  // return, не портит liveCount и не кладёт handle в free дважды (иначе
  // следующие два acquire отдали бы один и тот же handle двум живым мешам)
  it('повторный release одного handle — тихий return, не дублирует слот в free', () => {
    const pool = makePool()
    const a = pool.acquire()!
    pool.release(a)
    expect(pool.liveCount).toBe(0)

    pool.release(a) // двойной release
    expect(pool.liveCount).toBe(0)

    const b = pool.acquire()!
    const c = pool.acquire()!
    expect(b).not.toBe(c)
  })

  // владение вне графа сцены: свободные слоты держат геометрию живой между
  // acquire (см. докблок класса), pool.dispose() освобождает их и общий
  // индекс, но НЕ трогает слоты, которые вызывающий не release'нул —
  // это его ответственность (см. TerrainSphere.dispose)
  it('геометрия слота несёт атрибуты detailPos/detailPos2 (vec3, DynamicDrawUsage)', () => {
    const pool = makePool()
    const handle = pool.acquire()!
    for (const name of ['detailPos', 'detailPos2']) {
      const attr = handle.geometry.getAttribute(name) as BufferAttribute
      expect(attr.itemSize).toBe(3)
      expect(attr.count).toBe(handle.geometry.getAttribute('position').count)
      expect(attr.usage).toBe(DynamicDrawUsage)
    }
  })

  it('dispose освобождает геометрии свободных слотов и общий индекс; живые слоты не трогает', () => {
    const pool = makePool()
    const a = pool.acquire()!
    const b = pool.acquire()!
    const c = pool.acquire()! // остаётся живым
    pool.release(a)
    pool.release(b)

    const disposeA = vi.spyOn(a.geometry, 'dispose')
    const disposeB = vi.spyOn(b.geometry, 'dispose')
    const disposeC = vi.spyOn(c.geometry, 'dispose')

    pool.dispose()

    expect(disposeA).toHaveBeenCalledTimes(1)
    expect(disposeB).toHaveBeenCalledTimes(1)
    expect(disposeC).not.toHaveBeenCalled() // живой слот — на совести вызывающего
  })
})
