import { describe, expect, it, beforeEach, afterEach } from 'vitest'
import { Mesh, PerspectiveCamera, Texture, type WebGLRenderer } from 'three'
import { config } from '@/core/framework/config'
import { TerrainPatchGroup } from '@/core/terrain/TerrainPatchGroup'
import { PlanetMaterial } from '@/core/materials/PlanetMaterial'
import { TerrainHeightField } from '@/core/terrain/TerrainHeightField'
import { Actor } from '@/core/models/Actor'
import { resourceStorage } from '@/core/services/ResourceStorage'
import { toThreeJSUnits } from '@/core/helpers/scaling'
import type { UpdateContext } from '@/core/UpdateContext'
import type { HeightMapData } from '@/core/terrain/heightMapFormat'

// TerrainPatchGroup абстрактен — минимальный конкретный подкласс без
// специализации (материал/хуки TerrainSphere/WaterSphere здесь не нужны),
// открывает protected-конструктор и инъекцию nowMs наружу для теста.
class TestPatchGroup extends TerrainPatchGroup {
  public constructor(field: TerrainHeightField, material: PlanetMaterial, renderer: WebGLRenderer, nowMs?: () => number) {
    super(field, material, renderer, undefined, undefined, undefined, nowMs)
  }
}

// Луна (actorId 19) — тело с height-ресурсом (см. TerrainPatchPool.spec.ts)
function moon(): Actor {
  return Actor.find(19)!
}

function seedTexture(name: string): void {
  const texture = new Texture()
  texture.name = name
  texture.image = { width: 4, height: 2 }
  resourceStorage.addTexture(texture)
}

// PlanetMaterial в конструкторе ходит за плейсхолдерами (см. TerrainPatchPool.spec.ts)
function seedPlaceholderKeys(): void {
  seedTexture('')
  seedTexture('default.png')
  seedTexture('night.jpg')
  seedTexture(moon().resources.where('resourceType', 'diffuse').first()!.getAttribute('path') as string)
}

// 64×32, не константа — набор растёт при приближении, а не остаётся
// минимальным на любой дистанции (см. TerrainSphere.spec.ts makeField)
function makeField(): TerrainHeightField {
  const width = 64
  const height = 32
  const data = new Uint16Array(width * height)
  for (let k = 0; k < data.length; k++) data[k] = (k * 4001) % 65535

  const map: HeightMapData = { width, height, minMeters: 0, maxMeters: 1000, data }
  return new TerrainHeightField(map, 1737.4)
}

function makeRenderer(height = 1080): WebGLRenderer {
  return { domElement: { height } } as unknown as WebGLRenderer
}

// камера у поверхности — первый же updateObject уже хочет листья глубже
// начального минимального набора (24 патча), buildQueue заведомо не пуст
function makeCtx(altKm: number): UpdateContext {
  const camera = new PerspectiveCamera(50, 1, 1e-6, 1e9)
  camera.position.set(toThreeJSUnits(1737.4 + altKm), 0, 0)
  camera.updateMatrixWorld(true)
  return { delta: 0.016, epoch: 0, elapsed: 0, camera } as UpdateContext
}

// детерминированные часы теста — зажимаются на последнем значении, чтобы
// вызовы cверх длины массива (пропуски уже живых узлов и т.п.) не читали undefined
function sequence(values: number[]): () => number {
  let i = 0
  return () => values[Math.min(i++, values.length - 1)]
}

function makeGroup(nowMs?: () => number): TestPatchGroup {
  return new TestPatchGroup(makeField(), new PlanetMaterial(moon()), makeRenderer(), nowMs)
}

function meshCount(group: TestPatchGroup): number {
  return group.children.filter((c) => c instanceof Mesh).length
}

describe('TerrainPatchGroup: бюджет построек патчей по времени кадра', () => {
  beforeEach(() => seedPlaceholderKeys())
  afterEach(() => resourceStorage.deleteAllTextures())

  it('конфиг: patchBuildBudgetMs === 6 (дефолт)', () => {
    expect(config('terrain.lod.patchBuildBudgetMs')).toBe(6)
  })

  it('первая постройка укладывается в бюджет, вторая уже вне него — построен ровно 1 патч за кадр', () => {
    const group = makeGroup(sequence([0, 0, 7, 7]))
    const before = meshCount(group)

    group.updateObject(makeCtx(2))

    expect(meshCount(group) - before).toBe(1)
  })

  it('бюджет не исчерпан за пределами первой постройки — построено не менее 4 патчей', () => {
    const group = makeGroup(sequence([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10]))
    const before = meshCount(group)

    group.updateObject(makeCtx(2))

    expect(meshCount(group) - before).toBeGreaterThanOrEqual(4)
  })
})
