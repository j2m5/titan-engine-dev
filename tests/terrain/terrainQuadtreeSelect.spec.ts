import { describe, expect, it } from 'vitest'
import { Frustum, Matrix4, PerspectiveCamera, Vector3 } from 'three'
import { toThreeJSUnits } from '@/core/helpers/scaling'
import { TerrainHeightField } from '@/core/terrain/TerrainHeightField'
import type { HeightMapData } from '@/core/terrain/heightMapFormat'
import { selectTerrainNodes, terrainNodeKey, type SelectParams, type TerrainNodeAddress } from '@/core/terrain/terrainQuadtreeSelect'

function makeMap(width: number, height: number, values: number[], minMeters = 0, maxMeters = 65535): HeightMapData {
  return { width, height, minMeters, maxMeters, data: new Uint16Array(values) }
}

const R_KM = 1736

// Чекерборд высот, не константа: геометрическая ошибка TerrainHeightField —
// это варианс высот в окне (p99 размаха), у константной карты (h=0 всюду)
// он тождественно 0 на ВСЕХ уровнях — SSE-порог тогда не пробивается никогда,
// набор листьев не растёт ни при каком приближении камеры. Крупная амплитуда
// (уровни 3-6 линейно уменьшаются форматом блочного затухания карты 8×4 —
// на порядки от исходной) держит sse пробиваемым вплоть до дальних дистанций,
// нужных тесту фрустума (см. ниже).
const HEIGHT_AMPLITUDE_METERS = 20000

function flatField(): TerrainHeightField {
  const values: number[] = []
  for (let row = 0; row < 4; row++) {
    for (let col = 0; col < 8; col++) values.push(((col + row) % 2) * HEIGHT_AMPLITUDE_METERS)
  }

  return new TerrainHeightField(makeMap(8, 4, values, 0, 65535), R_KM)
}

function makeParams(altKm: number, over: Partial<SelectParams> = {}): SelectParams {
  const field = flatField()
  const r = field.surfaceRadiusUnits(new Vector3(1, 0, 0))

  return {
    field,
    cameraLocal: new Vector3(r + toThreeJSUnits(altKm), 0, 0),
    frustumLocal: null,
    screenHeight: 1080,
    fovYRadians: (50 * Math.PI) / 180,
    splitPixels: 6,
    mergeFactor: 0.7,
    currentlySplit: new Set<string>(),
    ...over
  }
}

describe('selectTerrainNodes: SSE-отбор узлов квадродерева', () => {
  it('издалека — минимальный набор уровня 1 (24 листа), покрытие полное', () => {
    const { leaves } = selectTerrainNodes(makeParams(500000))
    expect(leaves).toHaveLength(24)
    expect(new Set(leaves.map(terrainNodeKey)).size).toBe(24)
    expect(leaves.every((a) => a.level === 1)).toBe(true)
  })

  it('приближение увеличивает набор, сумма покрытия сохраняется', () => {
    const far = selectTerrainNodes(makeParams(50000)).leaves
    const near = selectTerrainNodes(makeParams(50)).leaves
    expect(near.length).toBeGreaterThan(far.length)
    // покрытие: сумма 4^{-level} по листьям = 6 корней... уровень ≥1: сумма (1/4)^{level-1} по листьям одной грани = 4? Проверяем инвариант площади:
    const coverage = (ls: TerrainNodeAddress[]): number => ls.reduce((s, a) => s + 4 ** -(a.level - 1), 0)
    expect(coverage(near)).toBeCloseTo(24, 10)
    expect(coverage(far)).toBeCloseTo(24, 10)
  })

  it('потолок глубины 6 держится вплотную к поверхности', () => {
    const { leaves } = selectTerrainNodes(makeParams(0.2))
    expect(Math.max(...leaves.map((a) => a.level))).toBe(6)
  })

  it('гистерезис: между τ_merge и τ_split разбитый узел не схлопывается, неразбитый не делится', () => {
    const base = makeParams(50000)
    const first = selectTerrainNodes(base)
    // подобрать высоту, где часть узлов на грани: сравниваем два прогона с одним и тем же состоянием
    const again = selectTerrainNodes({ ...base, currentlySplit: first.split })
    expect(new Set(again.leaves.map(terrainNodeKey))).toEqual(new Set(first.leaves.map(terrainNodeKey)))
  })

  it('вне фрустума не сплитится', () => {
    // фрустум, смотрящий строго от планеты: все узлы вне → набор минимальный несмотря на близость.
    // Высота 1000 км, не 50: сфера отбора узла уровня 1 — половина диагонали
    // дуги патча (см. selectTerrainNodes) — на грубом уровне 1 огромна (~R/2),
    // при высоте 50 км камера физически ВНУТРИ этой сферы и частично видна
    // при любом развороте; 1000 км выносит камеру за пределы сферы, оставляя
    // геометрию по-прежнему «близкой» для SSE (без фрустума набор кратно больше 24)
    const params = makeParams(1000)
    const frustum = new Frustum()
    const away = new PerspectiveCamera(50, 1, 0.001, 1e9)
    away.position.copy(params.cameraLocal)
    away.lookAt(params.cameraLocal.clone().multiplyScalar(2)) // взгляд от тела
    away.updateMatrixWorld(true)
    frustum.setFromProjectionMatrix(new Matrix4().multiplyMatrices(away.projectionMatrix, away.matrixWorldInverse))
    const { leaves } = selectTerrainNodes({ ...params, frustumLocal: frustum })
    expect(leaves).toHaveLength(24)
  })

  it('камера под поверхностью не роняет отбор (кламп дистанции)', () => {
    const { leaves } = selectTerrainNodes(makeParams(-5))
    expect(leaves.length).toBeGreaterThan(24)
    expect(leaves.every((a) => Number.isFinite(a.level))).toBe(true)
  })
})
