import { BoxGeometry, Matrix4, OrthographicCamera } from 'three'
import { SectorManager, LODThresholds } from '@/core/renderables/DetailedRingStreamingSystem/SectorManager'
import { SectorGrid, SectorGridConfig } from '@/core/renderables/DetailedRingStreamingSystem/SectorGrid'
import { AsteroidGenerator } from '@/core/renderables/DetailedRingStreamingSystem/AsteroidGenerator'
import { InstancePool } from '@/core/renderables/DetailedRingStreamingSystem/InstancePool'

const K = 3

function buildAllVisibleViewProjection(extent: number): Matrix4 {
  const camera = new OrthographicCamera(-extent, extent, extent, -extent, 0.1, extent * 4)
  camera.position.set(0, 0, extent * 2)
  camera.updateMatrixWorld()
  camera.updateProjectionMatrix()
  return camera.projectionMatrix.clone().multiply(camera.matrixWorldInverse)
}

const makeGeometries = (): BoxGeometry[] => Array.from({ length: K }, () => new BoxGeometry(1, 1, 1))

const gridConfig: SectorGridConfig = {
  innerRadius: 0,
  outerRadius: 100,
  cellSize: 100,
  ringId: 777,
  densityPerUnit: 0.006
}

const thresholds: LODThresholds = {
  l0MaxDistance: 5,
  l1MaxDistance: 10,
  nearEnterDistance: -1,
  nearExitDistance: -0.5
}

const identity = new Matrix4()
const vpMatrix = buildAllVisibleViewProjection(1000)

/** Приватное поле `activeSectors` (Map) менеджера — единственный каст на весь файл. */
const fadeOf = (manager: SectorManager, key: string): number =>
  (manager as unknown as { activeSectors: Map<string, { fade: number }> }).activeSectors.get(key)!.fade

const activeKeysOf = (manager: SectorManager): string[] =>
  Array.from((manager as unknown as { activeSectors: Map<string, unknown> }).activeSectors.keys())

function buildManager(fadeSeconds?: number): { manager: SectorManager; grid: SectorGrid } {
  const grid = new SectorGrid(gridConfig)
  const generator = new AsteroidGenerator({ thickness: 1, minScale: 0.5, maxScale: 1.0 })
  const pool = new InstancePool(
    { maxInstances: 300 },
    { maxInstances: 300 },
    { maxInstances: 300 },
    makeGeometries(),
    makeGeometries(),
    2.5
  )
  const manager = new SectorManager(grid, generator, pool, thresholds, null, Infinity, 4, fadeSeconds)
  return { manager, grid }
}

/** Число кадров малой delta до fade === 1 (активация — тоже кадр). */
function framesToFullFade(fadeSeconds: number | undefined, delta: number): number {
  const { manager, grid } = buildManager(fadeSeconds)
  const info0 = grid.getSectorInfo(0, 0, 0)

  manager.update(info0.centerAngle, info0.centerRadius, 0, vpMatrix, identity, delta)
  const key = activeKeysOf(manager)[0]
  let frames = 1

  while (fadeOf(manager, key) < 1) {
    manager.update(info0.centerAngle, info0.centerRadius, 0, vpMatrix, identity, delta)
    frames++
    if (frames > 100000) throw new Error('fade не достиг 1 — тест сломан')
  }

  return frames
}

describe('SectorManager: fadeSeconds — длительность проявления сектора', () => {
  it('fadeSeconds 1.0 требует примерно вчетверо больше кадров до fade=1, чем 0.25', () => {
    const delta = 0.01
    const framesDefault = framesToFullFade(0.25, delta)
    const framesSlow = framesToFullFade(1.0, delta)

    expect(framesSlow / framesDefault).toBeGreaterThan(3.5)
    expect(framesSlow / framesDefault).toBeLessThan(4.5)
  })

  it('без fadeSeconds — дефолт 0.25, поведение как раньше (fadeSpeed эквивалентен 4.0)', () => {
    const delta = 0.01
    const framesImplicit = framesToFullFade(undefined, delta)
    const framesExplicit = framesToFullFade(0.25, delta)

    expect(framesImplicit).toBe(framesExplicit)
  })
})
