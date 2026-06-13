import { EventEmitter } from '@/core/framework/EventEmitter'
import { ScenarioConfig } from '@/config/scenarios'

class ScenarioContext extends EventEmitter {
  private _current: ScenarioConfig | null = null

  /** Текущий сценарий (null — ни один не выбран) */
  public get current(): ScenarioConfig | null {
    return this._current
  }

  /** Корневой actor текущего сценария — самое частое обращение из core */
  public get rootId(): number | undefined {
    return this._current?.rootId
  }

  /**
   * Сменить активный сценарий. Оповещает подписчиков (в т.ч. UI-стор).
   * Вызывается из доменного кода смены сценария; UI инициирует смену
   * через этот метод, а не через прямую запись в стор.
   */
  public set(scenario: ScenarioConfig | null): void {
    if (this._current === scenario) return

    this._current = scenario
    this.emit('change', scenario)
  }
}

export const scenarioContext: ScenarioContext = new ScenarioContext()
export { ScenarioContext }
