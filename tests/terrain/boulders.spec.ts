import { describe, expect, it } from 'vitest'
import { Matrix4, Object3D, Ray, Sphere, Vector3 } from 'three'
import { boulderRandom, sampleBoulderTriangle } from '@/core/terrain/boulderScatter'
import {
  TerrainBoulderObstacles,
  boulderObstaclesFor,
  registerBoulderObstacles
} from '@/core/terrain/TerrainBoulderObstacles'
import { BedrockField } from '@/core/terrain/bedrockField'
import { bedrockPhaseWarp } from '@/core/terrain/bedrockShape'
import { MIDBAND_DEFAULTS } from '@/core/terrain/midbandParams'

describe('boulder triangle anchors', () => {
  const positions = new Float32Array([0, 0, 0, 10, 0, 0, 0, 10, 0, 10, 10, 10])
  it('uses the rendered v00-v11 diagonal on both sides, including RTC translation', () => {
    const point = new Vector3(),
      normal = new Vector3(),
      center = new Vector3(1e6, 2e6, 3e6)
    sampleBoulderTriangle(positions, 1, 0.8, 0.2, center, point, normal)
    expect(point.toArray()).toEqual([1e6 + 8, 2e6 + 2, 3e6 + 2])
    expect(normal.dot(new Vector3(0, -1, 1).normalize())).toBeCloseTo(1)
    sampleBoulderTriangle(positions, 1, 0.2, 0.8, center, point, normal)
    expect(point.toArray()).toEqual([1e6 + 2, 2e6 + 8, 3e6 + 2])
    expect(normal.dot(new Vector3(-1, 0, 1).normalize())).toBeCloseTo(1)
  })
  it('returns zero clearance at a triangle edge and a positive inscribed margin inside', () => {
    const point = new Vector3(),
      normal = new Vector3(),
      center = new Vector3()
    expect(sampleBoulderTriangle(positions, 1, 0.5, 0.5, center, point, normal)).toBeCloseTo(0)
    expect(sampleBoulderTriangle(positions, 1, 0.75, 0.2, center, point, normal)).toBeGreaterThan(1)
  })
  it('keeps seeds stable and distributed across a full unsigned word', () => {
    const values = Array.from({ length: 1000 }, (_, i) => boulderRandom(i))
    expect(values).toEqual(Array.from({ length: 1000 }, (_, i) => boulderRandom(i)))
    expect(new Set(values).size).toBe(1000)
    expect(Math.min(...values)).toBeGreaterThanOrEqual(0)
    expect(Math.max(...values)).toBeLessThan(1)
    expect(values.reduce((a, b) => a + b) / values.length).toBeCloseTo(0.5, 1)
  })
})

describe('boulder camera obstacles', () => {
  it('sweeps a whole boulder in one frame through the host transform', () => {
    const host = new Object3D()
    host.position.set(1e5, -200, 55)
    host.rotation.set(0.6, 0.4, -0.2)
    host.scale.setScalar(3)
    host.updateMatrixWorld()
    const obstacles = new TerrainBoulderObstacles(host)
    obstacles.spheres = [new Sphere(new Vector3(0, 5, 0), 2)]
    const from = new Vector3(-10, 5, 0).applyMatrix4(host.matrixWorld)
    const to = new Vector3(10, 5, 0).applyMatrix4(host.matrixWorld)
    const ray = new Ray(from, to.clone().sub(from).normalize())
    const point = new Vector3(),
      normal = new Vector3()
    expect(obstacles.intersect(ray, from.distanceTo(to), point, normal)).toBeCloseTo(0.4)
    expect(
      point
        .clone()
        .applyMatrix4(new Matrix4().copy(host.matrixWorld).invert())
        .distanceTo(new Vector3(-2, 5, 0))
    ).toBeLessThan(1e-8)
    expect(normal.dot(new Vector3(-1, 0, 0).transformDirection(host.matrixWorld))).toBeCloseTo(1)
    expect(obstacles.intersect(ray, 10, point, normal)).toBeNull()
  })
  it('pushes a zero-length start at the sphere center out without NaNs', () => {
    const host = new Object3D(),
      obstacles = new TerrainBoulderObstacles(host)
    obstacles.spheres = [new Sphere(new Vector3(0, 5, 0), 2)]
    const point = new Vector3(0, 5, 0)
    expect(obstacles.pushOut(point)).toBe(true)
    expect(point.distanceTo(obstacles.spheres[0].center)).toBeGreaterThanOrEqual(2)
    expect(point.y).toBeGreaterThan(5)
    expect(obstacles.pushOut(point)).toBe(false)
  })
  it('clears overlapping proxies in one outward move, independent of their order', () => {
    const spheres = [new Sphere(new Vector3(-13.1, 1, 0), 15), new Sphere(new Vector3(13.1, 1, 0), 15)]
    const results: Vector3[] = []
    for (const list of [spheres, [...spheres].reverse()]) {
      const obstacles = new TerrainBoulderObstacles(new Object3D())
      obstacles.spheres = list
      const point = new Vector3(0, 5, 0)
      expect(obstacles.pushOut(point)).toBe(true)
      for (const sphere of spheres) expect(point.distanceTo(sphere.center)).toBeGreaterThanOrEqual(sphere.radius)
      results.push(point)
    }
    expect(results[0].distanceTo(results[1])).toBeLessThan(1e-10)
  })
  it('registers per actor and does not let old disposal remove its replacement', () => {
    const a = {},
      b = {},
      first = new TerrainBoulderObstacles(new Object3D()),
      second = new TerrainBoulderObstacles(new Object3D())
    const release = registerBoulderObstacles(a, first)
    const releaseSecond = registerBoulderObstacles(a, second)
    release()
    expect(boulderObstaclesFor(a)).toBe(second)
    expect(boulderObstaclesFor(b)).toBeUndefined()
    releaseSecond()
    expect(boulderObstaclesFor(a)).toBeUndefined()
  })
})

it('restricts deposits to weathered aprons and respects the slope, polar and water envelope', () => {
  const radius = 3390000,
    dir = new Vector3(1, 0, 0)
  const params = { ...MIDBAND_DEFAULTS, bedrockStrength: 0.45, bedrockStepMeters: 800, bedrockWeathering: 1 }
  const field = new BedrockField(params, radius)
  const height = (0.25 - bedrockPhaseWarp(1, 0, 0, radius, 1)) * 800
  expect(field.talusCoverage(dir, height, 0.7)).toBeGreaterThan(0.5)
  expect(field.talusCoverage(dir, height + 400, 0.7)).toBe(0)
  expect(field.talusCoverage(dir, height, 0.1)).toBe(0)
  expect(field.talusCoverage(new Vector3(0, 1, 0), height, 0.7)).toBe(0)
  expect(new BedrockField({ ...params, waterLevelMeters: height }, radius).talusCoverage(dir, height, 0.7)).toBe(0)
  expect(new BedrockField({ ...params, bedrockWeathering: 0 }, radius).talusCoverage(dir, height, 0.7)).toBe(0)
})
