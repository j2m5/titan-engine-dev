import { makeAutoObservable, runInAction } from 'mobx'
import { getDateFromJD, getJD } from '@/core/helpers/jd'
import { SimulationClock } from '@/core/time/SimulationClock'
import dayjs from 'dayjs'

class TimeStore {
  public epoch: number = getJD(new Date())
  public speedOfTime: number = 1
  public timeSteps: number[] = [0, 1, 10, 25, 50, 100, 200, 500, 1000, 10000, 100000, 1000000, 10000000]

  private _clock: SimulationClock | null = null

  public constructor() {
    makeAutoObservable<TimeStore, '_clock'>(this, { _clock: false })
  }

  /** Подключение к сервису-владельцу времени: стор становится его зеркалом. */
  public connect(clock: SimulationClock): void {
    this._clock = clock
    this.mirror()
    clock.subscribe('change', this.mirror)
  }

  private mirror = (): void => {
    runInAction((): void => {
      this.epoch = this._clock!.epoch
      this.speedOfTime = this._clock!.speedOfTime
    })
  }

  public setToDefaults(): void {
    this._clock?.setEpoch(getJD(new Date()))
  }

  public get currentDate(): string {
    return dayjs(getDateFromJD(this.epoch)).format('D MMM, YYYY')
  }

  public get currentTime(): string {
    return dayjs(getDateFromJD(this.epoch)).format('HH:mm:ss')
  }

  public setSpeedForward(): void {
    const index = this.timeSteps.indexOf(this.speedOfTime)
    if (index <= 0 || index + 1 >= this.timeSteps.length) return
    this.setSpeedOfTime(this.timeSteps[index + 1])
  }

  public setSpeedBackward(): void {
    const index = this.timeSteps.indexOf(this.speedOfTime)
    if (index <= 0) return
    this.setSpeedOfTime(this.timeSteps[index - 1])
  }

  public setSpeedOfTime(payload: number): void {
    this._clock?.setSpeedOfTime(payload)
  }
}

export const timeStore: TimeStore = new TimeStore()
