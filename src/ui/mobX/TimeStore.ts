import { makeAutoObservable } from 'mobx'
import { getDateFromJD, getJD } from '@/core/helpers/jd'
import dayjs from 'dayjs'

class TimeStore {
  public epoch: number = getJD(new Date())
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

  public setSpeedOfTime(payload: number | number[]): void {
    if (typeof payload === 'number') {
      this.speedOfTime = payload
    }
  }

  public setTimer(): void {
    if (this.speedOfTime > 0) {
      this.epoch += 1000
    }
  }
}

export const timeStore: TimeStore = new TimeStore()
