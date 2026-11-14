import { describe, expect, it } from 'vitest'
import { Sphere, Vector3 } from 'three'
import '@/core/framework/TitanThree'
import { toThreeJSUnits } from '@/core/helpers/scaling'
import { TerrainBoulderObstacles, registerBoulderObstacles } from '@/core/terrain/TerrainBoulderObstacles'
import { makeBody, makeCollision } from './cameraCollisionStubs'

describe('camera terrain boulder integration', () => {
  const floor = toThreeJSUnits(100.1),
    meter = toThreeJSUnits(0.001)
  it('stops a complete one-frame crossing even when the planetary sphere has no hit', () => {
    const body = makeBody('planet', 100)
    const rocks = new TerrainBoulderObstacles(body)
    rocks.spheres = [new Sphere(new Vector3(0, floor + 10 * meter, 0), 8 * meter)]
    const release = registerBoulderObstacles(body.model!, rocks)
    try {
      const { camera, collision } = makeCollision([body], new Vector3(-50 * meter, floor + 10 * meter, 0))
      collision.resolve()
      camera.position.x = 50 * meter
      collision.resolve()
      expect(camera.position.x).toBeLessThanOrEqual(-8 * meter)
      expect(camera.position.distanceTo(rocks.spheres[0].center)).toBeGreaterThanOrEqual(8 * meter)
    } finally {
      release()
    }
  })
  it('clears overlapping stones at startup while retaining the planet floor', () => {
    const body = makeBody('planet', 100),
      rocks = new TerrainBoulderObstacles(body)
    rocks.spheres = [-13.1, 13.1].map((x) => new Sphere(new Vector3(x * meter, floor + meter, 0), 15 * meter))
    const release = registerBoulderObstacles(body.model!, rocks)
    try {
      const { camera, collision } = makeCollision([body], new Vector3(0, floor + 5 * meter, 0))
      collision.resolve()
      for (const sphere of rocks.spheres)
        expect(camera.position.distanceTo(sphere.center)).toBeGreaterThanOrEqual(sphere.radius)
      expect(camera.position.length()).toBeGreaterThanOrEqual(floor)
    } finally {
      release()
    }
  })
})
