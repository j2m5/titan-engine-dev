import { describe, expect, it } from 'vitest'
import { MeshBasicMaterial } from 'three'
import { patchSlotBytes, TerrainPatchPool } from '@/core/terrain/TerrainPatchPool'
import { allocateJobPatchArrays, applyPatchResult, terrainPatchVertexCount } from '@/core/terrain/terrainPatchGeometry'
import { SyncTerrainPatchBuilder, type PatchBuildJob, type PatchBuildResult } from '@/core/terrain/terrainPatchBuilder'
import { TerrainHeightField } from '@/core/terrain/TerrainHeightField'
import type { HeightMapData } from '@/core/terrain/heightMapFormat'
import { detailWrapFor } from '@/core/terrain/detailWrap'
import { TERRAIN_PATCH_SEGMENTS } from '@/core/terrain/cubeSphere'

const SEGMENTS = 8

function field(): TerrainHeightField {
  const values = Array.from({ length: 16 * 8 }, (_, k) => (k * 4001) % 65535)
  const map: HeightMapData = { width: 16, height: 8, minMeters: -2000, maxMeters: 9000, data: new Uint16Array(values) }
  return new TerrainHeightField(map, 1736)
}

function job(morph: boolean | null): PatchBuildJob {
  return { field: field(), face: 2, i: 1, j: 0, level: 3, segments: SEGMENTS, skirtDepthUnits: 0.001, wrap: detailWrapFor(undefined), morph }
}

function build(morph: boolean | null): PatchBuildResult {
  let out: PatchBuildResult | null = null
  new SyncTerrainPatchBuilder().request(job(morph), (r) => (out = r), (e) => { throw e })
  return out!
}

describe('раскладка слота пула', () => {
  it('вес слота: рельеф 268 900 Б, вода 53 796 Б при 64 сегментах', () => {
    expect(terrainPatchVertexCount(TERRAIN_PATCH_SEGMENTS)).toBe(4481)
    expect(patchSlotBytes(TERRAIN_PATCH_SEGMENTS, 'terrain')).toBe(268900)
    expect(patchSlotBytes(TERRAIN_PATCH_SEGMENTS, 'water')).toBe(53796)
  })

  it('слот воды: position, patchCenter, detailOrigin — и ничего больше', () => {
    const pool = new TerrainPatchPool(new MeshBasicMaterial(), SEGMENTS, 'water')
    const names = Object.keys(pool.acquire()!.geometry.attributes).sort()
    expect(names).toEqual(['detailOrigin', 'patchCenter', 'position'])
  })

  it('bytesPerSlot пула = сумма count·itemSize·4 его атрибутов, для обеих раскладок', () => {
    for (const layout of ['terrain', 'water'] as const) {
      const pool = new TerrainPatchPool(new MeshBasicMaterial(), SEGMENTS, layout)
      const geometry = pool.acquire()!.geometry
      let bytes = 0
      for (const name of Object.keys(geometry.attributes)) {
        const a = geometry.getAttribute(name)
        bytes += a.count * a.itemSize * Float32Array.BYTES_PER_ELEMENT
      }
      expect(pool.bytesPerSlot).toBe(bytes)
      expect(pool.bytesPerSlot).toBe(patchSlotBytes(SEGMENTS, layout))
    }
  })

  it('задание воды (morph null) — только positions, полосы и морфа нет', () => {
    const arrays = allocateJobPatchArrays(SEGMENTS, null)
    expect(arrays.heights).toBeNull()
    expect(arrays.midTilts).toBeNull()
    expect(arrays.midShades).toBeNull()
    expect(arrays.morph).toBeNull()
    const result = build(null)
    expect(result.arrays.heights).toBeNull()
    expect(result.arrays.positions.length).toBe(terrainPatchVertexCount(SEGMENTS) * 3)
  })

  it('позиции воды и рельефа одного узла совпадают: раскладка не меняет геометрию', () => {
    expect(build(null).arrays.positions).toEqual(build(true).arrays.positions)
  })

  it('результат не той раскладки в слот — громкая ошибка (Review Focus 3)', () => {
    const water = new TerrainPatchPool(new MeshBasicMaterial(), SEGMENTS, 'water').acquire()!
    const terrain = new TerrainPatchPool(new MeshBasicMaterial(), SEGMENTS, 'terrain').acquire()!
    expect(() => applyPatchResult(terrain, build(null))).toThrow(/раскладк/)
    expect(() => applyPatchResult(water, build(true))).toThrow(/раскладк/)
  })
})
