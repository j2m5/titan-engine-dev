import { describe, it, expect, vi, afterEach } from 'vitest'
import { Scene, Texture, Vector3 } from 'three'
import { ResourceObserver } from '@/core/services/ResourceObserver'
import { TextureBudget, textureBytes } from '@/core/streaming/TextureBudget'
import { resourceStorage } from '@/core/services/ResourceStorage'
import { STEEP_DETAIL_PATHS } from '@/core/terrain/steepDetailPaths'
import { Scenarios } from '@/config/scenarios'
import type { SceneObserver, ObservableRecord } from '@/core/services/SceneObserver'
import type { TextureProvider } from '@/core/textures/TextureProvider'
import type { TextureRequest, LoadResult } from '@/core/textures/types'
import type { LoadingProgressReporter } from '@/core/ports/LoadingProgressReporter'
import type { NotificationSink } from '@/core/ports/NotificationSink'

/**
 * Steep-набор зон материала (задача 4 «Material Zones»): у терраформного тела
 * с height-ресурсом и родным detailDiffuse ≠ STEEP_DETAIL_PATHS.diffuse
 * `collectCandidates` обязан добавить в кандидатов ТРИ синтетических пути
 * (rocky_trail_diff/nor/arm) с рангами 2.31/2.32/2.33 — тот же поток, что и
 * у соседних `ResourceObserver*.spec.ts`: реальная БД, честный проход через
 * `closestChange`, без прямых вызовов приватных методов.
 *
 * Энцелад (ice-архетип) — тело с честным родным detail-набором, отличным от
 * steep. Луна (rocky-архетип) уже стримит сам steep-набор как родной
 * detailDiffuse — гейт обязан не дублировать его. Сатурн — легаси-гигант без
 * height-ресурса вовсе, steep-набору неоткуда взяться.
 */

const SOLAR_SYSTEM = Scenarios.find((s) => s.rootId === 1)!
const SIZE_8K: number = textureBytes(8192, 4096)

function record(name: string, distance: number): ObservableRecord {
  return { name, distance, position: new Vector3() }
}

function makeObserver(
  budgetBytes: number,
  load: TextureProvider['load']
): {
  observer: ResourceObserver
  handlers: Record<string, (event: ObservableRecord) => Promise<void>>
  data: Map<string, ObservableRecord>
} {
  const handlers: Record<string, (event: ObservableRecord) => Promise<void>> = {}
  const data: Map<string, ObservableRecord> = new Map()

  const sceneObserver = {
    subscribe: vi.fn((event: string, handler: (e: ObservableRecord) => Promise<void>): void => {
      handlers[event] = handler
    }),
    data
  } as unknown as SceneObserver

  const textures = { load } as unknown as TextureProvider

  const observer = new ResourceObserver(
    sceneObserver,
    textures,
    { setAsset: vi.fn(), setProgress: vi.fn(), setTotal: vi.fn() } as unknown as LoadingProgressReporter,
    { dispatch: vi.fn() } as unknown as NotificationSink,
    new Scene(),
    new TextureBudget(budgetBytes)
  )

  return { observer, handlers, data }
}

