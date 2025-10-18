import { makeAutoObservable } from 'mobx'

class ModalWindowStore {
  public developmentDataWindowState: boolean = false
  public settingsWindowState: boolean = false
  public tutorialWindowState: boolean = false
  public audioPlayerWindowState: boolean = false
  public flightAnimationTime: number = 5

  public constructor() {
    makeAutoObservable(this)
  }

  public setDevelopmentDataWindowState(payload: boolean): void {
    this.developmentDataWindowState = payload
  }

  public setSettingsWindowState(payload: boolean): void {
    this.settingsWindowState = payload
  }

  public setTutorialWindowState(payload: boolean): void {
    this.tutorialWindowState = payload
  }

  public setAudioPlayerWindowState(payload: boolean): void {
    this.audioPlayerWindowState = payload
  }

  public setFlightAnimationTime(payload: string): void {
    const toNumber = parseInt(payload)
    if (isNaN(toNumber) || toNumber < 1) {
      this.flightAnimationTime = 1
    } else {
      this.flightAnimationTime = toNumber
    }
  }
}

export const modalWindowStore: ModalWindowStore = new ModalWindowStore()
