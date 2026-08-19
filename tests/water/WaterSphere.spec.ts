import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest'
import { Group, Mesh, PerspectiveCamera, Texture, Vector3, type WebGLRenderer } from 'three'
import '@/core/framework/TitanThree'
import { WaterSphere, WATER_RENDER_ORDER, WATER_MAX_LIVE_PATCHES } from '@/core/renderables/Water/WaterSphere'
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

  // Фикс-раунд 1 (ревью): до фикса ε константного поля был ≡0, дерево не
  // делилось НИКОГДА — этот тест раньше цементировал сам дефект («24 всегда»).
  // Честная пара: на посадочной дистанции набор РАСТЁТ (кривизна сферы даёт
  // ненулевую ε — «деление по кривизне» из спеки), но самотерминируется —
  // конечен, упирается в TERRAIN_QUADTREE_MAX_LEVEL задолго до потолка пула
  // (замер отчёта, фикс-раунд 2 — диагональная ε: 72 патча у Луны на этой
  // дистанции при H=1080, максимальный уровень 5; осевая ε фикс-раунда 1
  // занижала вдвое и останавливала дерево на уровне 4).
  it('поле делится по кривизне сферы: на посадочной дистанции набор РАСТЁТ, но самотерминируется', () => {
    const sphere = new WaterSphere(moon(), -667.2, makeRenderer())
    for (let f = 0; f < 120; f++) sphere.updateObject(makeCtx(0.05)) // 50 м над уровнем воды
    const meshes = sphere.children.filter((c) => c instanceof Mesh)
    const maxLevel = Math.max(
      ...meshes.map((m) => (m.userData.terrainAddress as { level: number } | undefined)?.level ?? 0)
    )

    expect(meshes.length).toBeGreaterThan(24)
    expect(meshes.length).toBeLessThan(WATER_MAX_LIVE_PATCHES)
    // диагональная ε доходит до уровня 5 у Луны на этой дистанции (осевая
    // ε фикс-раунда 1 останавливалась на уровне 4 — это и была находка №1
    // ре-ревью: недооценка вдвое держала дерево на уровень мельче)
    expect(maxLevel).toBe(5)
  })

  it('из космоса — ровно 24 патча (SSE уровня MIN_LEVEL уже ниже порога на орбитальной дистанции)', () => {
    const sphere = new WaterSphere(moon(), -667.2, makeRenderer())
    for (let f = 0; f < 30; f++) sphere.updateObject(makeCtx(500000))
    expect(sphere.children.filter((c) => c instanceof Mesh)).toHaveLength(24)
  })

  // Находка №4 ревью: LOD.update() переключает .visible только у объектов,
  // добавленных через addLevel (TerrainSphere), не у их детей — WaterSphere
  // висит ребёнком TerrainSphere (RenderableFactory), собственный visible
  // остаётся true всегда. TerrainPatchGroup.updateObject проверяет ещё и
  // parent.visible — без этого дерево воды продолжало бы гонять
  // selectTerrainNodes впустую на дистанции переключения на FakePlanet.
  it('родитель скрыт (LOD спрятал уровень) — updateObject заморожен даже на посадочной дистанции', () => {
    const parent = new Group()
    parent.visible = false
    const sphere = new WaterSphere(moon(), -667.2, makeRenderer())
    parent.add(sphere)

    for (let f = 0; f < 60; f++) sphere.updateObject(makeCtx(0.05))

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

  // Фикс-раунд 1 (ревью, находка №2): renderOrder=10 клал воду ПОСЛЕ обоих
  // атмосферных проходов (пропускание renderOrder=0, in-scatter=1,
  // BrunetonAtmosphere) — океан не домножался на пропускание и закрашивал
  // ореол лимба. Суша непрозрачна и рисуется раньше воды в любом случае
  // (opaque/transparent-разделение three.js), отрицательный renderOrder
  // упорядочивает воду ДО прозрачных проходов атмосферы.
  it('renderOrder патчей — ДО атмосферных проходов (отрицателен)', () => {
    const sphere = new WaterSphere(moon(), -667.2, makeRenderer())
    const patch = sphere.children[0] as Mesh
    expect(WATER_RENDER_ORDER).toBeLessThan(0)
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

  // Task 4: slope-текстура актора стримится асинхронно (ResourceObserver
  // видит только node.renderable — TerrainSphere, не её ребёнка WaterSphere,
  // см. докблок WaterMaterial.updateMaterial/task-3-report concern №3).
  // onVisibleUpdate (хук TerrainPatchGroup) — точка, где WaterSphere сама
  // освежает гейт материала каждый кадр вместо ожидания чужого коллбэка.
  describe('WaterSphere: гейт USE_WATER_DEPTH освежается через onVisibleUpdate (slope-текстура стримится позже конструктора)', () => {
    const MOON_SLOPE_PATH = 'planets/moon/moon_slope.webp' // resources.ts, actorId 19

    it('в конструкторе slope ещё не в resourceStorage — материал в константном режиме', () => {
      const sphere = new WaterSphere(moon(), -667.2, makeRenderer())
      expect(sphere.material.defines.USE_WATER_DEPTH).toBeUndefined()
    })

    it('текстура догрузилась ПОСЛЕ конструктора — первый же updateObject подхватывает гейт', () => {
      const sphere = new WaterSphere(moon(), -667.2, makeRenderer())
      expect(sphere.material.defines.USE_WATER_DEPTH).toBeUndefined()

      const texture = new Texture()
      texture.name = MOON_SLOPE_PATH
      texture.image = { width: 4, height: 2 }
      resourceStorage.addTexture(texture)

      sphere.updateObject(makeCtx(500000))

      expect(sphere.material.defines.USE_WATER_DEPTH).toBe('1')
      expect(sphere.material.uniforms.uSlopeMap.value).toBe(texture)
    })

    it('родитель скрыт (LOD спрятал уровень) — гейт не освежается, тот же гвард видимости, что у дерева', () => {
      const parent = new Group()
      parent.visible = false
      const sphere = new WaterSphere(moon(), -667.2, makeRenderer())
      parent.add(sphere)

      const texture = new Texture()
      texture.name = MOON_SLOPE_PATH
      texture.image = { width: 4, height: 2 }
      resourceStorage.addTexture(texture)

      sphere.updateObject(makeCtx(500000))

      expect(sphere.material.defines.USE_WATER_DEPTH).toBeUndefined()
    })
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
