import { describe, expect, it, beforeEach, afterEach } from 'vitest'
import { PerspectiveCamera, Texture, type Mesh, type WebGLRenderer } from 'three'
import { terrain as terrainConfig } from '@/config/terrain'
import { TerrainPatchGroup } from '@/core/terrain/TerrainPatchGroup'
import type { PatchBuildJob, PatchBuildResult, TerrainPatchBuilder } from '@/core/terrain/terrainPatchBuilder'
import { PlanetMaterial } from '@/core/materials/PlanetMaterial'
import { TerrainHeightField } from '@/core/terrain/TerrainHeightField'
import { Actor } from '@/core/models/Actor'
import { resourceStorage } from '@/core/services/ResourceStorage'
import { toThreeJSUnits } from '@/core/helpers/scaling'
import type { UpdateContext } from '@/core/UpdateContext'
import type { HeightMapData } from '@/core/terrain/heightMapFormat'
import { liveAncestorKey, nodeKeyOf, terrainNodeKey, type TerrainNodeAddress } from '@/core/terrain/terrainQuadtreeSelect'
import { addressOf, fullyCovered, patchMeshes, unbackedHiddenAddresses, visibleAddressKeys } from './coverageHelpers'
import { FakeAsyncBuilder } from './fakeAsyncBuilder'

// Харнесс — копия TerrainPatchGroupAsync.spec.ts, плюс флаг морфа группы.
class TestPatchGroup extends TerrainPatchGroup {
  public constructor(
    field: TerrainHeightField,
    material: PlanetMaterial,
    renderer: WebGLRenderer,
    builder: TerrainPatchBuilder,
    morph?: boolean
  ) {
    super(field, material, renderer, undefined, undefined, undefined, undefined, builder, morph)
  }

  public get liveKeys(): Set<number> {
    return new Set((this as unknown as { live: Map<number, unknown> }).live.keys())
  }
}

/** Перехват заданий: флаг morph каждого запроса. */
class RecordingBuilder extends FakeAsyncBuilder {
  public readonly jobs: PatchBuildJob[] = []

