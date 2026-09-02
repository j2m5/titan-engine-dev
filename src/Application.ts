import { Engine } from '@/core/Engine'
import { ResourceObserver } from '@/core/services/ResourceObserver'
import { ScenarioConfig } from '@/config/scenarios'
import { resourceStorage } from '@/core/services/ResourceStorage'
import { heightFieldStorage } from '@/core/services/HeightFieldStorage'
import { Scene } from 'three'
import type { LeakDetector } from '@/core/lifecycle/LeakDetector'
import type { HeightFieldGate } from '@/core/services/HeightFieldGate'
import type { ProceduralSurfaceGenerator } from '@/core/services/ProceduralSurfaceGenerator'
import { SkyboxBackground } from '@/core/renderables/SkyboxBackground'

class Application {
  private everLoaded: boolean = false

  public constructor(
    private engine: Engine,
    private resourceObserver: ResourceObserver,
    private scene: Scene,
    private leakDetector: LeakDetector,
    private heightFieldGate: HeightFieldGate,
    // Опционален: существующие тесты Application строят его без генератора —
    // тот же приём, что у остальных сценарных сервисов (AtmosphereRegistry
    // и т.п. приходят опциональными параметром там, где нет DI-контейнера).
    private proceduralSurfaceGenerator?: ProceduralSurfaceGenerator
  ) {}

  /**
   * Разборка сценария. Граф разбирается до текстур: обратный порядок оставляет
   * окно, в котором материал ссылается на освобождённую текстуру, и отрисовка
   * в этом окне даёт предупреждения WebGL.
   *
   * Фон снимать отдельно не нужно: его рисует `SkyboxBackground`, обычный
   * потомок сцены, и ссылку на кубмапу освобождает обход графа в
   * `engine.dispose()`.
   *
   * Проверка утечек пропускается, пока в сессии ничего не построено: первая
   * разборка происходит в начале `run()`, и её снимок не содержит законных
   * долгоживущих ресурсов — как эталон он объявил бы утечкой всё подряд.
   */
  public teardown(): void {
    this.engine.dispose()
    resourceStorage.deleteAllTextures()
    heightFieldStorage.clear()
    // Инвариант владения: генератор рантайм-диффуза процедурных тел — общий
    // синглтон сцены (см. AppServiceProvider), а не собственность акторов —
    // его render target'ы разбирает владелец, здесь же, а не сами тела.
    this.proceduralSurfaceGenerator?.dispose()

    if (import.meta.env.DEV && this.everLoaded) {
      const leak = this.leakDetector.record()

      if (leak) {
        console.warn(
          `[LeakDetector] прирост с прошлой разборки: геометрий +${leak.geometries}, текстур +${leak.textures}`
        )
      }
    }
  }

  public async run(scenario: ScenarioConfig): Promise<void> {
    this.teardown()

    this.resourceObserver.scenario = scenario
    await this.resourceObserver.loadPrimaryTextures()

    if (!this.resourceObserver.sceneBackground) {
      console.warn('[Application] Кубическая карта фона сценария не загружена, сцена останется без фона')
    } else {
      // Собственный проход вместо scene.background: только так расширение
      // хайлайтов применяется и к прямому фону (см. SkyboxBackground)
      this.scene.add(new SkyboxBackground(this.resourceObserver.sceneBackground))
    }

    this.everLoaded = true
    this.engine.start()

    // Подписка HeightFieldGate на ClosestChange уже стоит — она встаёт в его
    // конструкторе, а гейт строится контейнером ДО Application (он его
    // ctor-аргумент), не здесь. Этот вызов НИЧЕГО не грузит на первом кадре:
    // recompute() читает sceneObserver.data, а тот наполняется только по
    // событию change контролов или по периодическому тику — ни то, ни другое
    // не успевает сработать до этой строки. Вызов оставлен дешёвым и
    // безвредным холостым проходом; реальный первый запрос карты приходит с
    // первым ClosestChange (в пределах streaming.recomputeIntervalMs = 500 мс
    // даже при неподвижной камере).
    this.heightFieldGate.recompute()
  }

  public dispose(): void {
    this.teardown()
    this.resourceObserver.scenario = null
  }
}

export { Application }
