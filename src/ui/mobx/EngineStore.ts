import { makeAutoObservable, runInAction } from 'mobx'
import { Application } from '@/Application'
import { ScenarioConfig } from '@/config/scenarios'
import { timeStore } from '@/ui/mobx/TimeStore'
import { threeJS } from '@/core/graphic/ThreeJS'
import { Vector3 } from 'three'
import { scenarioContext } from '@/core/scenario/ScenarioContext'
import { LoadingProgressReporter } from '@/core/ports/LoadingProgressReporter'

class EngineStore implements LoadingProgressReporter {
  private app: Application | null = null
  public scenario: ScenarioConfig | null = null
  public appLoadingStatus: boolean = true
  public appLoadingProgress: number = 0
  public appLoadingTotal: number = 0
  public appLoadingAsset: string = ''

  public constructor() {
    makeAutoObservable(this)

    scenarioContext.subscribe('change', (scenario: ScenarioConfig | null): void => {
      runInAction((): void => {
        this.scenario = scenario
      })
    })
  }

  public async initialize(app: Application): Promise<void> {
    this.app = app
  }

  public async setScenario(payload: ScenarioConfig | null): Promise<void> {
    scenarioContext.set(payload)

    if (payload && this.app) {
      this.setAppLoadingStatus(true)

      timeStore.setSpeedOfTime(1)

      await this.app.run(payload)

      this.setAppLoadingStatus(false)

      threeJS.camera.position.set(...payload.defaultCameraPosition)
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

  public setAsset(payload: string): void {
    this.appLoadingAsset = payload
  }

  public setProgress(payload: number): void {
    this.appLoadingProgress = payload
  }

  public setTotal(payload: number): void {
    this.appLoadingTotal = payload
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
