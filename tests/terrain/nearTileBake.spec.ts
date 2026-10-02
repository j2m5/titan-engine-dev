import { describe, expect, it } from 'vitest'
import { Vector3 } from 'three'
import { buildNearTileHeights } from '@/core/terrain/nearTileBake'
import { texelCenter, tileToDir, tileToDirInto, type Vec3 } from '@/core/terrain/terrainNearShadowMath'
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

  it('строка — y (юг→север), столбец — x (запад→восток): асимметричный тексел (1, 6) не путается с (6, 1)', () => {
    const field = makeField()
    const p = nearParams([0.3, 0.5, 0.8])
    const heights = buildNearTileHeights(field, p)
    const R = field.radiusKm * 1000
    const h0 = field.heightMeters(new Vector3(...p.center))
    const direct = (i: number, j: number): number =>
      field.heightMeters(
        new Vector3(...tileToDir(texelCenter(i, 8, p.texelMeters), texelCenter(j, 8, p.texelMeters), p.center, p.east, p.north, R))
      ) - h0

    expect(heights[6 * 8 + 1]).toBe(Math.fround(direct(1, 6)))
    expect(Math.abs(direct(1, 6) - direct(6, 1))).toBeGreaterThan(1)
    expect(heights[6 * 8 + 1]).not.toBe(Math.fround(direct(6, 1)))
  })

  it('tileToDirInto пишет в out и бит-в-бит равен tileToDir', () => {
    const p = nearParams([0.3, 0.5, 0.8])
    const out: Vec3 = [0, 0, 0]
    const ret = tileToDirInto(1234.5, -987.25, p.center, p.east, p.north, 1737400, out)

    expect(ret).toBe(out)
    expect(out).toEqual(tileToDir(1234.5, -987.25, p.center, p.east, p.north, 1737400))
  })

  it('центр плитки при чётном texels: средние тексели — точно heightMeters(тексел) − heightMeters(центр)', () => {
    const field = makeField()
    const p = nearParams([0.3, 0.5, 0.8], 8, 50)
    const heights = buildNearTileHeights(field, p)
    const R = field.radiusKm * 1000
    const h0 = field.heightMeters(new Vector3(...p.center))

    for (const [i, j] of [[3, 3], [4, 3], [3, 4], [4, 4]]) {
      const d = tileToDir(texelCenter(i, 8, 50), texelCenter(j, 8, 50), p.center, p.east, p.north, R)
      expect(heights[j * 8 + i]).toBe(Math.fround(field.heightMeters(new Vector3(...d)) - h0))
    }
  })
})
