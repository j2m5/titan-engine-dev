import { describe, it, expect } from 'vitest'
import { BoxGeometry, Matrix4, OrthographicCamera } from 'three'
import { BillboardAsteroidMaterial } from '@/core/renderables/DetailedRingStreamingSystem/BillboardAsteroidMaterial'
import { InstancePool } from '@/core/renderables/DetailedRingStreamingSystem/InstancePool'
import { SectorGrid, SectorGridConfig } from '@/core/renderables/DetailedRingStreamingSystem/SectorGrid'
import { AsteroidGenerator } from '@/core/renderables/DetailedRingStreamingSystem/AsteroidGenerator'
import { SectorManager, LODThresholds } from '@/core/renderables/DetailedRingStreamingSystem/SectorManager'
import { billboardVertexSource } from '../helpers/billboardSource'
import { withoutComments, withoutDefine } from '../helpers/glsl'

describe('BillboardAsteroidMaterial: дефайн USE_CASCADE_FADE_RADIUS', () => {
  it('без useCascadeFade дефайн не выставлен (путь колец)', () => {
    expect(new BillboardAsteroidMaterial().defines).not.toHaveProperty('USE_CASCADE_FADE_RADIUS')
  })

  it('с useCascadeFade дефайн выставлен', () => {
    expect(new BillboardAsteroidMaterial(undefined, true).defines).toHaveProperty('USE_CASCADE_FADE_RADIUS', '1')
  })

  it('instanceMaxDistance объявлен и читается ТОЛЬКО под дефайном', () => {
    const source = withoutComments(billboardVertexSource())
    expect(source).toContain('#ifdef USE_CASCADE_FADE_RADIUS')
    expect(withoutDefine(source, 'USE_CASCADE_FADE_RADIUS')).not.toContain('instanceMaxDistance')
  })

  it('без дефайна формула fade — побайтно прежняя строка колец', () => {
    const source = withoutComments(billboardVertexSource())
    const stripped = withoutDefine(source, 'USE_CASCADE_FADE_RADIUS')

    // Прежняя (до каскадного fade) строка — единственная формула вне дефайна
    expect(stripped).toContain('vDistanceFade = 1.0 - smoothstep(uMaxDistance * 0.6, uMaxDistance, dist);')
  })
})

/** Единственный всегда-активный сектор (та же ширина, что у SectorManager.spec-соседей) — офсеты в общем буфере предсказуемы */
const gridConfig: SectorGridConfig = {
  innerRadius: 0,
  outerRadius: 100,
  cellSize: 100,
  ringId: 1,
  densityPerUnit: 0.006
}

/** Камера в центре её единственного сектора и l0MaxDistance < 0 — сектор форсированно в Billboard-тире */
const billboardThresholds = (l1MaxDistance: number): LODThresholds => ({
  l0MaxDistance: -1,
  l1MaxDistance,
  nearEnterDistance: -10,
  nearExitDistance: -5
})

function wideViewProjection(extent: number): Matrix4 {
  const camera = new OrthographicCamera(-extent, extent, extent, -extent, 0.1, extent * 4)
  camera.position.set(0, 0, extent * 2)
  camera.updateMatrixWorld()
  camera.updateProjectionMatrix()
  return camera.projectionMatrix.clone().multiply(camera.matrixWorldInverse)
}

describe('SectorManager + InstancePool: fade-радиус — свой у каждого каскада', () => {
  it('два каскада в одном пуле пишут в instanceMaxDistance РАЗНЫЕ пороги billboard', () => {
    const K = 3
    const geoms = (): BoxGeometry[] => Array.from({ length: K }, () => new BoxGeometry(1, 1, 1))
    // useCascadeFade: true — только он включает дефайн и делает instanceMaxDistance значимым
    const pool = new InstancePool(
      { maxInstances: 300 },
      { maxInstances: 300 },
      { maxInstances: 300 },
      geoms(),
      geoms(),
      2.5,
      undefined,
      true
    )

    const gridA = new SectorGrid(gridConfig)
    const gridB = new SectorGrid(gridConfig)
    const generatorA = new AsteroidGenerator({ thickness: 1, minScale: 0.5, maxScale: 1.0 })
    const generatorB = new AsteroidGenerator({ thickness: 1, minScale: 0.5, maxScale: 1.0 })

    const l1A = 20
    const l1B = 500
    const managerA = new SectorManager(gridA, generatorA, pool, billboardThresholds(l1A), null, Infinity, 4)
    const managerB = new SectorManager(gridB, generatorB, pool, billboardThresholds(l1B), null, Infinity, 4)

    const info0 = gridA.getSectorInfo(0, 0, 0)
    const vp = wideViewProjection(1000)
    const identity = new Matrix4()

    // Камера точно на центре единственного сектора: dist = 0, l0MaxDistance
    // отрицателен — обе аллокации гарантированно уходят в Billboard-стрим.
    managerA.update(info0.centerAngle, info0.centerRadius, 0, vp, identity, 1.0)
    managerB.update(info0.centerAngle, info0.centerRadius, 0, vp, identity, 1.0)
    // mesh.count синхронизируется только тут (см. InstancePool.commitUpdates) —
    // без коммита он остался бы 0, хотя аллокации уже прошли
    pool.commitUpdates()

    expect(managerA.usedInstances).toBeGreaterThan(0)
    expect(managerB.usedInstances).toBeGreaterThan(0)

    const attr = pool.billboardMesh.geometry.getAttribute('instanceMaxDistance').array as Float32Array
    const live = Array.from(attr.slice(0, pool.billboardMesh.count))
    const values = new Set(live)

    // Пин: аллокации двух разных каскадов несут РАЗНЫЕ пороги — не общий uMaxDistance
    expect(values.has(l1A)).toBe(true)
    expect(values.has(l1B)).toBe(true)
    expect(values.size).toBeGreaterThanOrEqual(2)
  })

  it('без каскадов (единственный менеджер) instanceMaxDistance всё равно пишется, но дефайн его не читает', () => {
    // Пул без useCascadeFade — путь колец/одиночного каскада: дефайн отсутствует,
    // но атрибут по-прежнему существует на каждом стриме (пишет writeSectorOrigins) —
    // не влияет на вид, шейдер его просто не объявляет без USE_CASCADE_FADE_RADIUS.
    const K = 3
    const geoms = (): BoxGeometry[] => Array.from({ length: K }, () => new BoxGeometry(1, 1, 1))
    const pool = new InstancePool({ maxInstances: 300 }, { maxInstances: 300 }, { maxInstances: 300 }, geoms(), geoms(), 2.5)

    expect(pool.billboardMaterial.defines).not.toHaveProperty('USE_CASCADE_FADE_RADIUS')

    const grid = new SectorGrid(gridConfig)
    const generator = new AsteroidGenerator({ thickness: 1, minScale: 0.5, maxScale: 1.0 })
    const manager = new SectorManager(grid, generator, pool, billboardThresholds(42), null, Infinity, 4)
    const info0 = grid.getSectorInfo(0, 0, 0)

    manager.update(info0.centerAngle, info0.centerRadius, 0, wideViewProjection(1000), new Matrix4(), 1.0)
    pool.commitUpdates()

    const attr = pool.billboardMesh.geometry.getAttribute('instanceMaxDistance').array as Float32Array
    expect(Array.from(attr.slice(0, pool.billboardMesh.count))).toEqual(
      new Array(pool.billboardMesh.count).fill(42)
    )
  })
})
