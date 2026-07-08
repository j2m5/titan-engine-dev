import { makeAutoObservable } from 'mobx'
import { Settings } from '@/core/ports/Settings'

class SettingsStore implements Settings {
  public showOrbitLines: boolean = true
  public showMarkers: boolean = true

  public constructor() {
    makeAutoObservable(this)
  }

  public toggle(key: BooleanSettingKey): void {
    this[key] = !this[key]
  }
}

export type BooleanSettingKey = {
  [K in keyof SettingsStore]: SettingsStore[K] extends boolean ? K : never
}[keyof SettingsStore]

export const settingsStore: SettingsStore = new SettingsStore()
