import { describe, expect, it, beforeEach, afterEach } from 'vitest'
import { Mesh, PerspectiveCamera, Texture, type WebGLRenderer } from 'three'
import { config } from '@/core/framework/config'
import { TerrainPatchGroup } from '@/core/terrain/TerrainPatchGroup'
import { SyncTerrainPatchBuilder, type TerrainPatchBuilder } from '@/core/terrain/terrainPatchBuilder'
import { PlanetMaterial } from '@/core/materials/PlanetMaterial'
import { TerrainHeightField } from '@/core/terrain/TerrainHeightField'
import { Actor } from '@/core/models/Actor'
import { resourceStorage } from '@/core/services/ResourceStorage'
import { toThreeJSUnits } from '@/core/helpers/scaling'
import type { UpdateContext } from '@/core/UpdateContext'
import type { HeightMapData } from '@/core/terrain/heightMapFormat'
import { fullyCovered, unbackedHiddenAddresses } from './coverageHelpers'
import { makeFrameClock } from './frameClock'
import { FakeAsyncBuilder } from './fakeAsyncBuilder'

// Сетап скопирован с TerrainPatchGroupBudget.spec.ts: тот же минимальный
// конкретный подкласс и то же поле-Луна, но конструктор берёт ещё и строителя,
// а livePool открывает занятость пула (pending держит слоты вне сцены).
class TestPatchGroup extends TerrainPatchGroup {
  public constructor(
    field: TerrainHeightField,
    material: PlanetMaterial,
    renderer: WebGLRenderer,
    builder: TerrainPatchBuilder,
    maxLivePatches?: number,
    nowMs?: () => number
  ) {
    super(field, material, renderer, maxLivePatches, undefined, undefined, nowMs, builder)
  }

  public get livePool(): number {
    return (this as unknown as { pool: { liveCount: number } }).pool.liveCount
  }
}

function moon(): Actor {
  return Actor.find(19)!
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

function makeCtx(altKm: number): UpdateContext {
  const camera = new PerspectiveCamera(50, 1, 1e-6, 1e9)
  camera.position.set(toThreeJSUnits(1737.4 + altKm), 0, 0)
  camera.updateMatrixWorld(true)
  return { delta: 0.016, epoch: 0, elapsed: 0, camera } as UpdateContext
}

function meshCount(group: TestPatchGroup): number {
  return group.children.filter((c) => c instanceof Mesh).length
}

function makeAsync(maxLivePatches?: number): {
  group: TestPatchGroup
  builder: FakeAsyncBuilder
  clock: ReturnType<typeof makeFrameClock>
} {
  const builder = new FakeAsyncBuilder()
  const clock = makeFrameClock()
  const group = new TestPatchGroup(makeField(), new PlanetMaterial(moon()), makeRenderer(), builder, maxLivePatches, clock.nowMs)
  return { group, builder, clock }
}

describe('TerrainPatchGroup с асинхронным строителем', () => {
  beforeEach(() => seedPlaceholderKeys())
  afterEach(() => resourceStorage.deleteAllTextures())

  it('начальный набор: 24 запроса в конструкторе, ready только после 24 приходов, начальные патчи видимы', () => {
    const { group, builder } = makeAsync()
    expect(builder.queued).toBe(24)
    expect(meshCount(group)).toBe(0)
    expect(group.ready).toBe(false)
    let readyCalls = 0
    group.whenReady(() => readyCalls++)
    builder.flush(23)
    expect(group.ready).toBe(false)
    expect(readyCalls).toBe(0)
    builder.flush(1)
    expect(group.ready).toBe(true)
    expect(readyCalls).toBe(1)
    expect(meshCount(group)).toBe(24)
    expect(group.children.every((c) => !(c instanceof Mesh) || c.visible)).toBe(true)
    group.whenReady(() => readyCalls++) // уже готова — сразу
    expect(readyCalls).toBe(2)
  })

  it('синхронный строитель: ready в конструкторе, 24 меша сразу', () => {
    const group = new TestPatchGroup(makeField(), new PlanetMaterial(moon()), makeRenderer(), new SyncTerrainPatchBuilder())
    expect(group.ready).toBe(true)
    expect(meshCount(group)).toBe(24)
  })

  it('pending — не покрытие: родитель живёт, пока дети не пришли; после flush своп без дыр; потолок buildInFlight', () => {
    const { group, builder, clock } = makeAsync()
    builder.flush()
    const ctx = makeCtx(2)
    clock.startFrame(); group.updateObject(ctx)
    expect(builder.queued).toBe(config('terrain.lod.buildInFlight'))
    expect(group.pendingCount).toBe(config('terrain.lod.buildInFlight'))
    expect(meshCount(group)).toBe(24)                  // pending не в сцене
    expect(group.livePool).toBe(24 + group.pendingCount) // но слоты захвачены
    expect(fullyCovered(group)).toBe(true)
    for (let f = 0; f < 60; f++) {
      builder.flush(6)
      clock.startFrame(); group.updateObject(ctx)
      expect(unbackedHiddenAddresses(group)).toEqual([])
      expect(fullyCovered(group)).toBe(true)
      expect(group.pendingCount).toBeLessThanOrEqual(config('terrain.lod.buildInFlight'))
    }
    expect(meshCount(group)).toBeGreaterThan(24)
  })

  it('устаревший результат: узел вышел из wanted до прихода — слот освобождён, меш не в сцене', () => {
    const { group, builder, clock } = makeAsync()
    builder.flush()
    clock.startFrame(); group.updateObject(makeCtx(2))
    const inFlight = group.pendingCount
    expect(inFlight).toBeGreaterThan(0)
    clock.startFrame(); group.updateObject(makeCtx(500000))   // хочет только базовый набор
    builder.flush()
    expect(group.pendingCount).toBe(0)
    expect(meshCount(group)).toBe(24)
    expect(group.livePool).toBe(24)
  })

  it('dispose до прихода: приход ничего не пишет, слоты свободны, поле отпущено строителю', () => {
    const { group, builder, clock } = makeAsync()
    builder.flush()
    clock.startFrame(); group.updateObject(makeCtx(2))
    group.dispose()
    expect(group.livePool).toBe(0)
    expect(() => builder.flush()).not.toThrow()
    expect(group.livePool).toBe(0)
    expect(meshCount(group)).toBe(0)
    expect(builder.released).toHaveLength(1)
  })

  it('узел вышел из wanted и вернулся до прихода: pending не перезапрашивается, приход применяется', () => {
    const { group, builder, clock } = makeAsync()
    builder.flush()
    clock.startFrame(); group.updateObject(makeCtx(2))        // 6 запросов
    clock.startFrame(); group.updateObject(makeCtx(500000))   // не нужны
    clock.startFrame(); group.updateObject(makeCtx(2))        // нужны снова — ключи уже в pending, новых запросов нет
    expect(builder.queued).toBe(config('terrain.lod.buildInFlight'))
    builder.flush()
    expect(group.pendingCount).toBe(0)
    expect(meshCount(group)).toBe(24 + config('terrain.lod.buildInFlight'))
    clock.startFrame(); group.updateObject(makeCtx(2))
    expect(unbackedHiddenAddresses(group)).toEqual([])
    expect(fullyCovered(group)).toBe(true)
  })

  it('конструктор заявляет владение полем, dispose отпускает — ровно по разу', () => {
    const { group, builder } = makeAsync()
    expect(builder.acquired).toHaveLength(1)
    group.dispose()
    expect(builder.released).toHaveLength(1)
    expect(builder.released[0]).toBe(builder.acquired[0])
  })
})
