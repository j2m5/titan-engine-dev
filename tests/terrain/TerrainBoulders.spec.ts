import { describe, expect, it, vi } from 'vitest'
import {
  BufferAttribute,
  InstancedBufferGeometry,
  Mesh,
  Object3D,
  ShaderMaterial,
  Texture,
  Uniform,
  Vector3
} from 'three'
import { TerrainBoulderMaterial } from '@/core/materials/TerrainBoulderMaterial'
import { createBoulderGeometry } from '@/core/terrain/boulderGeometry'
import { TerrainBoulders } from '@/core/terrain/TerrainBoulders'
import { TerrainHeightField } from '@/core/terrain/TerrainHeightField'
import { boulderObstaclesFor } from '@/core/terrain/TerrainBoulderObstacles'
import { toThreeJSUnits } from '@/core/helpers/scaling'
import type { TerrainSurfacePatch } from '@/core/terrain/TerrainPatchGroup'

it('shares streamed surface uniforms and follows define additions and removals', () => {
  const parent = new ShaderMaterial({
    uniforms: { diffuseMap: new Uniform(null) },
    defines: { USE_SLOPE: true, USE_TERRAIN_DETAIL: true }
  })
  const material = new TerrainBoulderMaterial(parent)
  expect(material.fragmentShader).toBe(parent.fragmentShader)
  expect(material.uniforms.diffuseMap).toBe(parent.uniforms.diffuseMap)
  expect(material.defines.USE_SLOPE).toBeUndefined()
  expect(material.defines.USE_TERRAIN_DETAIL).toBe(true)
  parent.uniforms.diffuseMap.value = new Texture()
  parent.defines.USE_SUN_TINT = true
  material.sync(parent)
  expect(material.uniforms.diffuseMap.value).toBe(parent.uniforms.diffuseMap.value)
  expect(material.defines.USE_SUN_TINT).toBe(true)
  delete parent.defines.USE_TERRAIN_DETAIL
  material.sync(parent)
  expect(material.defines.USE_TERRAIN_DETAIL).toBeUndefined()
  material.dispose()
  expect(parent.uniforms.diffuseMap.value).toBeInstanceOf(Texture)
  parent.uniforms.diffuseMap.value.dispose()
  parent.dispose()
})

describe('bounded boulder geometry and lifecycle', () => {
  it('keeps placement deterministic through eviction and suppresses morphing or hidden patches', () => {
    const unit = toThreeJSUnits(0.001),
      host = new Object3D(),
      actor = {},
      parent = new ShaderMaterial()
    const field = new TerrainHeightField(
      { width: 8, height: 4, minMeters: 0, maxMeters: 0, data: new Uint16Array(32) },
      3390
    )
    vi.spyOn(field, 'bedrockTalusCoverage').mockReturnValue(1)
    const geometry = new InstancedBufferGeometry(),
      positions = new Float32Array(65 * 65 * 3)
    for (let y = 0; y <= 64; y++)
      for (let x = 0; x <= 64; x++) positions.set([x * 40 * unit, 0, -y * 40 * unit], 3 * (y * 65 + x))
    geometry.setAttribute('position', new BufferAttribute(positions, 3))
    geometry.computeBoundingSphere()
    const mesh = new Mesh(geometry, parent)
    mesh.position.set(0, toThreeJSUnits(3390), 0)
    const patch: TerrainSurfacePatch = {
      address: { face: 2, level: 10, i: 511, j: 511 },
      handle: { mesh, geometry },
      morph: 0,
      target: 0
    }
    const camera = mesh.position.clone().add(new Vector3(1280, 200, -1280).multiplyScalar(unit))
    const layer = new TerrainBoulders(host, actor, field, parent, 1)
    const update = (p: TerrainSurfacePatch, offset: number) => {
      for (let frame = 0; frame < 40; frame++) layer.update([p], camera, offset + frame / 60)
    }
    update(patch, 0)
    const first = boulderObstaclesFor(actor)!.spheres.map((s) => s.center.toArray())
    expect(first.length).toBeGreaterThan(100)
    expect(first.length).toBeLessThanOrEqual(2048)
    layer.update([{ ...patch, morph: 0.5 }], camera, 1)
    expect(layer.count).toBe(0)
    expect(boulderObstaclesFor(actor)!.spheres).toHaveLength(0)
    layer.hide()
    update(patch, 2)
    expect(boulderObstaclesFor(actor)!.spheres.map((s) => s.center.toArray())).toEqual(first)
    mesh.visible = false
    layer.update([patch], camera, 3)
    expect(layer.count).toBe(0)
    layer.dispose()
    geometry.dispose()
    parent.dispose()
  })
  it('makes four distinct watertight shapes with finite outward normals inside the proxy radius', () => {
    const shapes = Array.from({ length: 4 }, (_, i) => createBoulderGeometry(i))
    expect(new Set(shapes.map((g) => JSON.stringify(Array.from(g.getAttribute('position').array)))).size).toBe(4)
    for (const geometry of shapes) {
      const p = geometry.getAttribute('position'),
        n = geometry.getAttribute('normal')
      for (let i = 0; i < p.count; i++) {
        const v = new Vector3().fromBufferAttribute(p, i),
          normal = new Vector3().fromBufferAttribute(n, i)
        expect(v.length()).toBeLessThanOrEqual(1.5)
        expect(normal.length()).toBeCloseTo(1)
        expect(v.dot(normal)).toBeGreaterThan(0)
      }
      geometry.dispose()
    }
  })
  it('releases collision registration and meshes with the layer', () => {
    const host = new Object3D(),
      actor = {},
      parent = new ShaderMaterial()
    const field = new TerrainHeightField(
      { width: 8, height: 4, minMeters: 0, maxMeters: 0, data: new Uint16Array(32) },
      3390
    )
    const layer = new TerrainBoulders(host, actor, field, parent, 1)
    expect(boulderObstaclesFor(actor)).toBeDefined()
    expect(host.children.length).toBe(1)
    layer.hide()
    expect(boulderObstaclesFor(actor)?.spheres).toHaveLength(0)
    layer.dispose()
    expect(boulderObstaclesFor(actor)).toBeUndefined()
    expect(host.children).toHaveLength(0)
    parent.dispose()
  })
})
