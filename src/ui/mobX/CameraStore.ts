import { makeAutoObservable } from 'mobx'
import { Object3D, Vector3 } from 'three'
import { clamp } from 'three/src/math/MathUtils'
import { AppConfig } from '@/config/app'
import { AU, LightSpeed } from '@/core/constants'

class CameraStore {
  public readonly minSpeed: number = 10
  public readonly maxSpeed: number = 150000000 * 30
  public speed: number = 100000
  public distanceTo: number = 0
  public currentTarget: Object3D | null = null
  public position: Vector3 = new Vector3().fromArray(AppConfig.DefaultCameraPosition)

  public constructor() {
    makeAutoObservable(this)
  }

  public get speedInLSAndAU(): number {
    if (this.speed >= AU) {
      return this.speed / AU
    } else {
      return this.speed / LightSpeed
    }
  }

  public setSpeed(payload: number): void {
    this.speed = payload
  }

  public adjustSpeed(deltaY: number): void {
    const factor: number = deltaY < 0 ? 1.1 : 0.9
    this.speed = clamp(this.speed * factor, this.minSpeed, this.maxSpeed)
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
