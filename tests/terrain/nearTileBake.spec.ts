import { describe, expect, it } from 'vitest'
import { Vector3 } from 'three'
import { buildNearTileHeights } from '@/core/terrain/nearTileBake'
import { texelCenter, tileToDir } from '@/core/terrain/terrainNearShadowMath'
import { makeField, nearParams } from './workerBuildHelpers'

describe('buildNearTileHeights', () => {
  it('бит-в-бит равно прямым вызовам heightMeters в точках плитки', () => {
    const field = makeField()
    const p = nearParams([0.3, 0.5, 0.8])
    const heights = buildNearTileHeights(field, p)
    const R = field.radiusKm * 1000
    const h0 = field.heightMeters(new Vector3(...p.center))

    expect(heights).toBeInstanceOf(Float32Array)
    expect(heights).toHaveLength(64)
    for (let j = 0; j < 8; j++) {
      for (let i = 0; i < 8; i++) {
        const d = tileToDir(texelCenter(i, 8, p.texelMeters), texelCenter(j, 8, p.texelMeters), p.center, p.east, p.north, R)
        expect(heights[j * 8 + i]).toBe(Math.fround(field.heightMeters(new Vector3(...d)) - h0))
      }
    }
  })

  it('строка 0 — юг, столбец 0 — запад: углы отличаются от зеркальных', () => {
    const field = makeField()
    const p = nearParams([0.3, 0.5, 0.8])
    const heights = buildNearTileHeights(field, p)
    const R = field.radiusKm * 1000
    const h0 = field.heightMeters(new Vector3(...p.center))
    const half = (8 / 2) * p.texelMeters - p.texelMeters / 2
    const sw = tileToDir(-half, -half, p.center, p.east, p.north, R)

    expect(heights[0]).toBeCloseTo(field.heightMeters(new Vector3(...sw)) - h0, 3)
  })

  it('центр плитки при чётном texels — разность близка к прямому вызову (четыре средних текселя)', () => {
    const field = makeField()
    const p = nearParams([0.3, 0.5, 0.8], 8, 50)
    const heights = buildNearTileHeights(field, p)
    const mid = (heights[3 * 8 + 3] + heights[3 * 8 + 4] + heights[4 * 8 + 3] + heights[4 * 8 + 4]) / 4

    expect(Math.abs(mid)).toBeLessThan(5)
  })
})