  public override request(job: PatchBuildJob, onDone: (r: PatchBuildResult) => void, onError: (e: unknown) => void): void {
    this.jobs.push({ ...job })
    super.request(job, onDone, onError)
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

function makeCtx(altKm: number, delta = 0.1): UpdateContext {
  const camera = new PerspectiveCamera(50, 1, 1e-6, 1e9)
  camera.position.set(toThreeJSUnits(1737.4 + altKm), 0, 0)
  camera.updateMatrixWorld(true)
  return { delta, epoch: 0, elapsed: 0, camera } as UpdateContext
}

function makeAsync(morph = true, builder: FakeAsyncBuilder = new FakeAsyncBuilder()): {
  group: TestPatchGroup
  builder: FakeAsyncBuilder
} {
  const group = new TestPatchGroup(makeField(), new PlanetMaterial(moon()), makeRenderer(), builder, morph)
  return { group, builder }
}

function morphOf(mesh: Mesh): number {
  return (mesh.geometry.getAttribute('patchMorph').array as Float32Array)[0]
}

type Snap = { mesh: Mesh; address: TerrainNodeAddress; visible: boolean; morph: number }

/** Патчи в сцене по ключу узла: видимость и m на конец кадра. */
function snapshot(group: TestPatchGroup): Map<number, Snap> {
  const out = new Map<number, Snap>()
  for (const mesh of patchMeshes(group)) {
    const address = addressOf(mesh)
    const morph = mesh.geometry.getAttribute('patchMorph') === undefined ? 0 : morphOf(mesh)
    out.set(terrainNodeKey(address), { mesh, address, visible: mesh.visible, morph })
  }
  return out
}

function parentKey(a: TerrainNodeAddress): number {
  return nodeKeyOf(a.face, a.level - 1, a.i >> 1, a.j >> 1)
}

function childKeys(a: TerrainNodeAddress): number[] {
  const keys: number[] = []
  for (let di = 0; di < 2; di++) {
    for (let dj = 0; dj < 2; dj++) keys.push(nodeKeyOf(a.face, a.level + 1, 2 * a.i + di, 2 * a.j + dj))
  }
  return keys
}

/** Кадр: приход всего запрошенного, затем отбор/своп. */
function frame(group: TestPatchGroup, builder: FakeAsyncBuilder, altKm: number, delta = 0.1): void {
  builder.flush()
  group.updateObject(makeCtx(altKm, delta))
}

function settle(group: TestPatchGroup, builder: FakeAsyncBuilder, altKm: number): void {
  for (let f = 0; f < 60; f++) frame(group, builder, altKm)
  expect(builder.queued).toBe(0)
  expect(group.pendingCount).toBe(0)
}

// 600 км — дробится ровно на уровень (четыре L1 → 16 L2), 500 км — ещё два L2
// дробятся в L3, 50 км — узлы L1 уходят сразу в смесь уровней ≥ 2
const NEAR = 600
const NEARER = 500
const FAR = 20000
const DEEP = 50

describe('TerrainPatchGroup: геоморф поверх атомарного свопа', () => {
  beforeEach(() => seedPlaceholderKeys())
  afterEach(() => resourceStorage.deleteAllTextures())

  it('сплит: ставшие видимыми дети видимого родителя входят с m = 1 и спадают за morphSeconds; родитель уходит в кадр свопа', () => {
    const { group, builder } = makeAsync()
    settle(group, builder, FAR)

    const sequences = new Map<number, number[]>()
    let prev = snapshot(group)
    for (let f = 0; f < 30; f++) {
      frame(group, builder, NEAR)
      const cur = snapshot(group)
      expect(fullyCovered(group)).toBe(true)
      expect(unbackedHiddenAddresses(group)).toEqual([])

      for (const [key, s] of cur) {
        if (sequences.has(key)) sequences.get(key)!.push(s.morph)
        if (!s.visible || prev.get(key)?.visible) continue
        const parent = parentKey(s.address)
        if (!prev.get(parent)?.visible) continue
        expect(s.morph).toBe(1)
        expect(cur.has(parent)).toBe(false)
        sequences.set(key, [s.morph])
      }
      prev = cur
    }

    expect(sequences.size).toBe(16)
    for (const seq of sequences.values()) {
      const expected = [1, 0.75, 0.5, 0.25, 0, 0]
      for (let k = 0; k < expected.length; k++) expect(seq[k]).toBeCloseTo(expected[k], 6)
      expect(seq.at(-1)).toBe(0)
    }
  })

  it('ожидание сплита: ребёнок в морфе не заменяется, пока m > 0; затем своп во внуков с m = 1', () => {
    const { group, builder } = makeAsync()
    settle(group, builder, FAR)

    // мелкий шаг: дети NEAR ещё в морфе, когда придут внуки
    const dt = 0.02
    for (let f = 0; f < 30; f++) {
      frame(group, builder, NEAR, dt)
      if ([...snapshot(group).values()].filter((s) => s.visible && s.address.level === 2).length === 16) break
    }
    expect([...snapshot(group).values()].some((s) => s.visible && s.morph === 1)).toBe(true)

    let waited = false
    let grandRevealed = 0
    let prev = snapshot(group)
    for (let f = 0; f < 60; f++) {
      frame(group, builder, NEARER, dt)
      const cur = snapshot(group)
      expect(fullyCovered(group)).toBe(true)

      for (const [key, s] of cur) {
        if (s.visible && s.morph > 0) {
          // в морфе: пришедшие дети ждут скрытыми
          for (const child of childKeys(s.address)) {
            const c = cur.get(child)
            if (c === undefined) continue
            expect(c.visible).toBe(false)
            waited = true
          }
        }
        if (s.visible && !prev.get(key)?.visible && s.address.level === 3) {
          const parent = prev.get(parentKey(s.address))
          if (parent?.visible) {
            grandRevealed++
            expect(s.morph).toBe(1)
            // родитель досмотрел к 0 в этом же кадре (шаг dt / 0.4 с прошлого)
            expect(parent.morph).toBeLessThanOrEqual(dt / 0.4 + 1e-6)
            expect(cur.has(parentKey(s.address))).toBe(false)
          }
        }
      }
      prev = cur
    }

    expect(waited).toBe(true)
    expect(grandRevealed).toBe(8)
  })

  it('мерж: дети растят m к 1 при скрытом готовом родителе, своп в кадр всех m = 1, родитель видим с m = 0', () => {
    const { group, builder } = makeAsync()
    settle(group, builder, NEAR)

    const childSeqs = new Map<number, number[]>()
    let merges = 0
    let prev = snapshot(group)
    for (let f = 0; f < 30; f++) {
      frame(group, builder, FAR)
      const cur = snapshot(group)
      expect(fullyCovered(group)).toBe(true)
      expect(unbackedHiddenAddresses(group)).toEqual([])

      for (const [key, s] of cur) {
        if (s.address.level !== 1) continue
        const children = childKeys(s.address)
        if (!s.visible) {
          // скрытый готовый родитель: все четыре ребёнка видимы и растят m
          for (const child of children) {
            const c = cur.get(child)!
            expect(c.visible).toBe(true)
            const seq = childSeqs.get(child) ?? []
            seq.push(c.morph)
            childSeqs.set(child, seq)
          }
        } else if (prev.get(key)?.visible === false) {
          merges++
          expect(s.morph).toBe(0)
          for (const child of children) {
            expect(cur.has(child)).toBe(false)
            // меш ребёнка в кадр свопа (слот уже в пуле) несёт финальный m
            expect(morphOf(prev.get(child)!.mesh)).toBe(1)
          }
        }
      }
      prev = cur
    }

    expect(merges).toBe(4)
    expect(childSeqs.size).toBe(16)
    for (const seq of childSeqs.values()) {
      expect(seq).toHaveLength(4)
      const expected = [0, 0.25, 0.5, 0.75]
      for (let k = 0; k < expected.length; k++) expect(seq[k]).toBeCloseTo(expected[k], 6)
    }
  })

  it('отмена мержа: посреди роста камера вернулась — m детей спадает к 0, скрытый родитель освобождён, m = 1 повторно не ставится', () => {
    const { group, builder } = makeAsync()
    settle(group, builder, NEAR)

    let parentKeys: number[] = []
    for (let f = 0; f < 30; f++) {
      frame(group, builder, FAR)
      const cur = snapshot(group)
      const hidden = [...cur.values()].filter((s) => s.address.level === 1 && !s.visible)
      const growing = hidden.filter((p) => childKeys(p.address).every((c) => Math.abs(cur.get(c)!.morph - 0.5) < 1e-6))
      if (growing.length > 0) {
        parentKeys = growing.map((p) => terrainNodeKey(p.address))
        break
      }
    }
    expect(parentKeys.length).toBeGreaterThan(0)

    const children = parentKeys.flatMap((k) => childKeys(snapshot(group).get(k)!.address))
    const seqs = children.map(() => [] as number[])
    for (let f = 0; f < 10; f++) {
      frame(group, builder, NEAR)
      const cur = snapshot(group)
      expect(fullyCovered(group)).toBe(true)
      for (const key of parentKeys) {
        expect(group.liveKeys.has(key)).toBe(false)
        expect(cur.has(key)).toBe(false)
      }
      children.forEach((key, n) => {
        const c = cur.get(key)!
        expect(c.visible).toBe(true)
        seqs[n].push(c.morph)
      })
    }
    for (const seq of seqs) {
      const expected = [0.25, 0, 0]
      for (let k = 0; k < expected.length; k++) expect(seq[k]).toBeCloseTo(expected[k], 6)
      expect(seq.every((m, k) => k === 0 || m <= seq[k - 1])).toBe(true)
    }
  })

  it('через уровень: прыжок с FAR сразу на DEEP — своп мгновенный, все видимые m = 0', () => {
    const { group, builder } = makeAsync()
    settle(group, builder, FAR)

    for (let f = 0; f < 60; f++) {
      frame(group, builder, DEEP)
      expect(fullyCovered(group)).toBe(true)
      for (const s of snapshot(group).values()) if (s.visible) expect(s.morph).toBe(0)
    }
    expect(Math.max(...[...snapshot(group).values()].map((s) => s.address.level))).toBeGreaterThan(3)
  })

  it('morphSeconds = 0: все m = 0, тайминг свопов как у группы без морфа', () => {
    const lod = terrainConfig.terrain.lod as { morphSeconds: number }
    const saved = lod.morphSeconds
    lod.morphSeconds = 0
    try {
      const a = makeAsync(true)
      const b = makeAsync(false)
      const script = [...Array<number>(30).fill(NEAR), ...Array<number>(30).fill(FAR), ...Array<number>(3).fill(NEAR), ...Array<number>(30).fill(DEEP)]
      for (const alt of script) {
        frame(a.group, a.builder, alt)
        frame(b.group, b.builder, alt)
        const sa = snapshot(a.group)
        const sb = snapshot(b.group)
        expect([...sa.keys()].sort()).toEqual([...sb.keys()].sort())
        for (const [key, s] of sa) {
          expect(s.visible).toBe(sb.get(key)!.visible)
          expect(s.morph).toBe(0)
        }
      }
    } finally {
      lod.morphSeconds = saved
    }
  })

  it('переиспользование слота: после мержа и нового сплита пришедший патч несёт m = 0 до свопа', () => {
    const { group, builder } = makeAsync()
    settle(group, builder, NEAR)
    settle(group, builder, FAR) // мерж: слоты детей ушли в пул с m = 1

    group.updateObject(makeCtx(NEAR))
    builder.flush() // приход — скрытые дети в слотах из пула
    const hidden = [...snapshot(group).values()].filter((s) => !s.visible)
    expect(hidden.length).toBeGreaterThan(0)
    for (const s of hidden) expect(s.morph).toBe(0)
  })

  it('флаг задания: корни morph = false, глубже true', () => {
    const builder = new RecordingBuilder()
    const { group } = makeAsync(true, builder)
    settle(group, builder, NEAR)
    expect(builder.jobs.length).toBeGreaterThan(24)
    for (const job of builder.jobs) expect(job.morph).toBe(job.level > 1)
  })

  it('мерж, перебитый спуском на два уровня: скрытый предок уходит, не показывая внуков поверх видимого родителя в морфе', () => {
    const { group, builder } = makeAsync()
    settle(group, builder, NEAR)
    for (let f = 0; f < 5; f++) frame(group, builder, FAR) // мерж начат: дети растят m

    let revealedUnderVisible = 0
    let prev = snapshot(group)
    for (let f = 0; f < 40; f++) {
      frame(group, builder, NEARER)
      const cur = snapshot(group)
      expect(fullyCovered(group)).toBe(true)
      // нет пары «видимый предок + видимый потомок»
      const visible = visibleAddressKeys(group)
      for (const s of cur.values()) {
        if (s.visible) expect(liveAncestorKey(s.address, (k) => visible.has(k))).toBe(-1)
      }
      for (const [key, s] of cur) {
        if (!s.visible || prev.get(key)?.visible || s.address.level !== 3) continue
        if (!prev.get(parentKey(s.address))?.visible) continue
        revealedUnderVisible++
        expect(s.morph).toBe(1)
      }
      prev = cur
    }
    expect(revealedUnderVisible).toBe(8)
  })

  it('вода: группа без флага — атрибута patchMorph нет, morph задания null', () => {
    const builder = new RecordingBuilder()
    const { group } = makeAsync(false, builder)
    settle(group, builder, NEAR)
    expect(builder.jobs.length).toBeGreaterThan(24)
    for (const job of builder.jobs) expect(job.morph).toBeNull()
    for (const mesh of patchMeshes(group)) expect(mesh.geometry.getAttribute('patchMorph')).toBeUndefined()
  })
})
