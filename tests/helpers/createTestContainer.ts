import { Container } from '@/core/framework/container/Container'
import { Kernel } from '@/core/framework/container/Kernel'
import { RenderingServiceProvider } from '@/core/providers/RenderingServiceProvider'
import { AppServiceProvider } from '@/core/providers/AppServiceProvider'
import { Tokens } from '@/core/providers/tokens'
import { Scene, Vector2 } from 'three'
import type { Clock, PerspectiveCamera, WebGLRenderer } from 'three'
import type { CSS2DRenderer } from 'three/examples/jsm/renderers/CSS2DRenderer'
import type { AstroControls } from '@/core/libs/AstroControls'
import type { Settings } from '@/core/ports/Settings'
import type { NotificationSink } from '@/core/ports/NotificationSink'
import type { LoadingProgressReporter } from '@/core/ports/LoadingProgressReporter'
import type { MenuController } from '@/core/ports/MenuController'

/**
 * Контейнер для тестов: поднимает настоящие провайдеры ядра, но перекрывает
 * рендер-токены заглушками, поэтому WebGL не создаётся. AstroControls
 * тоже обязателен к перекрытию — его фабрика тянет Renderer ради domElement.
 *
 * Перекрываются все шесть рендер-токенов, включая LabelRenderer: тогда ни один
 * настоящий объект Three в тестах не конструируется, и контейнер не зависит от
 * того, подменён ли модуль фабрик в вызывающем файле.
 *
 * Четыре порта (`Settings`, `NotificationSink`, `LoadingProgressReporter`,
 * `MenuController`) в проде регистрирует `UiServiceProvider` MobX-сторами.
 * Здесь они закрыты плоскими объектами: `AppServiceProvider` без них не
 * резолвится, а тащить UI-слой в контейнер ядра означало бы вернуть ту самую
 * зависимость, ради устранения которой порты и появились.
 *
 * Заглушки минимальны намеренно: если тест дёрнет неописанный метод, он упадёт
 * с внятным `is not a function`, и заглушка дополнится по факту.
 */
export function createTestContainer(): Container {
  const container: Container = new Kernel([RenderingServiceProvider, AppServiceProvider]).bootstrap()

  /**
   * У каждого рендерера свой литерал: `Engine` берёт `renderer.domElement` как
   * canvas, а `labelRenderer.domElement` как overlay, и на общем объекте эти два
   * поля оказались бы одним и тем же — тест `initialize()` или `onResize()`
   * молча принимал бы один элемент за два.
   */
  const createDomElement = () => ({
    height: 1080,
    width: 1920,
    style: {},
    addEventListener: () => {},
    removeEventListener: () => {}
  })

  container.instance(Tokens.Renderer, {
    domElement: createDomElement(),
    setSize: () => {},
    setPixelRatio: () => {},
    setAnimationLoop: () => {},
    render: () => {},
    initTexture: () => {},
    getSize: (v: Vector2) => {
      v.set(1920, 1080)
      return v
    },
    getRenderTarget: () => null,
    setRenderTarget: () => {},
    clear: () => {},
    capabilities: { getMaxAnisotropy: () => 8 }
  } as unknown as WebGLRenderer)

  container.instance(Tokens.LabelRenderer, {
    domElement: createDomElement(),
    setSize: () => {},
    render: () => {}
  } as unknown as CSS2DRenderer)

  container.instance(Tokens.Scene, new Scene())
  container.instance(Tokens.Camera, {
    position: { set: () => {}, clone: () => ({}) },
    lookAt: () => {}
  } as unknown as PerspectiveCamera)
  container.instance(Tokens.Clock, { getDelta: () => 0, getElapsedTime: () => 0 } as unknown as Clock)
  container.instance(Tokens.AstroControls, {
    update: () => {},
    enabled: true,
    movementSpeed: 0
  } as unknown as AstroControls)

  const settings: Settings = { showMarkers: false, showOrbitLines: false }
  const notificationSink: NotificationSink = { dispatch: () => {} }
  const loadingProgressReporter: LoadingProgressReporter = {
    setAsset: () => {},
    setProgress: () => {},
    setTotal: () => {}
  }
  const menuController: MenuController = { close: () => {} }

  container.instance(Tokens.Settings, settings)
  container.instance(Tokens.NotificationSink, notificationSink)
  container.instance(Tokens.LoadingProgressReporter, loadingProgressReporter)
  container.instance(Tokens.MenuController, menuController)

  return container
}
