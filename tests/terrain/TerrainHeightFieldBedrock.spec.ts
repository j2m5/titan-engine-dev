import { beforeAll, describe, expect, it } from 'vitest'
import { Vector2, Vector3 } from 'three'
import { TerrainHeightField, CLEARANCE_MARGIN_METERS } from '@/core/terrain/TerrainHeightField'
import { MIDBAND_DEFAULTS } from '@/core/terrain/midbandParams'
import { toThreeJSUnits } from '@/core/helpers/scaling'
import { buildNearTileHeights } from '@/core/terrain/nearTileBake'
import { allocatePatchArrays, buildPatchIndex, buildTerrainPatchArrays } from '@/core/terrain/terrainPatchGeometry'
import { detailWrapFor } from '@/core/terrain/detailWrap'
import type { HeightMapData } from '@/core/terrain/heightMapFormat'
import { registerFieldMessage } from '@/core/terrain/worker/WorkerTerrainPatchBuilder'
import { createWorkerState, handleWorkerMessage } from '@/core/terrain/worker/terrainBuildHandler'
import { cubeFaceDirection } from '@/core/terrain/cubeSphere'

const R = 3390
function ramp(slope = 0.7, centerLat = 0): HeightMapData {
  const width = 64,
    height = 512
  // Integer raw steps make the central DEM ramp affine: unrelated quantization sag cannot hide a bedrock error.
  const rangeMeters = (((Math.PI * R * 1000 * slope) / height) * 65535) / 2048
  const minMeters = -rangeMeters / 2,
    maxMeters = rangeMeters / 2
  const data = new Uint16Array(width * height)
  for (let y = 0; y < height; y++) {
    const lat = (0.5 - (y + 0.5) / height) * Math.PI
    const meters = Math.max(-0.03, Math.min(0.03, lat - centerLat)) * R * 1000 * slope
    data.fill(Math.round(((meters - minMeters) / (maxMeters - minMeters)) * 65535), y * width, (y + 1) * width)
  }
  return { width, height, minMeters, maxMeters, data }
}
const dir = (lat: number, lon = 0) =>
  new Vector3(Math.cos(lat) * Math.cos(lon), Math.sin(lat), Math.cos(lat) * Math.sin(lon))
const floor = (field: TerrainHeightField, p: Vector3) =>
  field.surfaceRadiusUnits(p) + toThreeJSUnits((field.sagMeters(p) + CLEARANCE_MARGIN_METERS) / 1000)
const fresh = () => ({ heightMeters: 0, tiltE: 0, tiltN: 0, envelope: 0, octaveWeightSum: 0, mapSlopeScale: 0 })
const map = ramp()

