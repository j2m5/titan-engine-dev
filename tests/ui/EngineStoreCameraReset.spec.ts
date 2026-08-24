import { describe, expect, it, vi } from 'vitest'
import { PerspectiveCamera } from 'three'
import { engineStore } from '@/ui/mobx/EngineStore'
import type { Application } from '@/Application'
import type { CameraCollision } from '@/core/services/CameraCollision'
import type { ScenarioConfig } from '@/config/scenarios'

describe('EngineStore: телепорт на дефолтную позицию сценария', () => {
  it('после установки позиции зовёт reset у коллизий', async () => {
    // Без сброса свип протянет отрезок от старой позиции камеры через
    // полсистемы и ложно поймает тело по пути
    const camera = new PerspectiveCamera()
    const collision = { reset: vi.fn() } as unknown as CameraCollision
    const app = { run: vi.fn(async (): Promise<void> => {}), dispose: vi.fn() } as unknown as Application

    await engineStore.initialize(app)
    engineStore.connect(camera, collision)

    const scenario = { defaultCameraPosition: [1, 2, 3] } as unknown as ScenarioConfig
    await engineStore.setScenario(scenario)

    expect(camera.position.toArray()).toEqual([1, 2, 3])
    expect(collision.reset).toHaveBeenCalledTimes(1)
  })

  it('камера стоит на дефолтной позиции УЖЕ к моменту запуска app.run — первый кадр не стреляет по устаревшей', async () => {
    // Первый кадр бежит синхронно внутри engine.start() (Engine.start →
    // update → тик стримера/коллизий) — телепорт после await app.run()
    // опаздывает на целый кадр: SceneObserver успевает пересчитать состав
    // видеопамяти по старой позиции и через предоплату закрепить неверный
    // набор (см. хендофф, находка первого кадра).
    const camera = new PerspectiveCamera()
    camera.position.set(500, 500, 500)
    const collision = { reset: vi.fn() } as unknown as CameraCollision

    const positionsAtRun: number[][] = []
    const app = {
      run: vi.fn(async (): Promise<void> => {
        positionsAtRun.push(camera.position.toArray())
      }),
      dispose: vi.fn()
    } as unknown as Application

    await engineStore.initialize(app)
    engineStore.connect(camera, collision)

    await engineStore.setScenario({ defaultCameraPosition: [1, 2, 3] } as unknown as ScenarioConfig)

    expect(positionsAtRun).toEqual([[1, 2, 3]])
  })
})
