import { describe, it, expect, vi } from 'vitest'
import { Scene, Texture } from 'three'
import { ResourceObserver } from '@/core/services/ResourceObserver'
import { TextureBudget } from '@/core/streaming/TextureBudget'
import { Scenarios } from '@/config/scenarios'
import type { SceneObserver } from '@/core/services/SceneObserver'
import type { TextureProvider } from '@/core/textures/TextureProvider'
import type { LoadingProgressReporter } from '@/core/ports/LoadingProgressReporter'
import type { NotificationSink } from '@/core/ports/NotificationSink'
import type { TextureRequest } from '@/core/textures/types'

/**
 * Прогресс экрана загрузки считает сам наблюдатель, а не DefaultLoadingManager:
 * счётчик three копит файлы за всю сессию, и полоса шла назад (6/6 → 6/7 → 7/23),
 * а при повторной загрузке весь путь держалась у 100%.
 */

interface Recorder extends LoadingProgressReporter {
  totals: number[]
  progress: number[]
  assets: string[]
}

function recorder(): Recorder {
  const totals: number[] = []
  const progress: number[] = []
  const assets: string[] = []

  return {
    totals,
    progress,
    assets,
    setTotal: (total: number): void => void totals.push(total),
    setProgress: (loaded: number): void => void progress.push(loaded),
    setAsset: (url: string): void => void assets.push(url)
  }
}

/** Провайдер, отвечающий асинхронно: порядок завершения не совпадает с порядком запросов */
function provider(
  requests: TextureRequest[],
  fail: (request: TextureRequest) => boolean = () => false
): TextureProvider {
  return {
    load: vi.fn(async (request: TextureRequest) => {
      requests.push(request)
      await new Promise((resolve) => setTimeout(resolve, requests.length % 3))

      if (fail(request)) throw new Error('404')

      return { ok: true as const, texture: new Texture() }
    })
  } as unknown as TextureProvider
}

function observerWith(textures: TextureProvider, progress: Recorder): ResourceObserver {
  const observer = new ResourceObserver(
    { subscribe: vi.fn() } as unknown as SceneObserver,
    textures,
    progress,
    { dispatch: vi.fn() } as unknown as NotificationSink,
    new Scene(),
    new TextureBudget(1024 ** 3)
  )

  observer.scenario = Scenarios[0]

  return observer
}

/** Число файлов, которые загрузка обязана отсчитать: кубмапа весит числом граней */
function filesOf(requests: TextureRequest[]): number {
  return requests.reduce((sum: number, request: TextureRequest): number => sum + request.paths.length, 0)
}

describe('ResourceObserver.loadPrimaryTextures — прогресс сценария', () => {
  it('всего — грани кубмапы плюс резидентные, один раз и до первой загрузки; доходит ровно до всего', async () => {
    const requests: TextureRequest[] = []
    const progress = recorder()

    await observerWith(provider(requests), progress).loadPrimaryTextures()

    expect(progress.totals).toEqual([filesOf(requests)])
    expect(progress.progress[0]).toBe(0)
    expect(progress.progress.at(-1)).toBe(filesOf(requests))
  })

  it('полоса идёт только вперёд', async () => {
    const progress = recorder()

    await observerWith(provider([]), progress).loadPrimaryTextures()

    for (let i = 1; i < progress.progress.length; i++) {
      expect(progress.progress[i]).toBeGreaterThanOrEqual(progress.progress[i - 1])
    }
  })

  it('повторная загрузка (смена сценария) начинает с нуля, а не с прошлых 100%', async () => {
    const progress = recorder()
    const observer = observerWith(provider([]), progress)

    await observer.loadPrimaryTextures()
    const firstRunCalls: number = progress.progress.length

    await observer.loadPrimaryTextures()

    expect(progress.progress[firstRunCalls]).toBe(0)
    expect(progress.totals).toHaveLength(2)
    expect(progress.totals[1]).toBe(progress.totals[0])
  })

  it('провалившаяся текстура тоже шаг: полоса доходит до 100%, а не застревает', async () => {
    const requests: TextureRequest[] = []
    const progress = recorder()
    let failed = false
    const failOnce = (request: TextureRequest): boolean => {
      if (failed || request.paths.length !== 1) return false
      failed = true

      return true
    }

    await observerWith(provider(requests, failOnce), progress).loadPrimaryTextures()

    expect(failed).toBe(true)
    expect(progress.progress.at(-1)).toBe(filesOf(requests))
  })

  it('по окончании строка файла пустая', async () => {
    const progress = recorder()

    await observerWith(provider([]), progress).loadPrimaryTextures()

    expect(progress.assets.at(-1)).toBe('')
  })
})
