import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest'
import { Frustum, Matrix4, Mesh, PerspectiveCamera, Texture, type Mesh as ThreeMesh, type WebGLRenderer } from 'three'
import { degToRad } from 'three/src/math/MathUtils'
import { config } from '@/core/framework/config'
import { TerrainPatchGroup, effectiveSplitPixels, POOL_PRESSURE_START, POOL_PRESSURE_GAIN } from '@/core/terrain/TerrainPatchGroup'
import type { TerrainPatchBuilder } from '@/core/terrain/terrainPatchBuilder'
import { PlanetMaterial } from '@/core/materials/PlanetMaterial'
import { TerrainHeightField } from '@/core/terrain/TerrainHeightField'
import { Actor } from '@/core/models/Actor'
import { resourceStorage } from '@/core/services/ResourceStorage'
import { toThreeJSUnits } from '@/core/helpers/scaling'
import type { UpdateContext } from '@/core/UpdateContext'
import type { HeightMapData } from '@/core/terrain/heightMapFormat'
import {
  selectTerrainNodes,
  byBuildPriority,
  terrainNodeKey,
  TERRAIN_QUADTREE_MIN_LEVEL,
  type TerrainNodeAddress
} from '@/core/terrain/terrainQuadtreeSelect'
import { fullyCovered, patchMeshes, unbackedHiddenAddresses } from './coverageHelpers'
import { makeFrameClock } from './frameClock'

// TerrainPatchGroup абстрактен — минимальный конкретный подкласс без
// специализации (материал/хуки TerrainSphere/WaterSphere здесь не нужны),
// открывает protected-конструктор и инъекцию nowMs наружу для теста.
class TestPatchGroup extends TerrainPatchGroup {
  public constructor(
    field: TerrainHeightField,
    material: PlanetMaterial,
    renderer: WebGLRenderer,
    maxLivePatches?: number,
    nowMs?: () => number,
    builder?: TerrainPatchBuilder
  ) {
    super(field, material, renderer, maxLivePatches, undefined, undefined, nowMs, builder)
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

function makeGroup(nowMs?: () => number, maxLivePatches?: number): TestPatchGroup {
  return new TestPatchGroup(makeField(), new PlanetMaterial(moon()), makeRenderer(), maxLivePatches, nowMs)
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

  it('при бюджете «одна постройка» первым строится видимый узел с наибольшей SSE, не грубый за спиной', () => {
    const field = makeField()
    const group = new TestPatchGroup(field, new PlanetMaterial(moon()), makeRenderer(), undefined, sequence([0, 0, 7, 7]))
    const ctx = makeCtx(2)
    const before = new Set(group.children.map((c) => (c as ThreeMesh).userData.terrainAddress).filter(Boolean).map(terrainNodeKey))

    group.updateObject(ctx)

    const added = group.children
      .map((c) => (c as ThreeMesh).userData.terrainAddress as TerrainNodeAddress | undefined)
      .filter((a): a is TerrainNodeAddress => Boolean(a) && !before.has(terrainNodeKey(a!)))
    expect(added).toHaveLength(1)

    // ожидаемый первый — по тому же отбору, что сделала группа (группа в начале координат: frustum = камера)
    const frustum = new Frustum().setFromProjectionMatrix(
      new Matrix4().multiplyMatrices(ctx.camera.projectionMatrix, ctx.camera.matrixWorldInverse)
    )
    const { leaves } = selectTerrainNodes({
      field, cameraLocal: ctx.camera.position.clone(), frustumLocal: frustum, screenHeight: 1080,
      fovYRadians: degToRad(ctx.camera.fov), splitPixels: config('terrain.sseSplitPixels'),
      mergeFactor: config('terrain.sseMergeFactor'), currentlySplit: new Set(), waterLevelMeters: undefined
    })
    const expected = [...leaves].sort(byBuildPriority).find((l) => l.level > TERRAIN_QUADTREE_MIN_LEVEL)!
    expect(expected.visible).toBe(true)
    expect(terrainNodeKey(added[0])).toBe(terrainNodeKey(expected))
  })

  /**
   * Исчерпание пула — режим, в котором своп ЗАСТРЕВАЕТ: замена построена
   * частично (слотов на всех желаемых листьев не хватило), поэтому
   * coverageReady не пускает освобождение родителя, а построенные дети
   * остаются скрытыми сколько угодно кадров. Инвариант обязан держаться и
   * тут: скрытый патч не создаёт дыры, пока над ним жив видимый родитель.
   *
   * Пул 30 = 24 стартовых патча уровня 1 + 6 слотов: на высоте 2 км отбор
   * хочет заметно больше, поэтому режим достигается с первого же кадра.
   */
  it('исчерпанный пул: замена застревает недостроенной, но скрытые патчи всегда перекрыты видимым родителем', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const clock = makeFrameClock()
    const group = makeGroup(clock.nowMs, 30)
    const ctx = makeCtx(2)

    let exhaustedAtFrame = -1
    let maxHidden = 0
    for (let f = 0; f < 200; f++) {
      clock.startFrame()
      group.updateObject(ctx)

      if (exhaustedAtFrame === -1 && warnSpy.mock.calls.some((c) => String(c[0]).includes('пул патчей исчерпан'))) {
        exhaustedAtFrame = f
      }

      maxHidden = Math.max(maxHidden, patchMeshes(group).filter((m) => !m.visible).length)
      expect(unbackedHiddenAddresses(group)).toEqual([])
      expect(fullyCovered(group)).toBe(true)
    }
    warnSpy.mockRestore()

    expect(exhaustedAtFrame).toBeGreaterThanOrEqual(0) // пул действительно исчерпан — режим достигнут
    expect(maxHidden).toBeGreaterThan(0) // и скрытые (недопоказанные) патчи действительно были
    expect(meshCount(group)).toBe(30) // все слоты заняты, дерево застыло
  })
})

