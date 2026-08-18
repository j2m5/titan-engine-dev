import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest'
import { Mesh, PerspectiveCamera, Texture, Vector3, type WebGLRenderer } from 'three'
import '@/core/framework/TitanThree'
import { WaterSphere, WATER_RENDER_ORDER } from '@/core/renderables/Water/WaterSphere'
import { WaterMaterial } from '@/core/renderables/Water/WaterMaterial'
import { TerrainPatchPool } from '@/core/terrain/TerrainPatchPool'
import { TerrainSphere } from '@/core/renderables/TerrainSphere'
import { RenderableFactory } from '@/core/renderables/RenderableFactory'
import { Actor } from '@/core/models/Actor'
import type { RenderingObject } from '@/core/models/RenderingObject'
import { resourceStorage } from '@/core/services/ResourceStorage'
import { heightFieldStorage } from '@/core/services/HeightFieldStorage'
import { toThreeJSUnits } from '@/core/helpers/scaling'
import type { UpdateContext } from '@/core/UpdateContext'
import type { ResourceObserver } from '@/core/services/ResourceObserver'

const MOON_ID = 19
const MOON_RADIUS_KM = 1735.97 // physicalObjects: actorId 19 (id 16)
const MOON_HEIGHT_PATH = 'planets/moon/moon_height.raw'

function moon(): Actor {
  return Actor.find(MOON_ID)!
}

function seedTexture(name: string): void {
  const texture = new Texture()
  texture.name = name
  texture.image = { width: 4, height: 2 }
  resourceStorage.addTexture(texture)
}

function seedPlaceholderKeys(): void {
  seedTexture('')
  seedTexture('default.png')
  seedTexture('night.jpg')
  seedTexture(moon().resources.where('resourceType', 'diffuse').first()!.getAttribute('path') as string)
}

function seedHeightMap(): void {
  ;(heightFieldStorage as unknown as { maps: Map<string, unknown> }).maps.set(MOON_HEIGHT_PATH, {
    width: 4,
    height: 2,
    minMeters: 0,
    maxMeters: 1000,
    data: new Uint16Array(8)
  })
}

function makeRenderer(height = 1080): WebGLRenderer {
  return { domElement: { height } } as unknown as WebGLRenderer
}

function makeCtx(altKm: number): UpdateContext {
  const camera = new PerspectiveCamera(50, 1, 1e-6, 1e9)
  camera.position.set(toThreeJSUnits(MOON_RADIUS_KM + altKm), 0, 0)
  camera.updateMatrixWorld(true)
  return { delta: 0.016, epoch: 0, elapsed: 0, camera } as UpdateContext
}

