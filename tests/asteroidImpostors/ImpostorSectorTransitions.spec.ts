import { BoxGeometry, Matrix4, OrthographicCamera } from 'three'
import { SectorManager } from '@/core/renderables/DetailedRingStreamingSystem/SectorManager'
import { SectorGrid } from '@/core/renderables/DetailedRingStreamingSystem/SectorGrid'
import { AsteroidGenerator } from '@/core/renderables/DetailedRingStreamingSystem/AsteroidGenerator'
import { InstancePool } from '@/core/renderables/DetailedRingStreamingSystem/InstancePool'

function setup() {
  const grid = new SectorGrid({ innerRadius: 497.5, outerRadius: 502.5, cellSize: 5, ringId: 555, densityPerUnit: 1.24 })
  const info = grid.getSectorInfo(0, 0, 0)
  const generator = new AsteroidGenerator({ thickness: 1, minScale: 0.5, maxScale: 1 })
  const pool = new InstancePool({ maxInstances: 300 }, { maxInstances: 300 }, { maxInstances: 300 },
    Array.from({ length: 3 }, () => new BoxGeometry()), Array.from({ length: 3 }, () => new BoxGeometry()), 2.5, undefined, false, false, true)
  const manager = new SectorManager(grid, generator, pool, { l0MaxDistance: 40, l1MaxDistance: 80, nearEnterDistance: 3, nearExitDistance: 8 })
  const camera = new OrthographicCamera(-1, 1, 1, -1, 0.1, 1000)
  camera.position.set(info.centerX, 500, info.centerZ); camera.up.set(0, 0, -1); camera.lookAt(info.centerX, 0, info.centerZ); camera.updateMatrixWorld()
  const vp = camera.projectionMatrix.clone().multiply(camera.matrixWorldInverse)
  const update = (distance: number, delta: number) => {
    manager.update(info.centerAngle, info.centerRadius + distance, 0, vp, new Matrix4(), delta)
    pool.commitUpdates()
  }
  const mixes = () => [...pool.geometryMeshes, ...pool.nearMeshes].flatMap(mesh => {
    const fade = mesh.geometry.getAttribute('instanceFade'), mix = mesh.geometry.getAttribute('instanceDetailMix')
    return Array.from({ length: mesh.count }, (_, i) => i).filter(i => fade.getX(i) !== 0).map(i => mix.getX(i))
  })
  return { pool, generator, info, update, mixes }
}

describe('Детали сектора независимы от fade', () => {
  it.each([0, 20])('новый геометрический сектор на дистанции %s начинает с полными деталями', distance => {
    const { update, mixes } = setup()
    update(distance, 0.01)
    expect(mixes().length).toBeGreaterThan(0)
    expect(mixes().every(value => value === 1)).toBe(true)
  })

  it('идентификаторы L1 не меняют матрицы; mix переживает реверс и переход через три тира', () => {
    const { pool, generator, info, update, mixes } = setup()
    update(50, 1)
    const geometry = pool.billboardMesh.geometry
    expect(Array.from(pool.billboardMesh.instanceMatrix.array).slice(0, info.instanceCount * 16))
      .toEqual(Array.from(generator.generateMatrices(info.seed, info.instanceCount, info.bounds)))
    expect(Array.from(geometry.getAttribute('instanceArchetype').array).slice(0, info.instanceCount))
      .toEqual(Array.from(generator.archetypeAssignment(info.seed, info.instanceCount, 3)))
    expect(geometry.getAttribute('instanceDetailEnd').getX(0)).toBeCloseTo(40 - info.boundingRadius)
    update(20, 0.05)
    expect(mixes().every(value => Math.abs(value - 0.2) < 1e-6)).toBe(true)
    update(50, 0.01)
    expect(mixes().every(value => Math.abs(value - 0.16) < 1e-6)).toBe(true)
    update(0, 0.01)
    expect(mixes().every(value => Math.abs(value - 0.2) < 1e-6)).toBe(true)
    update(20, 0.01)
    expect(mixes().every(value => Math.abs(value - 0.24) < 1e-6)).toBe(true)
    update(20, 1)
    expect(mixes().every(value => value === 1)).toBe(true)
  })
})