describe.each([0, 1])('canonical bedrock surface, weathering %s', (bedrockWeathering) => {
  const settings = { ...MIDBAND_DEFAULTS, midbandStrength: 0, bedrockStrength: 0.6, bedrockWeathering }
  let field: TerrainHeightField
  beforeAll(() => {
    field = new TerrainHeightField(map, R, settings)
  })

  it('keeps baked DEM calibration independent of bedrock when registering a worker', () => {
    const state = createWorkerState()
    handleWorkerMessage(state, registerFieldMessage(field, 7).message)
    const worker = state.fields.get(7)!
    expect(worker.maxSagMeters).toBe(field.maxSagMeters)
    expect(worker.maxClearanceMeters).toBe(field.maxClearanceMeters)
    expect(worker.heightMeters(dir(0.000371))).toBe(field.heightMeters(dir(0.000371)))
    const off = new TerrainHeightField(map, R, { ...settings, bedrockStrength: 0 })
    expect(field.exportAux()).toEqual(off.exportAux())
    for (let i = 0; i < 10; i++) {
      const d = dir(i * 0.0000371)
      expect(field.collisionRadiusUnits(d)).toBeGreaterThanOrEqual(floor(field, d))
    }
  })
  it('changes physical heights even with noise disabled and includes their global bound', () => {
    let largest = 0
    for (let i = 0; i < 50; i++) {
      const d = dir(i * 0.00003)
      largest = Math.max(largest, Math.abs(field.heightMeters(d) - field.mapHeightMeters(d)))
      expect(field.heightMeters(d)).toBeLessThanOrEqual(field.maxHeightWithMidbandMeters)
    }
    expect(largest).toBeGreaterThan(50)
    expect(field.midbandMaxAmplitudeMeters).toBeGreaterThanOrEqual(largest)
  })

  it('returns matching parent and standalone LOD samples', () => {
    const d = dir(0.00037),
      uv = field.dirToUv(d, new Vector2()),
      map = field.mapHeightMeters(d)
    const child = fresh(),
      parent = fresh(),
      standalone = fresh()
    field.midbandSample(d, uv.x, uv.y, map, child, field.vertexStepMeters(10), true, field.vertexStepMeters(9), parent)
    field.midbandSample(d, uv.x, uv.y, map, standalone, field.vertexStepMeters(9))
    expect(child.heightMeters).toBeCloseTo(field.heightMeters(d) - map, 8)
    expect(parent).toEqual(standalone)
    expect(Math.abs(parent.heightMeters)).toBeGreaterThan(1)
  })

  it('reconstructs the physical gradient from the shader response and carries it through parent morphs', () => {
    for (let i = 1; i <= 20; i++) {
      const d = dir(i * 0.00004),
        uv = field.dirToUv(d, new Vector2()),
        h = field.mapHeightMeters(d)
      const split = fresh(),
        physical = fresh(),
        parent = fresh(),
        standalone = fresh()
      field.midbandSample(
        d,
        uv.x,
        uv.y,
        h,
        split,
        field.vertexStepMeters(10),
        true,
        field.vertexStepMeters(9),
        parent,
        true
      )
      field.midbandSample(d, uv.x, uv.y, h, physical, field.vertexStepMeters(10))
      field.midbandSample(d, uv.x, uv.y, h, standalone, field.vertexStepMeters(9), true, -1, null, true)
      const du = 1 / (2 * Math.PI * R * 1000 * Math.hypot(d.x, d.z)),
        dv = 1 / (Math.PI * R * 1000)
      const mapE = field.sampleMeters(uv.x + du, uv.y) - h,
        mapN = field.sampleMeters(uv.x, uv.y - dv) - h
      const scale = split.mapSlopeScale
      expect(split.tiltE + scale * mapE).toBeCloseTo(physical.tiltE, 10)
      expect(split.tiltN + scale * mapN).toBeCloseTo(physical.tiltN, 10)
      expect(parent).toEqual(standalone)
      expect(1 + scale).toBeGreaterThanOrEqual(0)
    }
  })

  it('writes the bedrock response to mesh vertices, parent endpoints, and skirts', () => {
    const arrays = allocatePatchArrays(64, true)
    const { center } = buildTerrainPatchArrays(field, 0, 512, 512, 10, 64, 0, detailWrapFor(undefined), arrays, true)
    let maximum = 0
    for (let y = 0; y <= 64; y += 2)
      for (let x = 0; x <= 64; x += 2) {
        const k = y * 65 + x,
          d = new Vector3()
            .fromArray(arrays.positions, k * 3)
            .add(center)
            .normalize()
        const uv = field.dirToUv(d, new Vector2()),
          sample = fresh(),
          parent = fresh()
        field.midbandSample(
          d,
          uv.x,
          uv.y,
          field.mapHeightMeters(d),
          sample,
          field.vertexStepMeters(10),
          true,
          field.vertexStepMeters(9),
          parent,
          true
        )
        const scale = sample.mapSlopeScale
        const parentScale = parent.mapSlopeScale
        maximum = Math.max(maximum, Math.abs(scale))
        expect(arrays.midTilts![k * 3 + 2]).toBeCloseTo(scale, 3)
        expect(arrays.morph!.midTilts[k * 3 + 2]).toBeCloseTo(parentScale, 3)
      }
    expect(maximum).toBeGreaterThan(0.1)
    expect(arrays.midTilts![65 * 65 * 3 + 2]).toBe(arrays.midTilts![2])
    expect(arrays.morph!.midTilts[65 * 65 * 3 + 2]).toBe(arrays.morph!.midTilts[2])
  })

  it('uses the physical ledge normal for camera sliding', () => {
    for (let i = 1; i <= 20; i++) {
      const d = dir(i * 0.00004),
        east = new Vector3(0, 1, 0).cross(d).normalize(),
        north = d.clone().cross(east)
      const gradient = (t: Vector3) =>
        (field.heightMeters(
          d
            .clone()
            .addScaledVector(t, 0.1 / (R * 1000))
            .normalize()
        ) -
          field.heightMeters(
            d
              .clone()
              .addScaledVector(t, -0.1 / (R * 1000))
              .normalize()
          )) /
        0.2
      const numeric = d
        .clone()
        .addScaledVector(east, -gradient(east))
        .addScaledVector(north, -gradient(north))
        .normalize()
      expect(field.surfaceNormalLocal(d, new Vector3()).distanceTo(numeric)).toBeLessThan(0.003)
    }
  })

  it('keeps the normal uphill immediately after a flat-to-steep DEM kink', () => {
    const width = 64,
      height = 512,
      minMeters = -100000,
      maxMeters = 100000
    const data = new Uint16Array(width * height),
      step = (Math.PI * R * 1000) / height
    for (let y = 0; y < height; y++) {
      const meters = 120 + Math.min(60000, Math.max(0, 255 - y) * 1.4 * step)
      data.fill(Math.round(((meters - minMeters) / (maxMeters - minMeters)) * 65535), y * width, (y + 1) * width)
    }
    const kink = new TerrainHeightField({ width, height, minMeters, maxMeters, data }, R, settings)
    const lat = (0.5 - 255.5 / height) * Math.PI + 1 / (R * 1000)
    const d = dir(lat),
      north = new Vector3(-d.y, d.x, 0)
    const numeric =
      (kink.heightMeters(dir(lat + 0.1 / (R * 1000))) - kink.heightMeters(dir(lat - 0.1 / (R * 1000)))) / 0.2
    const normal = kink.surfaceNormalLocal(d, new Vector3())
    expect(numeric).toBeGreaterThan(0.3)
    expect(-normal.dot(north) / normal.dot(d)).toBeCloseTo(numeric, 2)
  })

  it('finds narrow cliffs in the DEM that the coarse noise envelope misses', () => {
    const width = 32,
      height = 4096,
      minMeters = 0,
      maxMeters = 3000
    const data = new Uint16Array(width * height),
      step = (Math.PI * R * 1000) / height
    for (let y = 0; y < height; y++) {
      const meters = 200 + Math.max(0, Math.min(1, 2048 - y)) * step * 0.9
      data.fill(Math.round((meters / maxMeters) * 65535), y * width, (y + 1) * width)
    }
    const cliff = new TerrainHeightField({ width, height, minMeters, maxMeters, data }, R, settings)
    let maximum = 0
    for (let i = 0; i < 20; i++) {
      const d = dir((0.5 - (2047.6 + i * 0.04) / height) * Math.PI)
      maximum = Math.max(maximum, Math.abs(cliff.heightMeters(d) - cliff.mapHeightMeters(d)))
    }
    expect(maximum).toBeGreaterThan(25)
  })

  it('puts the same relief into near-shadow heights', () => {
    const off = new TerrainHeightField(map, R, { ...settings, bedrockStrength: 0 })
    const tile = { center: [1, 0, 0], east: [0, 0, -1], north: [0, 1, 0], texels: 16, texelMeters: 80 } as const
    const params = { ...tile, center: [...tile.center], east: [...tile.east], north: [...tile.north] } as Parameters<
      typeof buildNearTileHeights
    >[1]
    const onHeights = buildNearTileHeights(field, params),
      offHeights = buildNearTileHeights(off, params)
    expect(Math.max(...onHeights.map((h, i) => Math.abs(h - offHeights[i])))).toBeGreaterThan(50)
  })

  it('bounds multiple ledges and converges to the same point collision floor', () => {
    for (const lon of [0, Math.PI - 1e-5, -Math.PI + 1e-5]) {
      const a = dir(-0.001, lon),
        b = dir(0.001, lon)
      const upper = field.collisionRadiusUpperBoundUnits(a, b)
      for (let i = 0; i <= 100; i++)
        expect(
          floor(
            field,
            a
              .clone()
              .lerp(b, i / 100)
              .normalize()
          )
        ).toBeLessThanOrEqual(upper)
      const p = dir(0.000371, lon),
        tiny = dir(0.000371 + 1e-11, lon + 1e-11)
      const tight = field.collisionRadiusUpperBoundUnits(p, tiny)
      expect(tight).toBeGreaterThanOrEqual(floor(field, p))
      expect(tight - floor(field, p)).toBeLessThan(toThreeJSUnits(0.001))
    }
  })

  it.each([
    [0, 512, 512, 0.7],
    [0, 512, 1023, 0.45],
    [0, 1023, 1023, 0.9],
    [2, 512, 530, 0.7],
    [0, 512, 512, 1.4]
  ])('bounds settled L10 triangle interiors: face %i, patch %i/%i, slope %f', (face, patchI, patchJ, slope) => {
    const centerDir = cubeFaceDirection(face, -1 + (patchI + 0.5) / 512, -1 + (patchJ + 0.5) / 512, new Vector3())
    const field = new TerrainHeightField(ramp(slope, Math.asin(centerDir.y)), R, settings)
    const segments = 64,
      arrays = allocatePatchArrays(segments, true),
      index = buildPatchIndex(segments).array
    const { center } = buildTerrainPatchArrays(
      field,
      face,
      patchI,
      patchJ,
      10,
      segments,
      0,
      detailWrapFor(undefined),
      arrays,
      false
    )
    const vertex = (i: number) => new Vector3().fromArray(arrays.positions, i * 3).add(center)
    let worstMeters = -Infinity
    for (let i = 0; i < segments * segments * 6; i += 3) {
      const point = vertex(index[i])
        .add(vertex(index[i + 1]))
        .add(vertex(index[i + 2]))
        .multiplyScalar(1 / 3)
      const d = point.clone().normalize()
      worstMeters = Math.max(worstMeters, (point.length() - floor(field, d)) / toThreeJSUnits(0.001))
    }
    expect(worstMeters).toBeLessThanOrEqual(0.02)
  })
})