describe('WaterSphere: оболочка без смещения', { timeout: 30000 }, () => {
  beforeEach(() => seedPlaceholderKeys())
  afterEach(() => resourceStorage.deleteAllTextures())

  it('конструктор строит минимальный набор уровня 1 (24 меша) — как у TerrainSphere', () => {
    const sphere = new WaterSphere(moon(), -667.2, makeRenderer())
    expect(sphere.children.filter((c) => c instanceof Mesh)).toHaveLength(24)
  })

  it('поле константно: глубина дерева ограничена — набор НЕ растёт на посадочной дистанции', () => {
    const sphere = new WaterSphere(moon(), -667.2, makeRenderer())
    for (let f = 0; f < 60; f++) sphere.updateObject(makeCtx(0.05)) // 50 м над уровнем воды
    expect(sphere.children.filter((c) => c instanceof Mesh)).toHaveLength(24)
  })

  it('материал патчей: transparent, depthWrite=false, depthTest=true', () => {
    const sphere = new WaterSphere(moon(), -667.2, makeRenderer())
    const patch = sphere.children[0] as Mesh
    expect(patch.material).toBeInstanceOf(WaterMaterial)
    const material = patch.material as WaterMaterial
    expect(material.transparent).toBe(true)
    expect(material.depthWrite).toBe(false)
    expect(material.depthTest).toBe(true)
  })

  it('renderOrder патчей — после суши (положительный, задан константой WATER_RENDER_ORDER)', () => {
    const sphere = new WaterSphere(moon(), -667.2, makeRenderer())
    const patch = sphere.children[0] as Mesh
    expect(WATER_RENDER_ORDER).toBeGreaterThan(0)
    expect(patch.renderOrder).toBe(WATER_RENDER_ORDER)
  })

  it('патчи воды не перехватывают клик (userData.clickable = false)', () => {
    const sphere = new WaterSphere(moon(), -667.2, makeRenderer())
    const patch = sphere.children[0] as Mesh
    expect(patch.userData.clickable).toBe(false)
  })

  it('оболочка радиуса R + уровень: положительный уровень выше R, отрицательный (Явин −667.2) — ниже R', () => {
    const above = new WaterSphere(moon(), 500, makeRenderer())
    const below = new WaterSphere(moon(), -667.2, makeRenderer())

    const patchAbove = above.children[0] as Mesh
    const patchBelow = below.children[0] as Mesh

    // радиус до кромочной вершины патча ≈ R + уровень (RTC: вершина + позиция меша)
    const radiusOf = (patch: Mesh): number => {
      const pos = patch.geometry.getAttribute('position')
      return new Vector3(pos.getX(0), pos.getY(0), pos.getZ(0)).add(patch.position).length()
    }

    expect(radiusOf(patchAbove)).toBeGreaterThan(toThreeJSUnits(MOON_RADIUS_KM))
    expect(radiusOf(patchBelow)).toBeLessThan(toThreeJSUnits(MOON_RADIUS_KM))
  })

  it('юбки присутствуют: юбочная вершина патча ниже кромочной на ненулевую величину', () => {
    const sphere = new WaterSphere(moon(), -667.2, makeRenderer())
    const patch = sphere.children[0] as Mesh
    const pos = patch.geometry.getAttribute('position')
    const gridVertexCount = pos.count - 4 * 64 // TERRAIN_PATCH_SEGMENTS=64, см. cubeSphere

    const edge = new Vector3(pos.getX(0), pos.getY(0), pos.getZ(0)).add(patch.position)
    const skirt = new Vector3(pos.getX(gridVertexCount), pos.getY(gridVertexCount), pos.getZ(gridVertexCount)).add(
      patch.position
    )

    expect(edge.length() - skirt.length()).toBeGreaterThan(0)
  })

  it('dispose зовёт pool.dispose — освобождение владения пула не пропущено', () => {
    const sphere = new WaterSphere(moon(), -667.2, makeRenderer())
    const disposeSpy = vi.spyOn(TerrainPatchPool.prototype, 'dispose')

    sphere.dispose()

    expect(disposeSpy).toHaveBeenCalledTimes(1)
    disposeSpy.mockRestore()
  })
})

// Гейт фабрики: height-карта И waterLevelMeters в data — обе ручки нужны разом.
function mockRenderingObject(data: Record<string, unknown> | null): void {
  vi.spyOn(Actor.prototype, 'renderingObject', 'get').mockReturnValue(
    data === null ? null : ({ getAttribute: (key: string) => (key === 'data' ? data : undefined) } as unknown as RenderingObject)
  )
}

function makeFactory(): RenderableFactory {
  return new RenderableFactory(makeRenderer(1080), {} as unknown as ResourceObserver)
}

describe('RenderableFactory: гейт водной оболочки', { timeout: 30000 }, () => {
  beforeEach(() => seedPlaceholderKeys())
  afterEach(() => {
    resourceStorage.deleteAllTextures()
    heightFieldStorage.clear()
    vi.restoreAllMocks()
  })

  it('нет карты высот, нет waterLevelMeters — ни TerrainSphere, ни WaterSphere', () => {
    mockRenderingObject(null)
    const node = makeFactory().make(moon()) as unknown as { renderable: unknown }
    expect(node.renderable).not.toBeInstanceOf(TerrainSphere)
  })

  it('есть карта высот, НЕТ waterLevelMeters в data — TerrainSphere без WaterSphere-ребёнка (ноль расходов)', () => {
    seedHeightMap()
    mockRenderingObject({})

    const node = makeFactory().make(moon()) as unknown as { renderable: TerrainSphere }
    expect(node.renderable).toBeInstanceOf(TerrainSphere)
    expect(node.renderable.children.some((c) => c instanceof WaterSphere)).toBe(false)
  })

  it('нет карты высот, но waterLevelMeters ЕСТЬ — вода не создаётся (гейт требует ОБЕ ручки)', () => {
    mockRenderingObject({ waterLevelMeters: -667.2 })

    const node = makeFactory().make(moon()) as unknown as { renderable: unknown }
    expect(node.renderable).not.toBeInstanceOf(TerrainSphere)
  })

  it('есть карта высот И waterLevelMeters — WaterSphere создаётся ребёнком TerrainSphere', () => {
    seedHeightMap()
    mockRenderingObject({ waterLevelMeters: -667.2 })

    const node = makeFactory().make(moon()) as unknown as { renderable: TerrainSphere }
    expect(node.renderable).toBeInstanceOf(TerrainSphere)
    const water = node.renderable.children.find((c) => c instanceof WaterSphere) as WaterSphere | undefined
    expect(water).toBeDefined()
    expect(water!.children.filter((c) => c instanceof Mesh)).toHaveLength(24)
  })
})
