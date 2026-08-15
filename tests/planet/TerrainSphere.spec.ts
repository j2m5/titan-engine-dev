import { describe, expect, it, beforeEach, afterEach } from 'vitest'
import { Mesh, PerspectiveCamera, Texture } from 'three'
import { PATCH_BUILDS_PER_FRAME, TerrainSphere } from '@/core/renderables/TerrainSphere'
import { TerrainHeightField } from '@/core/terrain/TerrainHeightField'
import { Actor } from '@/core/models/Actor'
import { resourceStorage } from '@/core/services/ResourceStorage'
import { toThreeJSUnits } from '@/core/helpers/scaling'
import type { UpdateContext } from '@/core/UpdateContext'
import type { HeightMapData } from '@/core/terrain/heightMapFormat'
import type { TerrainNodeAddress } from '@/core/terrain/terrainQuadtreeSelect'

// Луна (actorId 19) — тело с height-ресурсом
function moon(): Actor {
  return Actor.find(19)!
}

// 64×32, не константа: у SSE-порога амплитуда должна быть пробиваема на всех
// уровнях (см. flatField в terrainQuadtreeSelect.spec) — набор растёт при
// приближении, а не остаётся минимальным на любой дистанции
function makeField(): TerrainHeightField {
  const width = 64
  const height = 32
  const data = new Uint16Array(width * height)
  for (let k = 0; k < data.length; k++) data[k] = (k * 4001) % 65535

  const map: HeightMapData = { width, height, minMeters: 0, maxMeters: 1000, data }
  return new TerrainHeightField(map, 1737.4)
}

function seedTexture(name: string): void {
  const texture = new Texture()
  texture.name = name
  texture.image = { width: 4, height: 2 }
  resourceStorage.addTexture(texture)
}

// PlanetMaterial в конструкторе ходит за плейсхолдерами (см. PlanetMaterialMaps.spec)
function seedPlaceholderKeys(): void {
  seedTexture('')
  seedTexture('default.png')
  seedTexture('night.jpg')
  seedTexture(moon().resources.where('resourceType', 'diffuse').first()!.getAttribute('path') as string)
}

// камера над (1,0,0) на заданной высоте (км)
function makeCtx(altKm: number): UpdateContext {
  const camera = new PerspectiveCamera(50, 1, 1e-6, 1e9)
  camera.position.set(toThreeJSUnits(1736 + altKm), 0, 0)
  camera.updateMatrixWorld(true)
  return { delta: 0.016, epoch: 0, elapsed: 0, camera } as UpdateContext
}

// покрытие: сумма 4^{-(level-1)} по ВИДИМЫМ мешам — перекрытие родитель+дети
// допустимо (инвариант «без дыр» требует только ≥ полного покрытия сферы = 24)
function visibleLeavesCoverage(sphere: TerrainSphere): number {
  let sum = 0
  for (const child of sphere.children) {
    if (!(child instanceof Mesh) || !child.visible) continue
    const address = child.userData.terrainAddress as TerrainNodeAddress | undefined
    if (!address) continue
    sum += 4 ** -(address.level - 1)
  }
  return sum
}

describe('TerrainSphere: динамическое квадродерево патчей', { timeout: 30000 }, () => {
  beforeEach(() => seedPlaceholderKeys())
  afterEach(() => resourceStorage.deleteAllTextures())

  it('конструктор строит минимальный набор уровня 1 (24 меша)', () => {
    const sphere = new TerrainSphere(moon(), makeField())
    expect(sphere.children.filter((c) => c instanceof Mesh)).toHaveLength(24)
  })

  it('контракты снапшота и стриминга: model/type/clickable на группе, .material — PlanetMaterial', () => {
    const actor = moon()
    const sphere = new TerrainSphere(actor, makeField())

    expect(sphere.model).toBe(actor)
    expect(sphere.userData.type).toBe('planet')
    expect(sphere.userData.clickable).toBe(true)
    expect(sphere.material.constructor.name).toBe('PlanetMaterial')

    const patch = sphere.children[0] as Mesh
    expect(patch.material).toBe(sphere.material)
    expect(patch.userData.clickable).toBe(true)
  })

  it('за серию кадров у поверхности набор растёт и сходится; покрытие без дыр на каждом кадре', () => {
    const sphere = new TerrainSphere(moon(), makeField())
    const ctx = makeCtx(2)
    const counts: number[] = []
    for (let f = 0; f < 120; f++) {
      sphere.updateObject(ctx)
      const cover = visibleLeavesCoverage(sphere)
      expect(cover).toBeGreaterThanOrEqual(24 - 1e-9)
      counts.push(sphere.children.filter((c) => c instanceof Mesh && c.visible).length)
    }
    expect(counts.at(-1)!).toBeGreaterThan(24)
    expect(counts.at(-1)).toEqual(counts.at(-10))
  })

  it('удаление камеры мержит обратно к 24', () => {
    const sphere = new TerrainSphere(moon(), makeField())
    for (let f = 0; f < 120; f++) sphere.updateObject(makeCtx(2))
    for (let f = 0; f < 200; f++) sphere.updateObject(makeCtx(500000))
    expect(sphere.children.filter((c) => c instanceof Mesh).length).toBe(24)
  })

  it('невидимый (LOD → FakePlanet) — заморожен', () => {
    const sphere = new TerrainSphere(moon(), makeField())
    const before = sphere.children.length
    sphere.visible = false
    sphere.updateObject(makeCtx(2))
    expect(sphere.children.length).toBe(before)
  })

  it('бюджет построек соблюдается: за один кадр добавляется ≤ PATCH_BUILDS_PER_FRAME мешей', () => {
    const sphere = new TerrainSphere(moon(), makeField())
    const before = sphere.children.length
    sphere.updateObject(makeCtx(2))
    expect(sphere.children.length - before).toBeLessThanOrEqual(PATCH_BUILDS_PER_FRAME)
  })
})
