import { ServiceProvider } from '@/core/framework/container/ServiceProvider'
import { Tokens } from '@/core/providers/tokens'
import { settingsStore } from '@/ui/mobx/SettingsStore'
import { notificationStore } from '@/ui/mobx/NotificationStore'
import { engineStore } from '@/ui/mobx/EngineStore'
import { menuStore } from '@/ui/mobx/MenuStore'
import { timeStore } from '@/ui/mobx/TimeStore'
import { cameraStore } from '@/ui/mobx/CameraStore'
import { bodyInfoStore } from '@/ui/mobx/BodyInfoStore'

/**
 * Регистрирует UI-стороны портов и подключает observable-зеркала к
 * сервисам-владельцам состояния. Живёт в ui/ — единственное место, где
 * UI «встречается» с контейнером; ядро про этот провайдер не знает.
 */
class UiServiceProvider extends ServiceProvider {
  private connectedCount: number = 0
  public register(): void {
    this.app.instance(Tokens.Settings, settingsStore)
    this.app.instance(Tokens.NotificationSink, notificationStore)
    this.app.instance(Tokens.LoadingProgressReporter, engineStore)
    this.app.instance(Tokens.MenuController, menuStore)
  }

  public boot(): void {
    // Resolve everything before subscribing stores. A failed resolution can
    // retry against the existing container without duplicating subscriptions.
    const clock = this.app.get(Tokens.SimulationClock)
    const controller = this.app.get(Tokens.CameraController)
    const camera = this.app.get(Tokens.Camera)
    const collision = this.app.get(Tokens.CameraCollision)
    const bodyInfo = this.app.get(Tokens.BodyInfoService)
    const connections = [
      () => timeStore.connect(clock),
      () => cameraStore.connect(controller),
      () => engineStore.connect(camera, collision),
      () => bodyInfoStore.connect(bodyInfo)
    ]
    while (this.connectedCount < connections.length) {
      connections[this.connectedCount]()
      this.connectedCount++
    }
  }
}

export { UiServiceProvider }
