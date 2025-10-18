import { makeAutoObservable } from 'mobx'
import DIServices from '@/core/framework/DI/DIServices'
import container from '@/core/framework/DI/container'
import { Application } from '@/Application'
import { ScenarioConfig } from '@/config/scenarios'
import { GalaxyAppState } from '@/core/services/states/GalaxyAppState'
import { timeStore } from '@/ui/mobX/TimeStore'
import { threeJS } from '@/core/graphic/ThreeJS'
import { AppConfig } from '@/config/app'
import { Vector3 } from 'three'

const app: Application = container.get(DIServices.Application)

class EngineStore {
  public scenario: ScenarioConfig | null = null
  public appLoadingStatus: boolean = true
  public appLoadingProgress: number = 0
  public appLoadingTotal: number = 0
  public appLoadingAsset: string = ''

  public constructor() {
    makeAutoObservable(this)
  }

  public async setScenario(payload: ScenarioConfig | null): Promise<void> {
    this.scenario = payload

    if (this.scenario) {
      this.setAppLoadingStatus(true)
      timeStore.setSpeedOfTime(1)
      await app.setState(new GalaxyAppState())

      threeJS.camera.position.set(...AppConfig.DefaultCameraPosition)
      threeJS.camera.lookAt(new Vector3())
    }
  }

  public setAppLoadingStatus(payload: boolean): void {
    this.appLoadingStatus = payload
  }

  public setAppLoadingProgress(payload: number): void {
    this.appLoadingProgress = payload
  }

  public setAppLoadingTotal(payload: number): void {
    this.appLoadingTotal = payload
  }

  public setAppLoadingAsset(payload: string): void {
    this.appLoadingAsset = payload
  }

  public get loadingPercentage(): number {
    if (this.appLoadingProgress > 0 || this.appLoadingTotal > 0) {
      return Math.ceil((this.appLoadingProgress / this.appLoadingTotal) * 100)
    } else {
      return 0
    }
  }
}

export const engineStore: EngineStore = new EngineStore()
