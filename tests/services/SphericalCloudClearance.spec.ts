import { afterEach, describe, expect, it } from 'vitest'
import { Object3D, Vector3 } from 'three'
import '@/core/framework/TitanThree'
import { Actor } from '@/core/models/Actor'
import { ActorResource } from '@storage/database'
import { resolveSceneClouds } from '@/core/clouds/resolveSceneClouds'
import { heightFieldStorage } from '@/core/services/HeightFieldStorage'
import { toThreeJSUnits } from '@/core/helpers/scaling'
import { makeBody, makeCollision } from './cameraCollisionStubs'

afterEach(() => heightFieldStorage.clear())

describe('spherical planet clearance keeps the authored cloud layer reachable', () => {
  it.each([10, 11, 12, 13, 44, 57, 63, 64, 82, 90, 120, 130])(
    'actor %i can descend into its actual catalog cloud layer',
    (actorId) => {
      const actor = Actor.find(actorId)!
      const radiusKm = actor.physicalObject!.getAttribute('radius')!
      const resources = new Set(ActorResource.filter((row) => row.actorId === actorId).map((row) => row.resourceId))
      const layer = resolveSceneClouds(actorId, undefined, resources).volume!.layers[0]
      const body = new Object3D()
      body.model = actor
      body.userData.type = 'planet'
      // The same order of world coordinates as the Alkaid production reproduction.
      body.position.set(647611, -28184, 1213018)
      const inside = body.position
        .clone()
        .add(
          new Vector3(toThreeJSUnits(radiusKm + (layer.baseAltitudeMeters + layer.thicknessMeters / 2) / 1000), 0, 0)
        )
      const above = body.position
        .clone()
        .add(
          new Vector3(toThreeJSUnits(radiusKm + (layer.baseAltitudeMeters + layer.thicknessMeters + 8000) / 1000), 0, 0)
        )
      const { camera, collision } = makeCollision([body], above)
      collision.resolve()
      camera.position.copy(inside)
      collision.resolve()
      expect(camera.position.distanceTo(inside)).toBeLessThan(toThreeJSUnits(0.001))
      expect(camera.position.distanceTo(body.position)).toBeGreaterThan(toThreeJSUnits(radiusKm))
    }
  )

  it('still stops a fast descent before the giant surface', () => {
    const body = makeBody('planet', 60000)
    const { camera, collision } = makeCollision([body], new Vector3(toThreeJSUnits(60018), 0, 0))
    collision.resolve()
    camera.position.set(0, 0, 0)
    collision.resolve()
    expect(camera.position.x).toBeGreaterThanOrEqual(toThreeJSUnits(60001))
    expect(camera.position.x).toBeLessThan(toThreeJSUnits(60001.2))
  })

  it('pushes an initial interior camera above the giant surface', () => {
    const { camera, collision } = makeCollision([makeBody('planet', 60000)], new Vector3(0, 0, 0))
    collision.resolve()
    expect(camera.position.length()).toBeCloseTo(toThreeJSUnits(60001), 10)
  })

  it('preserves the proportional gap on a small moon', () => {
    const { camera, collision } = makeCollision([makeBody('planet', 100)], new Vector3(0, 0, 0))
    collision.resolve()
    expect(camera.position.length()).toBeCloseTo(toThreeJSUnits(100.1), 10)
  })

  it('preserves the existing gap for stars', () => {
    const { camera, collision } = makeCollision([makeBody('star', 60000)], new Vector3(0, 0, 0))
    collision.resolve()
    expect(camera.position.length()).toBeCloseTo(toThreeJSUnits(60060), 10)
  })
})
