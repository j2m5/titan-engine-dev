import { makeAutoObservable } from 'mobx'
import { Settings } from '@/core/ports/Settings'
import type { CloudQuality } from '@/core/clouds/SceneCloudConfig'

class SettingsStore implements Settings {
  public showOrbitLines: boolean = true
  public showMarkers: boolean = true
  public showClouds = true
  public cloudQuality: CloudQuality = 'medium'

  public setCloudQuality(value: CloudQuality): void {
    if (!['low', 'medium', 'high'].includes(value)) throw new RangeError('Invalid cloud quality')
    this.cloudQuality = value
  }

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
