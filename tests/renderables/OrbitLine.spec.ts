import { afterEach, expect, it } from 'vitest'
import { Vector3 } from 'three'
import { Actor } from '@/core/models/Actor'
import { Orbit } from '@/core/models/Orbit'
import type { IOrbit } from '@/core/models/types'
import { KeplerianModel } from '@/core/libs/KeplerianModel'
import { OrbitLine } from '@/core/renderables/utils/OrbitLine'
import { J2000 } from '@/core/constants'

const lines: OrbitLine[] = []
afterEach(() => {
  for (const line of lines) { line.geometry.dispose(); line.material.dispose() }
  lines.length = 0
})

function makeLine(elements: Partial<IOrbit>) {
  const actor = Actor.find(5)!.clone()
  const orbit = new Orbit({
    semiMajorAxis: -1, eccentricity: 2, inclination: 0, argOfPeriapsis: 0,
    ascendingNode: 0, meanAnomalyAtEpoch: 0, epoch: J2000, period: 0, ...elements
  })
  Object.defineProperty(actor, 'orbit', { get: () => orbit })
  const line = new OrbitLine(actor)
  lines.push(line)
  const model = new KeplerianModel(actor)
  const positions = line.geometry.getAttribute('position')
  const world = Array.from({ length: positions.count }, (_, i) => new Vector3().fromBufferAttribute(positions, i))
  const inverseFrame = model.getOrbitalFrameQuaternion().invert()
  const local = world.map(point => point.clone().applyQuaternion(inverseFrame))
  return { model, world, local }
}

it.each([
  { semiMajorAxis: -1, eccentricity: 2 },
  { semiMajorAxis: -1, eccentricity: 1 + Number.EPSILON },
  { semiMajorAxis: -0.01, eccentricity: 1.01 },
  { semiMajorAxis: -100, eccentricity: 10 },
  { semiMajorAxis: -1, eccentricity: 2, inclination: 37, ascendingNode: 74, argOfPeriapsis: 123 }
])('draws one bounded open physical hyperbola for %j', elements => {
  const { model, world, local } = makeLine(elements)
  const a = Math.abs(elements.semiMajorAxis), e = elements.eccentricity
  const periapsis = a * (e - 1)
  const extent = 100 * Math.max(a, periapsis)
  expect(local.length).toBeGreaterThan(100)
  expect(local.every(point => point.toArray().every(Number.isFinite))).toBe(true)
  expect(Math.max(...local.map(point => point.length()))).toBeLessThanOrEqual(extent * (1 + 1e-6))
  // The physical branch has x <= periapsis and r + e*x = a*(e^2 - 1).
  // Sampling a full revolution produces a second, impossible branch.
  expect(Math.max(...local.map(point => point.x))).toBeLessThanOrEqual(periapsis + Math.max(1, periapsis) * 1e-6)
  const p = a * (e - 1) * (e + 1)
  const residual = local.map(point => Math.abs(point.length() + e * point.x - p) / Math.max(1, point.length(), p))
  expect(Math.max(...residual)).toBeLessThan(1e-5)
  expect(Math.max(...local.map(point => Math.abs(point.z)))).toBeLessThan(extent * 1e-6)
  expect(local[0].y).toBeLessThan(0)
  expect(local.at(-1)!.y).toBeGreaterThan(0)
  expect(local[0].distanceTo(local.at(-1)!)).toBeGreaterThan(periapsis)
  expect(local.every((point, i) => i === 0 || point.y >= local[i - 1].y)).toBe(true)
  const actualPeriapsis = model.getStateByEpoch(J2000).position
  expect(Math.min(...world.map(point => point.distanceTo(actualPeriapsis)))).toBeLessThan(Math.max(1, periapsis) * 1e-6)
})

it.each([0, 0.5])('keeps elliptic orbits closed with the correct apsides (e=%s)', eccentricity => {
  const { local } = makeLine({ semiMajorAxis: 2, eccentricity, inclination: 39, ascendingNode: 78, argOfPeriapsis: 117 })
  expect(local[0].distanceTo(local.at(-1)!)).toBeLessThan(1e-6)
  expect(Math.min(...local.map(point => point.length()))).toBeCloseTo(2 * (1 - eccentricity), 5)
  expect(Math.max(...local.map(point => point.length()))).toBeCloseTo(2 * (1 + eccentricity), 5)
  expect(local.every(point => Math.abs(point.z) < 1e-6)).toBe(true)
})

it('does not invent an orbit for a stationary actor', () => {
  expect(makeLine({ semiMajorAxis: 0, eccentricity: 0 }).world).toEqual([])
})
