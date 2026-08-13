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
})