describe('ResourceObserver: steep-набор зон материала в кандидатах', () => {
  afterEach(() => {
    resourceStorage.deleteAllTextures()
  })

  it('Энцелад (ice-архетип, честный height) — получает все три steep-пути с рангами 2.31/2.32/2.33 ПОСЛЕ родного detail-набора', async () => {
    const order: string[] = []
    const load = vi.fn((request: TextureRequest): Promise<LoadResult> => {
      order.push(request.name)
      const texture = new Texture()
      texture.image = { width: 2048, height: 1024 }
      texture.name = request.name
      return Promise.resolve({ ok: true as const, texture })
    })

    const { observer, handlers, data } = makeObserver(SIZE_8K * 16, load)
    observer.scenario = SOLAR_SYSTEM

    data.set('Enceladus', record('Enceladus', 10))
    await handlers['ClosestChange'](record('Enceladus', 10))

    // Родной ice-набор Энцелада запрошен как обычно.
    expect(order).toContain('planets/enceladus/enceladus_slope.webp')
    expect(order).toContain('terrain/ice_diff.webp')
    expect(order).toContain('terrain/ice_nor.webp')
    expect(order).toContain('terrain/ice_arm.webp')
    expect(order).toContain('terrain/moon_01_nor.webp')

    // Три steep-пути запрошены тоже — дискриминация путей.
    expect(order).toContain(STEEP_DETAIL_PATHS.diffuse)
    expect(order).toContain(STEEP_DETAIL_PATHS.normal)
    expect(order).toContain(STEEP_DETAIL_PATHS.arm)

    // Дискриминация рангов: typeRank — единственное, что определяет порядок в
    // `decideStreaming.load` (ranked по typeRank asc). detailNormal2 (2.3) —
    // последний родной ранг Энцелада, steep-ранги (2.31/2.32/2.33) идут
    // строго ПОСЛЕ него, в порядке normal → arm → diffuse.
    const idxDetailNormal2 = order.indexOf('terrain/moon_01_nor.webp')
    const idxSteepNormal = order.indexOf(STEEP_DETAIL_PATHS.normal)
    const idxSteepArm = order.indexOf(STEEP_DETAIL_PATHS.arm)
    const idxSteepDiffuse = order.indexOf(STEEP_DETAIL_PATHS.diffuse)

    expect(idxDetailNormal2).toBeGreaterThanOrEqual(0)
    expect(idxSteepNormal).toBeGreaterThan(idxDetailNormal2)
    expect(idxSteepArm).toBeGreaterThan(idxSteepNormal)
    expect(idxSteepDiffuse).toBeGreaterThan(idxSteepArm)
  })

  it('Луна (rocky-архетип) — родной detail уже совпадает со steep-набором, дублей нет', async () => {
    const load = vi.fn((request: TextureRequest): Promise<LoadResult> => {
      const texture = new Texture()
      texture.image = { width: 2048, height: 1024 }
      texture.name = request.name
      return Promise.resolve({ ok: true as const, texture })
    })

    const { observer, handlers, data } = makeObserver(SIZE_8K * 16, load)
    observer.scenario = SOLAR_SYSTEM

    data.set('Moon', record('Moon', 10))
    await handlers['ClosestChange'](record('Moon', 10))

    // Родной набор Луны: диффуз+slope+4 detail (уже rocky_trail-семейство) — 6 путей.
    expect(load).toHaveBeenCalledTimes(6)
    expect(load).toHaveBeenCalledWith(expect.objectContaining({ name: 'planets/moon/moon.jpg' }))
    expect(load).toHaveBeenCalledWith(expect.objectContaining({ name: 'planets/moon/moon_slope.webp' }))
    expect(load).toHaveBeenCalledWith(expect.objectContaining({ name: STEEP_DETAIL_PATHS.diffuse }))
    expect(load).toHaveBeenCalledWith(expect.objectContaining({ name: STEEP_DETAIL_PATHS.normal }))
    expect(load).toHaveBeenCalledWith(expect.objectContaining({ name: STEEP_DETAIL_PATHS.arm }))

    // Каждый путь запрошен ровно один раз — гейт не задвоил родной steep-набор.
    expect(resourceStorage.textures.where('name', STEEP_DETAIL_PATHS.diffuse).count()).toBe(1)
    expect(resourceStorage.textures.where('name', STEEP_DETAIL_PATHS.normal).count()).toBe(1)
    expect(resourceStorage.textures.where('name', STEEP_DETAIL_PATHS.arm).count()).toBe(1)
  })

  it('Сатурн (легаси-гигант, без height-ресурса) — steep-путей нет вовсе', async () => {
    const load = vi.fn((request: TextureRequest): Promise<LoadResult> => {
      const texture = new Texture()
      texture.image = { width: 2048, height: 1024 }
      texture.name = request.name
      return Promise.resolve({ ok: true as const, texture })
    })

    const { observer, handlers, data } = makeObserver(SIZE_8K * 16, load)
    observer.scenario = SOLAR_SYSTEM

    data.set('Saturn', record('Saturn', 300))
    await handlers['ClosestChange'](record('Saturn', 300))

    // Только диффуз планеты — легаси-тело, ни height, ни steep-набора.
    expect(load).toHaveBeenCalledTimes(1)
    expect(load).toHaveBeenCalledWith(expect.objectContaining({ name: 'planets/saturn/saturn.jpg' }))
    expect(load).not.toHaveBeenCalledWith(expect.objectContaining({ name: STEEP_DETAIL_PATHS.diffuse }))
    expect(load).not.toHaveBeenCalledWith(expect.objectContaining({ name: STEEP_DETAIL_PATHS.normal }))
    expect(load).not.toHaveBeenCalledWith(expect.objectContaining({ name: STEEP_DETAIL_PATHS.arm }))
  })
})
