import { makeAutoObservable } from 'mobx'
import { getDateFromJD, getJD } from '@/core/helpers/jd'
import dayjs from 'dayjs'

class TimeStore {
  public epoch: number = getJD(new Date())
  public timeSteps: number[] = [0, 1, 10, 25, 50, 100, 200, 500, 1000, 10000, 100000, 1000000, 10000000]
  public speedOfTime: number = 1

  public constructor() {
    makeAutoObservable(this)
  }

  public setToDefaults(): void {
    this.epoch = getJD(new Date())
  }

  public get currentDate(): string {
    return dayjs(getDateFromJD(this.epoch)).format('D MMM, YYYY')
  }

  public get currentTime(): string {
    return dayjs(getDateFromJD(this.epoch)).format('HH:mm:ss')
  }

  public setEpoch(payload: number): void {
    this.epoch = payload
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
    this.speedOfTime = payload
  }
}

export const timeStore: TimeStore = new TimeStore()
