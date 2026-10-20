import { makeAutoObservable, observable, runInAction } from 'mobx'
import type { Application } from '@/Application'
import type { ScenarioConfig } from '@/config/scenarios'
import { timeStore } from '@/ui/mobx/TimeStore'
import { notificationStore } from '@/ui/mobx/NotificationStore'
import type { PerspectiveCamera } from 'three'
import { loadSimulationRuntimeModule } from '@/ui/runtime/runtimeLoader'
import type { SimulationRuntime } from '@/ui/runtime/simulationRuntime'
import { scenarioContext } from '@/core/scenario/ScenarioContext'
import type { LoadingProgressReporter } from '@/core/ports/LoadingProgressReporter'
import type { CameraCollision } from '@/core/services/CameraCollision'

class EngineStore implements LoadingProgressReporter {
  private app: Application | null = null
  private renderCamera: PerspectiveCamera | null = null
  private cameraCollision: CameraCollision | null = null
  private selectionGeneration: number = 0
  private scenarioCleanup: (() => void) | null = null
  public runtime: SimulationRuntime | null = null
  public scenario: ScenarioConfig | null = null
  public appLoadingStatus: boolean = true
  public appLoadingProgress: number = 0
  public appLoadingTotal: number = 0
  public appLoadingAsset: string = ''

  public constructor() {
    makeAutoObservable<EngineStore, 'app' | 'renderCamera' | 'cameraCollision' | 'scenarioCleanup' | 'selectionGeneration'>(this, {
      app: false,
      renderCamera: false,
      cameraCollision: false,
      scenarioCleanup: false,
      selectionGeneration: false,
      runtime: observable.ref,
      scenario: observable.ref
    })

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

  /** Registered only once the body-info module has been requested. */
  public registerScenarioCleanup(cleanup: () => void): void {
    this.scenarioCleanup = cleanup
  }

  public async setScenario(payload: ScenarioConfig | null): Promise<void> {
    const generation = ++this.selectionGeneration
    this.scenarioCleanup?.()
    scenarioContext.set(payload)

    if (!payload) {
      this.app?.dispose()
      this.setAppLoadingStatus(false)
      return
    }

    this.setAppLoadingStatus(true)
    this.setAsset('')
    this.setProgress(0)
    this.setTotal(0)

    try {
      if (!this.app) {
        const module = await loadSimulationRuntimeModule()
        if (generation !== this.selectionGeneration) return
        const runtime = await module.initializeSimulationRuntime()
        if (generation !== this.selectionGeneration) return
        runInAction(() => {
          this.runtime = runtime
          this.app = runtime.app
        })
      }

      timeStore.setSpeedOfTime(1)
      // Teleport before run(): engine.start() renders its first frame synchronously.
      this.renderCamera?.position.set(...payload.defaultCameraPosition)
      this.renderCamera?.lookAt(0, 0, 0)
      this.cameraCollision?.reset()
      await this.app!.run(payload)
      if (generation !== this.selectionGeneration) return
    } catch (error) {
      if (generation !== this.selectionGeneration) return
      console.error('[EngineStore] Scenario failed to load', error)
      notificationStore.dispatch({ type: 'error', message: `Scenario failed to load: ${payload.name}` })
      await this.setScenario(null)
    } finally {
      if (generation === this.selectionGeneration) this.setAppLoadingStatus(false)
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
    // Пока «всего» неизвестно, доля не определена: 0, а не NaN или Infinity
    if (this.appLoadingTotal <= 0) return 0

    return Math.min(100, Math.max(0, Math.ceil((this.appLoadingProgress / this.appLoadingTotal) * 100)))
  }
}

export const engineStore: EngineStore = new EngineStore()
