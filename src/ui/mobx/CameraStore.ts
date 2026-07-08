import { makeAutoObservable, runInAction } from 'mobx'
import { Object3D, Vector3 } from 'three'
import { AU, LightSpeed } from '@/core/constants'
import { config } from '@/core/framework/config'
import { CameraController } from '@/core/camera/CameraController'

class CameraStore {
  public minSpeed: number = 10
  public maxSpeed: number = 150000000 * 30
  public speed: number = 100000
  public distanceTo: number = 0
  public currentTarget: Object3D | null = null
  public position: Vector3 = new Vector3().fromArray(config('cameraPosition'))

  private _controller: CameraController | null = null

  public constructor() {
    makeAutoObservable<CameraStore, '_controller'>(this, { _controller: false })
  }

  /** Подключение к сервису-владельцу скорости: стор становится его зеркалом. */
  public connect(controller: CameraController): void {
    this._controller = controller
    runInAction((): void => {
      this.minSpeed = controller.minSpeed
      this.maxSpeed = controller.maxSpeed
    })
    this.mirror()
    controller.subscribe('change', this.mirror)
  }

  private mirror = (): void => {
    runInAction((): void => {
      this.speed = this._controller!.speed
    })
  }

  public get formatSpeed(): { speed: number; unit: string } {
    if (this.speed < LightSpeed) {
      return { speed: this.speed, unit: 'km/s' }
    } else if (this.speed > LightSpeed && this.speed < AU) {
      return { speed: this.speed / LightSpeed, unit: 'c' }
    } else {
      return { speed: this.speed / AU, unit: 'au/s' }
    }
  }

  public setSpeed(payload: number): void {
    this._controller?.setSpeed(payload)
  }

  public setDistanceTo(payload: number): void {
    this.distanceTo = payload
  }

  public setCurrentTarget(payload: Object3D | null): void {
    this.currentTarget = payload
  }

  public setPosition(payload: Vector3): void {
    this.position = payload
  }
}

export const cameraStore: CameraStore = new CameraStore()
