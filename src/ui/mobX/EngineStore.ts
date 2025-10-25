import { makeAutoObservable } from 'mobx'
import { Application } from '@/Application'
import { ScenarioConfig } from '@/config/scenarios'
import { timeStore } from '@/ui/mobX/TimeStore'
import { threeJS } from '@/core/graphic/ThreeJS'
import { Vector3 } from 'three'

class EngineStore {
  private app: Application | null = null
  public scenario: ScenarioConfig | null = null
  public appLoadingStatus: boolean = true
  public appLoadingProgress: number = 0
  public appLoadingTotal: number = 0
  public appLoadingAsset: string = ''

  public constructor() {
    makeAutoObservable(this)
  }

  public async initialize(app: Application): Promise<void> {
    this.app = app
  }

  public async setScenario(payload: ScenarioConfig | null): Promise<void> {
    this.scenario = payload

    if (this.scenario && this.app) {
      this.setAppLoadingStatus(true)

      timeStore.setSpeedOfTime(1)

      await this.app.run(this.scenario)

      this.setAppLoadingStatus(false)

      threeJS.camera.position.set(...this.scenario.defaultCameraPosition)
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