describe('клапан пула', () => {
  beforeEach(() => seedPlaceholderKeys())
  afterEach(() => resourceStorage.deleteAllTextures())

  it('ниже 85 % — базовый порог; при полном пуле ×(1+GAIN) = ×4; между — линейно', () => {
    expect(effectiveSplitPixels(6, 0, 1024)).toBe(6)
    expect(effectiveSplitPixels(6, Math.floor(1024 * POOL_PRESSURE_START), 1024)).toBeCloseTo(6, 6)
    expect(effectiveSplitPixels(6, 1024, 1024)).toBeCloseTo(6 * (1 + POOL_PRESSURE_GAIN), 12)
    expect(effectiveSplitPixels(6, 973, 1024)).toBeGreaterThan(6)
    expect(effectiveSplitPixels(6, 973, 1024)).toBeLessThan(24)
  })

  // Высота 600 км: желаемый набор пробивает потолок пула, и клапан коарсит его
  // обратно. У поверхности (2 км) порог не влияет — там ε держит сагитта, не
  // карта. Потолок 32 — первый, на котором пул не касается потолка (30/31 ещё
  // бьют «исчерпан»). Часы кадровые: одна постройка за кадр, иначе фаза
  // предельного цикла клапана зависит от скорости машины.
  it('малый пул (32 слота, 600 км): при давлении набор реально коарсится, «пул исчерпан» не печатается, слоты не замерзают', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const clock = makeFrameClock()
    const group = new TestPatchGroup(makeField(), new PlanetMaterial(moon()), makeRenderer(), 32, clock.nowMs)
    const tail: number[] = []
    for (let f = 0; f < 300; f++) {
      clock.startFrame()
      group.updateObject(makeCtx(600))
      // покадровый пин «без дыр» в режиме давления: под клапаном своп
      // застревает недостроенным (видимым остаётся базовый набор L1), поэтому
      // пин ловит прежде всего преждевременное освобождение узла
      expect(unbackedHiddenAddresses(group)).toEqual([])
      expect(fullyCovered(group)).toBe(true)
      if (f >= 280) tail.push(meshCount(group))
    }
    expect(warn).not.toHaveBeenCalledWith(expect.stringContaining('пул патчей исчерпан'))
    expect(Math.max(...tail)).toBeLessThanOrEqual(32)
    // на кадровых часах режим выходит на предельный цикл периода 8 (24 → 31 → 24):
    // клапан доводит набор до коарсенного пола, а не упирается в потолок
    expect(tail).toContain(24)
    // после отлёта набор возвращается к 24 — слоты освобождены, не заморожены
    for (let f = 0; f < 200; f++) {
      clock.startFrame()
      group.updateObject(makeCtx(500000))
      expect(unbackedHiddenAddresses(group)).toEqual([])
      expect(fullyCovered(group)).toBe(true)
    }
    expect(meshCount(group)).toBe(24)
    warn.mockRestore()
  })

  // Доказательство подключения клапана к updateObject: сравнение с потолком
  // САМО ПО СЕБЕ не дискриминирует (acquire() и без клапана держит meshCount
  // <= cap тривиально). Дискриминирует ОТКАТ ПОСЛЕ ПИКА: без клапана набор
  // растёт до потолка и застывает там, с клапаном давление поднимает порог и
  // набор откатывается — минимум ПОСЛЕ пика строго меньше самого пика.
  it('клапан подключён к updateObject: набор откатывается вниз после пика, не застывает на потолке', () => {
    const clock = makeFrameClock()
    const group = new TestPatchGroup(makeField(), new PlanetMaterial(moon()), makeRenderer(), 32, clock.nowMs)
    const counts: number[] = []
    for (let f = 0; f < 300; f++) {
      clock.startFrame()
      group.updateObject(makeCtx(600))
      expect(unbackedHiddenAddresses(group)).toEqual([])
      expect(fullyCovered(group)).toBe(true)
      counts.push(meshCount(group))
    }
    const peak = Math.max(...counts)
    const peakIndex = counts.indexOf(peak)
    const minAfterPeak = Math.min(...counts.slice(peakIndex))
    expect(minAfterPeak).toBeLessThan(peak)
  })

  // Пул 44 и качающаяся высота: давление доходит до 1.0, а сплиты ДОВОДЯТСЯ
  // до показа (видимая глубина L2) — клапан и атомарный своп работают
  // одновременно, чего стенд 32/600 км не даёт
  it('клапан × атомарный своп: под давлением с завершёнными сплитами «без дыр» держится каждый кадр', () => {
    const clock = makeFrameClock()
    const group = new TestPatchGroup(makeField(), new PlanetMaterial(moon()), makeRenderer(), 44, clock.nowMs)
    for (let f = 0; f < 800; f++) {
      clock.startFrame()
      group.updateObject(makeCtx(2 + 1500 * (0.5 + 0.5 * Math.sin(f / 41))))
      expect(unbackedHiddenAddresses(group)).toEqual([])
      expect(fullyCovered(group)).toBe(true)
    }
  })
})
