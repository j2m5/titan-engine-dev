import { Frustum, Matrix4, PerspectiveCamera, Sphere, Vector3 } from 'three'
import { SpaceScale } from '@/core/constants'
import { AtmosphereRegistry, type AtmosphereEntry } from '@/core/services/AtmosphereRegistry'
import { orderSlots } from './atmosphereDepthMath'
import { ATMOSPHERE_SLOTS } from './atmosphereSlotShader'

export interface AtmosphereFrameSnapshot {
  readonly serial: number
  readonly dropped: readonly AtmosphereEntry[]
  readonly slots: readonly {
    readonly index: number
    readonly entry: AtmosphereEntry
    readonly generation: number
    readonly centerKm: Vector3
    readonly sunDirection: Vector3
  }[]
}

/** Geometry is copied once; entry identity and captured generation let consumers reject stale LUTs. */
export function captureAtmosphereFrame(
  camera: PerspectiveCamera,
  registry: AtmosphereRegistry,
  serial: number
): AtmosphereFrameSnapshot {
  const cameraWorld = new Vector3().setFromMatrixPosition(camera.matrixWorld)
  const frustum = new Frustum().setFromProjectionMatrix(
    new Matrix4().multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse)
  )
  const shell = new Sphere()
  const items = registry
    .entries()
    .filter((entry) => {
      if (!entry.ready) return false
      shell.center.setFromMatrixPosition(entry.object.matrixWorld)
      shell.radius = entry.config.topRadius * SpaceScale
      return shell.containsPoint(cameraWorld) || frustum.intersectsSphere(shell)
    })
    .map((entry) => {
      const centerWorld = new Vector3().setFromMatrixPosition(entry.object.matrixWorld)
      return {
        entry,
        centerKm: centerWorld
          .clone()
          .sub(cameraWorld)
          .multiplyScalar(1 / SpaceScale),
        topRadiusKm: entry.config.topRadius,
        sunDirection: centerWorld.negate().normalize()
      }
    })
  const { chosen, dropped } = orderSlots(items, ATMOSPHERE_SLOTS, 1e-5)
  const slots = chosen.map(({ entry }, index) => {
    const item = items.find((item) => item.entry === entry)!
    return Object.freeze({
      index,
      entry,
      generation: entry.generation,
      centerKm: Object.freeze(item.centerKm),
      sunDirection: Object.freeze(item.sunDirection)
    })
  })
  return Object.freeze({ serial, slots: Object.freeze(slots), dropped: Object.freeze(dropped) })
}
