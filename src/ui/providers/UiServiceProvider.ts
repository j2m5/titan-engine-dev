import { ServiceProvider } from '@/core/framework/container/ServiceProvider'
import { Tokens } from '@/core/providers/tokens'
import { settingsStore } from '@/ui/mobx/SettingsStore'
import { notificationStore } from '@/ui/mobx/NotificationStore'
import { engineStore } from '@/ui/mobx/EngineStore'
import { menuStore } from '@/ui/mobx/MenuStore'
import { timeStore } from '@/ui/mobx/TimeStore'
import { cameraStore } from '@/ui/mobx/CameraStore'

/**
 * Регистрирует UI-стороны портов и подключает observable-зеркала к
 * сервисам-владельцам состояния. Живёт в ui/ — единственное место, где
 * UI «встречается» с контейнером; ядро про этот провайдер не знает.
 */
class UiServiceProvider extends ServiceProvider {
  public register(): void {
    this.app.instance(Tokens.Settings, settingsStore)
    this.app.instance(Tokens.NotificationSink, notificationStore)
    this.app.instance(Tokens.LoadingProgressReporter, engineStore)
    this.app.instance(Tokens.MenuController, menuStore)
  }

  public boot(): void {
    timeStore.connect(this.app.get(Tokens.SimulationClock))
    cameraStore.connect(this.app.get(Tokens.CameraController))
  }
}

export { UiServiceProvider }
