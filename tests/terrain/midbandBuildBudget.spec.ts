import { existsSync, readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { parseHeightMap } from '@/core/terrain/heightMapFormat'
import { TerrainHeightField } from '@/core/terrain/TerrainHeightField'
import { buildPatchIndex, buildTerrainPatchGeometry } from '@/core/terrain/terrainPatchGeometry'
import { detailWrapFor } from '@/core/terrain/detailWrap'

const MOON_HEIGHT_PATH = 'storage/images/textures/planets/moon/moon_height.raw'
const RADIUS_KM = 1737.4

function toArrayBuffer(buffer: Buffer): ArrayBuffer {
  return buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength) as ArrayBuffer
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid]
}

/**
 * Пин бюджета постройки патча (Task 8: `terrain.lod.patchBuildBudgetMs` = 6 мс)
 * на реальной карте Луны (полоса B — 3 гребневых октавы + огибающая, дефолт).
 * Файл вне git — тест пропускается на стендах без storage, честный замер
 * остаётся за CI/машиной владельца, где карта есть.
 */
describe.skipIf(!existsSync(MOON_HEIGHT_PATH))('Бюджет постройки патча с полосой B на карте Луны', () => {
  const map = parseHeightMap(toArrayBuffer(readFileSync(MOON_HEIGHT_PATH)))

  it('buildTerrainPatchGeometry у поверхности укладывается в бюджет 6 мс (медиана из 5, цель 4, запас ×1.5 на CI)', () => {
    const field = new TerrainHeightField(map, RADIUS_KM)
    const index = buildPatchIndex(64)
    const wrap = detailWrapFor(undefined)

    // прогрев — JIT/монотомизация формы вызова не входит в замер
    buildTerrainPatchGeometry(field, 0, 200, 200, 8, 64, index, 0, wrap)

    const samples: number[] = []
    for (let k = 0; k < 5; k++) {
      const start = performance.now()
      buildTerrainPatchGeometry(field, 0, 200, 200, 8, 64, index, 0, wrap)
      samples.push(performance.now() - start)
    }

    const ms = median(samples)
    expect(ms, `медиана постройки патча ${ms.toFixed(3)} мс (образцы: ${samples.map((s) => s.toFixed(3)).join(', ')})`).toBeLessThan(6)
  })

  it('постройка TerrainHeightField Луны (с сеткой огибающей) укладывается в 1500 мс', () => {
    const start = performance.now()
    new TerrainHeightField(map, RADIUS_KM)
    const ms = performance.now() - start

    expect(ms, `постройка поля Луны заняла ${ms.toFixed(1)} мс`).toBeLessThan(1500)
  })
})
