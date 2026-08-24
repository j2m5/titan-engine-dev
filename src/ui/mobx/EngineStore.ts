import { makeAutoObservable, runInAction } from 'mobx'
import { Application } from '@/Application'
import { ScenarioConfig } from '@/config/scenarios'
import { timeStore } from '@/ui/mobx/TimeStore'
import { PerspectiveCamera, Vector3 } from 'three'
import { scenarioContext } from '@/core/scenario/ScenarioContext'
import { LoadingProgressReporter } from '@/core/ports/LoadingProgressReporter'
import type { CameraCollision } from '@/core/services/CameraCollision'

class EngineStore implements LoadingProgressReporter {
  private app: Application | null = null
  private renderCamera: PerspectiveCamera | null = null
  private cameraCollision: CameraCollision | null = null
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

  public connect(camera: PerspectiveCamera, cameraCollision: CameraCollision): void {
    this.renderCamera = camera
    this.cameraCollision = cameraCollision
  }

  public async setScenario(payload: ScenarioConfig | null): Promise<void> {
    scenarioContext.set(payload)

    if (!payload) {
      // Выход в меню — та же разборка, что и перед сменой сценария: иначе
      // предыдущая сцена продолжает жить и рендериться за главным экраном.
      this.app?.dispose()

      return
    }

    if (this.app) {
      this.setAppLoadingStatus(true)

      timeStore.setSpeedOfTime(1)

      // Телепорт ДО run(): первый кадр бежит синхронно внутри engine.start()
      // (Engine.start → update → тик стримера/коллизий), и телепорт после
      // await опаздывал бы на кадр — SceneObserver успевал пересчитать состав
      // видеопамяти по устаревшей позиции и через предоплату закрепить
      // неверный набор на минимальную резидентность. Камера — синглтон
      // контейнера, run() её не трогает; старая сцена скрыта экраном загрузки.
      this.renderCamera?.position.set(...payload.defaultCameraPosition)
      this.renderCamera?.lookAt(new Vector3())
      // Телепорт: без сброса свип коллизий протянет отрезок от старой позиции
      this.cameraCollision?.reset()

      await this.app.run(payload)

      this.setAppLoadingStatus(false)
    }
  }

  public setAppLoadingStatus(payload: boolean): void {
    this.appLoadingStatus = payload
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
