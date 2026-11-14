import { describe, expect, it } from 'vitest'
import { Vector3 } from 'three'
import { toThreeJSUnits } from '@/core/helpers/scaling'
import { cubeFaceDirection } from '@/core/terrain/cubeSphere'
import type { TerrainHeightField } from '@/core/terrain/TerrainHeightField'
import { nodeSurfaceDistanceUnits } from '@/core/terrain/terrainQuadtreeSelect'

const field = {
  radiusKm: 175,
  minMeters: -30000,
  maxMeters: 30000,
  midbandMaxAmplitudeMeters: 200
} as TerrainHeightField

describe('SSE distance to a radial height capsule', () => {
  it('does not treat a mountain range 20 km to the side as touching the camera', () => {
    const distance = nodeSurfaceDistanceUnits(
      field,
      8,
      new Vector3(toThreeJSUnits(175), toThreeJSUnits(20), 0),
      new Vector3(1, 0, 0)
    )
    expect(distance).toBeGreaterThan(toThreeJSUnits(18))
    expect(distance).toBeLessThan(toThreeJSUnits(20))
  })

  it('never overstates distance to surface vertices at face corners, seams and radial extremes', () => {
    for (const level of [1, 6, 10]) {
      const size = 2 ** level,
        span = 2 / size
      for (let face = 0; face < 6; face++)
        for (const i of [0, size / 2, size - 1])
          for (const j of [0, size - 1]) {
            const s = -1 + i * span,
              t = -1 + j * span
            const direction = cubeFaceDirection(face, s + span / 2, t + span / 2, new Vector3())
            for (const camera of [
              direction.clone().multiplyScalar(toThreeJSUnits(175)),
              new Vector3(toThreeJSUnits(300), 0, 0),
              new Vector3(toThreeJSUnits(200), toThreeJSUnits(40), toThreeJSUnits(15))
            ]) {
              const distance = nodeSurfaceDistanceUnits(field, level, camera, direction)
              for (const u of [0, 0.5, 1])
                for (const v of [0, 0.5, 1])
                  for (const height of [-30200, 30200]) {
                    const point = cubeFaceDirection(face, s + u * span, t + v * span, new Vector3()).multiplyScalar(
                      toThreeJSUnits(field.radiusKm + height / 1000)
                    )
                    expect(distance).toBeLessThanOrEqual(camera.distanceTo(point) + 1e-12)
                  }
            }
          }
    }
  })
})
