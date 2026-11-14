import { expect, it, vi } from 'vitest'
import { BufferAttribute, InstancedBufferGeometry, InstancedMesh, Mesh, Object3D, ShaderMaterial, Vector3 } from 'three'
import { TerrainBoulders } from '@/core/terrain/TerrainBoulders'
import { TerrainHeightField } from '@/core/terrain/TerrainHeightField'
import { MIDBAND_DEFAULTS } from '@/core/terrain/midbandParams'
import { boulderObstaclesFor } from '@/core/terrain/TerrainBoulderObstacles'
import { toThreeJSUnits } from '@/core/helpers/scaling'
import type { TerrainSurfacePatch } from '@/core/terrain/TerrainPatchGroup'
import { BoulderShadowFrame } from '@/core/terrain/boulderShadowFrame'
import { createBoulderShadowUniforms } from '@/core/materials/shaders/lib/chunks/BoulderShadow'

function deposit(radiusKm: number, cellMeters: number, water: number | null, elevation: number) {
  const unit = toThreeJSUnits(0.001),
    host = new Object3D(),
    actor = {},
    parent = new ShaderMaterial()
  const field = new TerrainHeightField(
    { width: 8, height: 4, minMeters: 0, maxMeters: 0, data: new Uint16Array(32) },
    radiusKm,
    { ...MIDBAND_DEFAULTS, waterLevelMeters: water }
  )
  // Isolate physical fitting/water placement from the independent geological density mask.
  vi.spyOn(field, 'bedrockTalusCoverage').mockReturnValue(1)
  const geometry = new InstancedBufferGeometry(),
    positions = new Float32Array(65 * 65 * 3)
  for (let y = 0; y <= 64; y++)
    for (let x = 0; x <= 64; x++) positions.set([x * cellMeters * unit, 0, -y * cellMeters * unit], 3 * (y * 65 + x))
  geometry.setAttribute('position', new BufferAttribute(positions, 3))
  geometry.computeBoundingSphere()
  const mesh = new Mesh(geometry, parent)
  mesh.position.set(0, toThreeJSUnits(radiusKm) + elevation * unit, 0)
  const patch: TerrainSurfacePatch = {
    address: { face: 2, level: 10, i: 511, j: 511 },
    handle: { mesh, geometry },
    morph: 0,
    target: 0
  }
  const camera = mesh.position.clone().add(new Vector3(32 * cellMeters, 50, -32 * cellMeters).multiplyScalar(unit))
  const layer = new TerrainBoulders(host, actor, field, parent, 1)
  for (let frame = 0; frame < 40; frame++) layer.update([patch], camera, frame / 60)
  return {
    layer,
    host,
    actor,
    unit,
    dispose: () => {
      layer.dispose()
      geometry.dispose()
      parent.dispose()
    }
  }
}

it('places visible rocks on the small triangles of a 175 km moon with a matching texture scale', () => {
  const f = deposit(175, 4, null, 0)
  try {
    expect(f.layer.count).toBeGreaterThan(50)
    expect(f.layer.count).toBeLessThanOrEqual(2048)
    for (const sphere of boulderObstaclesFor(f.actor)!.spheres) expect(sphere.radius / f.unit).toBeLessThan(3)
    const mesh = f.host.children[0].children[0] as InstancedMesh
    expect((mesh.material as ShaderMaterial).uniforms.uDetailScale.value).toBeCloseTo(1 / toThreeJSUnits(0.0008), 4)
  } finally {
    f.dispose()
  }
})

it('keeps submerged supporting triangles out of the boulder and collision layer', () => {
  const submerged = deposit(6360, 40, 0, -50),
    dry = deposit(6360, 40, 0, 50)
  try {
    expect(submerged.layer.count).toBe(0)
    expect(boulderObstaclesFor(submerged.actor)!.spheres).toHaveLength(0)
    expect(dry.layer.count).toBeGreaterThan(50)
  } finally {
    submerged.dispose()
    dry.dispose()
  }
})

it('keeps sub-metre rocks resolved by scaling the shadow footprint and receiver distance together', () => {
  const frame = new BoulderShadowFrame(0.1)
  frame.update(new Vector3(0, 1, 0), new Vector3(0, 0, 1))
  const receiver = frame.origin
    .clone()
    .addScaledVector(frame.right, toThreeJSUnits(0.1))
    .sub(frame.origin)
    .applyMatrix4(frame.relativeToShadow)
  expect(receiver.x).toBeCloseTo(0.98828125, 8)
  const settings = createBoulderShadowUniforms(0.1).uBoulderShadowSettings.value
  expect(settings.z).toBeCloseTo(toThreeJSUnits(0.07), 12)
  expect(settings.w).toBeCloseTo(toThreeJSUnits(0.1), 12)
})
