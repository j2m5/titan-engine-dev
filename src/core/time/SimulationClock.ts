import { EventEmitter } from '@/core/framework/EventEmitter'
import { DAY } from '@/core/constants'
import { getJD } from '@/core/helpers/jd'

/**
 * Владелец времени симуляции. Раньше epoch жил в timeStore (UI),
 * а Engine мутировал его каждый кадр — теперь тактом владеет ядро,
 * а стор лишь зеркалит значение для отображения.
 */
class SimulationClock extends EventEmitter {
  private _epoch: number
  private _speedOfTime: number = 1

  public constructor(initialEpoch: number = getJD(new Date())) {
    super()
    this._epoch = initialEpoch
  }

  public get epoch(): number {
    return this._epoch
  }

  public get speedOfTime(): number {
    return this._speedOfTime
  }

  /** Продвигает эпоху на прошедшие секунды кадра (формула перенесена из Engine 1:1) */
  public advance(delta: number): void {
    this._epoch += (delta * this._speedOfTime) / DAY
    this.emit('change')
  }

  public setEpoch(value: number): void {
    this._epoch = value
    this.emit('change')
  }

  public setSpeedOfTime(value: number): void {
    this._speedOfTime = value
    this.emit('change')
  }
}

export { SimulationClock }
