import { afterEach, describe, expect, it, vi } from 'vitest'
import { Tokens } from '@/core/providers/tokens'
import { SyncTerrainPatchBuilder } from '@/core/terrain/terrainPatchBuilder'
import { WorkerTerrainPatchBuilder } from '@/core/terrain/worker/WorkerTerrainPatchBuilder'
import { createTestContainer } from '../helpers/createTestContainer'

/** Приватные поля потребителей: проводка проверяется идентичностью с синглтоном контейнера. */
type Wired = { terrainPatchBuilder: unknown; renderableFactory?: unknown }

describe('AppServiceProvider: строитель патчей рельефа', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('без Worker (jsdom) — синхронный строитель; фабрика и приложение получают его из контейнера', () => {
    expect(typeof Worker).toBe('undefined')

    const container = createTestContainer()
    const builder = container.get(Tokens.TerrainPatchBuilder)
    const factory = container.get(Tokens.RenderableFactory)
    const app = container.get(Tokens.Application) as unknown as Wired

    expect(builder).toBeInstanceOf(SyncTerrainPatchBuilder)
    expect((factory as unknown as Wired).terrainPatchBuilder).toBe(builder)
    expect(app.terrainPatchBuilder).toBe(builder)
    expect(app.renderableFactory).toBe(factory)
  })

  it('при наличии Worker — воркерный строитель, один воркер на контейнер', () => {
    const constructed: unknown[] = []

    vi.stubGlobal(
      'Worker',
      class {
        public constructor(...args: unknown[]) {
          constructed.push(args)
        }

        public postMessage(): void {}

        public terminate(): void {}
      }
    )

    const container = createTestContainer()
    const builder = container.get(Tokens.TerrainPatchBuilder)

    expect(builder).toBeInstanceOf(WorkerTerrainPatchBuilder)
    expect(container.get(Tokens.TerrainPatchBuilder)).toBe(builder)
    expect(constructed).toHaveLength(1)
  })
})
