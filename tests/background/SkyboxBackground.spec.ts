import { SkyboxBackground } from '@/core/renderables/SkyboxBackground'
import { CubeTexture, RawShaderMaterial, Scene } from 'three'
import { gaiaSkyUniforms } from '@/core/sky/gaiaSkyUniforms'
import { SKY_VERTEX_SHADER, buildSkyFragmentShader } from '@/core/renderables/skyShader'
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

  it('шейдер фона — общий модуль неба: чанк, производные луча, своей копии нет', () => {
    const source = readFileSync('src/core/renderables/skyShader.ts', 'utf8')
    const material = new SkyboxBackground(null).material as RawShaderMaterial

    expect(source).toContain('#include <skySampleFunctions>')
    expect(source).toContain('vec3 sky = sampleSky(dir, dFdx(dir), dFdy(dir));')
    expect(material.fragmentShader).toBe(buildSkyFragmentShader(false))
    expect(material.vertexShader).toBe(SKY_VERTEX_SHADER)
    expect(material.fragmentShader).not.toContain('texture(skybox,')
  })

  it('юниформы неба — общие экземпляры GaiaSky (режим gaia)', () => {
    const material = new SkyboxBackground(null).material as RawShaderMaterial

    expect(material.uniforms.uGaiaGalaxy).toBe(gaiaSkyUniforms.uGaiaGalaxy)
    expect(material.uniforms.uGaiaMinLod).toBe(gaiaSkyUniforms.uGaiaMinLod)
  })

  it('режим gaia: фон без кубмапы сценария, небо запускается; возврат в меню его не гасит', async () => {
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
      sceneBackground: null,
      map: new Map()
    } as unknown as ResourceObserver
    const leakDetector = { record: () => null } as unknown as LeakDetector
    const heightFieldGate = { recompute: vi.fn(), dispose: vi.fn(), clearNodeCache: vi.fn() } as never
    const gaiaSky = { start: vi.fn(() => null), dispose: vi.fn() }
    vi.spyOn(resourceStorage, 'deleteAllTextures').mockImplementation(() => {})

    const application = new Application(
      engine,
      observer,
      scene,
      leakDetector,
      heightFieldGate,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      gaiaSky
    )

    await application.run(Scenarios[0])
    await application.run(Scenarios[0])

    expect(gaiaSky.start).toHaveBeenCalledTimes(2)
    expect(scene.children.filter((child) => child instanceof SkyboxBackground)).toHaveLength(1)

    // Application.dispose — это «назад к сценариям»: небо общее для сессии и
    // не должно качаться заново при каждой смене сценария
    application.dispose()
    expect(gaiaSky.dispose).not.toHaveBeenCalled()
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
    const heightFieldGate = { recompute: vi.fn(), dispose: vi.fn(), clearNodeCache: vi.fn() } as never
    vi.spyOn(resourceStorage, 'deleteAllTextures').mockImplementation(() => {})

    const application = new Application(engine, observer, scene, leakDetector, heightFieldGate)

    await application.run(Scenarios[0])
    await application.run(Scenarios[0])

    expect(scene.background).toBeNull()
    expect(scene.children.filter((child) => child instanceof SkyboxBackground)).toHaveLength(1)
  })
})
