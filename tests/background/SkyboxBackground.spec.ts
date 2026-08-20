import { SkyboxBackground } from '@/core/renderables/SkyboxBackground'
import { CubeTexture, Scene } from 'three'
import { readFileSync } from 'fs'
import { Application } from '@/Application'
import { disposeSceneTree } from '@/core/lifecycle/disposeSceneTree'
import { resourceStorage } from '@/core/services/ResourceStorage'
import { Scenarios } from '@/config/scenarios'
import { vi } from 'vitest'
import type { Engine } from '@/core/Engine'
import type { ResourceObserver } from '@/core/services/ResourceObserver'
import type { LeakDetector } from '@/core/lifecycle/LeakDetector'

describe('SkyboxBackground: собственный фоновый проход', () => {
  it('не отсекается фрустумом и рисуется раньше любой геометрии', () => {
    const background = new SkyboxBackground(new CubeTexture())

    expect(background.frustumCulled).toBe(false)
    expect(background.renderOrder).toBeLessThan(0)
  })

  it('не участвует в тесте глубины и не пишет её', () => {
    const background = new SkyboxBackground(new CubeTexture())
    const material = background.material as { depthTest: boolean; depthWrite: boolean }

    expect(material.depthTest).toBe(false)
    expect(material.depthWrite).toBe(false)
  })

  it('выборка идёт через общий чанк, своей копии нет', () => {
    const source = readFileSync('src/core/renderables/SkyboxBackground.ts', 'utf8')

    expect(source).toContain('#include <skyboxSampleFunctions>')
    expect(source).toContain('sampleSkyboxHdr(')
    expect(source).not.toContain('texture(skybox,')
  })

  it('два run() подряд не копят лишние проходы фона', async () => {
    // Поведенческая замена поиска подстроки в исходнике Application.ts:
    // тот тест обходило переименование переменной. Здесь вместо этого
    // разыгрывается реальный жизненный цикл — engine.dispose() прогоняет
    // настоящий disposeSceneTree по scene.children, как это делает
    // SceneManager.dispose() в продакшене, — и проверяется РОВНО один
    // потомок SkyboxBackground после второго run(): объект создаёт
    // Application.run, а разбирает обход дерева сцены при teardown, и если
    // разборку когда-нибудь сузят, каждое переключение сценария будет
    // оставлять лишний полноэкранный проход
    const scene = new Scene()
    const engine = {
      dispose: vi.fn(() => {
        for (const child of [...scene.children]) disposeSceneTree(child)
      }),
      start: vi.fn()
    } as unknown as Engine
    const observer = {
      scenario: null,
      loadPrimaryTextures: vi.fn(() => Promise.resolve()),
      sceneBackground: new CubeTexture(),
      map: new Map()
    } as unknown as ResourceObserver
    const leakDetector = { record: () => null } as unknown as LeakDetector
    const heightFieldGate = { recompute: vi.fn(), dispose: vi.fn() } as never
    vi.spyOn(resourceStorage, 'deleteAllTextures').mockImplementation(() => {})

    const application = new Application(engine, observer, scene, leakDetector, heightFieldGate)

    await application.run(Scenarios[0])
    await application.run(Scenarios[0])

    expect(scene.background).toBeNull()
    expect(scene.children.filter((child) => child instanceof SkyboxBackground)).toHaveLength(1)
  })
})
