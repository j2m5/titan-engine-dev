import { existsSync, readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { Frustum, Matrix4, PerspectiveCamera, Vector3 } from 'three'
import { Actor } from '@/core/models/Actor'
import { toThreeJSUnits } from '@/core/helpers/scaling'
import { parseHeightMap } from '@/core/terrain/heightMapFormat'
import { TerrainHeightField } from '@/core/terrain/TerrainHeightField'
import { midbandParamsOf } from '@/core/terrain/midbandParams'
import { selectTerrainNodes } from '@/core/terrain/terrainQuadtreeSelect'
import { MAX_LIVE_PATCHES } from '@/core/terrain/TerrainPatchPool'

const path = 'storage/images/textures/planets/ceres/ceres_height.raw'

describe.skipIf(!existsSync(path))('rocky small-body LOD budget', () => {
  it('can complete the visible Ceres cliff within the existing pool', () => {
    const buffer = readFileSync(path)
    const field = new TerrainHeightField(
      parseHeightMap(buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength) as ArrayBuffer),
      469.7,
      midbandParamsOf(Actor.find(9)!)
    )
    const lat = (-55.45 * Math.PI) / 180,
      lon = (160.65 * Math.PI) / 180
    const up = new Vector3(Math.cos(lat) * Math.cos(lon), Math.sin(lat), Math.cos(lat) * Math.sin(lon))
    const normal = field.surfaceNormalLocal(up, new Vector3())
    const target = up.clone().multiplyScalar(field.surfaceRadiusUnits(up))
    const side = new Vector3().crossVectors(up, normal).normalize()
    const camera = new PerspectiveCamera(50, 1440 / 900, 1e-8, 100)
    camera.position.copy(target).addScaledVector(normal, toThreeJSUnits(0.5)).addScaledVector(side, toThreeJSUnits(0.5))
    camera.up.copy(up)
    camera.lookAt(target.clone().addScaledVector(up, toThreeJSUnits(1 / 6)))
    camera.updateMatrixWorld()
    const frustumLocal = new Frustum().setFromProjectionMatrix(
      new Matrix4().multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse)
    )
    const { leaves } = selectTerrainNodes({
      field,
      cameraLocal: camera.position,
      frustumLocal,
      screenHeight: 900,
      fovYRadians: (camera.fov * Math.PI) / 180,
      splitPixels: 6,
      mergeFactor: 0.7,
      currentlySplit: new Set()
    })
    expect(leaves.length).toBeLessThan(MAX_LIVE_PATCHES - 24)
    expect(Math.max(...leaves.filter((leaf) => leaf.visible).map((leaf) => leaf.level))).toBeGreaterThanOrEqual(8)
  })
})
