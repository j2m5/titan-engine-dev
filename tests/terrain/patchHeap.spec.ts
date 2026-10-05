import { describe, expect, it } from 'vitest'
import { BufferAttribute, DoubleSide, MeshBasicMaterial, Raycaster, Vector3 } from 'three'
import { patchSlotHeapBytes, TerrainPatchPool, type PatchHandle } from '@/core/terrain/TerrainPatchPool'
import { applyPatchResult, terrainPatchVertexCount } from '@/core/terrain/terrainPatchGeometry'
import { SyncTerrainPatchBuilder, type PatchBuildJob, type PatchBuildResult } from '@/core/terrain/terrainPatchBuilder'
import { TerrainHeightField } from '@/core/terrain/TerrainHeightField'
import type { HeightMapData } from '@/core/terrain/heightMapFormat'
import { detailWrapFor } from '@/core/terrain/detailWrap'
import { TERRAIN_PATCH_SEGMENTS } from '@/core/terrain/cubeSphere'

/**
 * Слот держит в куче только position (клик-рейкаст) и инстансные атрибуты:
 * остальные вершинные массивы приходят из результата строителя без копии и
 * отпускаются после заливки (onUploadCallback three r182 зовётся и при
 * createBuffer, и при updateBuffer). Заливку здесь эмулирует прямой вызов
 * onUploadCallback — так её зовёт WebGLAttributes.
 */

const SEGMENTS = 8
const UPLOAD_ONLY = ['height', 'midTilt', 'midShade', 'morphDelta', 'midTiltParent', 'midShadeParent']

function field(): TerrainHeightField {
  const values = Array.from({ length: 16 * 8 }, (_, k) => (k * 4001) % 65535)
  const map: HeightMapData = { width: 16, height: 8, minMeters: -2000, maxMeters: 9000, data: new Uint16Array(values) }
  return new TerrainHeightField(map, 1736)
}

function build(morph: boolean | null = true): PatchBuildResult {
  const job: PatchBuildJob = { field: field(), face: 2, i: 1, j: 0, level: 3, segments: SEGMENTS, skirtDepthUnits: 0.001, wrap: detailWrapFor(undefined), morph }
  let out: PatchBuildResult | null = null
  new SyncTerrainPatchBuilder().request(job, (r) => (out = r), (e) => { throw e })
  return out!
}

function terrainSlot(): { pool: TerrainPatchPool; handle: PatchHandle } {
  const pool = new TerrainPatchPool(new MeshBasicMaterial({ side: DoubleSide }), SEGMENTS, 'terrain')
  return { pool, handle: pool.acquire()! }
}

/** Эмуляция заливки: three зовёт onUploadCallback каждого атрибута после bufferData/bufferSubData. */
function upload(handle: PatchHandle): void {
  for (const name of Object.keys(handle.geometry.attributes)) (handle.geometry.getAttribute(name) as BufferAttribute).onUploadCallback()
}

const attr = (handle: PatchHandle, name: string) => handle.geometry.getAttribute(name) as BufferAttribute

describe('куча слота: массив живёт только до заливки', () => {
  it('приход подставляет массивы результата без копии', () => {
    const { handle } = terrainSlot()
    const result = build()
    applyPatchResult(handle, result)
    expect(attr(handle, 'position').array).toBe(result.arrays.positions)
    expect(attr(handle, 'height').array).toBe(result.arrays.heights)
    expect(attr(handle, 'morphDelta').array).toBe(result.arrays.morph!.deltas)
  })

  it('после заливки вершинные массивы кроме position пусты, count прежний; position хранит данные', () => {
    const { handle } = terrainSlot()
    const result = build()
    applyPatchResult(handle, result)
    upload(handle)
    const n = terrainPatchVertexCount(SEGMENTS)
    for (const name of UPLOAD_ONLY) {
      expect(attr(handle, name).array.length).toBe(0)
      expect(attr(handle, name).count).toBe(n)
    }
    expect(attr(handle, 'position').array).toBe(result.arrays.positions)
    expect(attr(handle, 'patchCenter').array.length).toBe(3)
  })

  it('патч рисуется без фрустум-каллинга до заливки position, после — с ним', () => {
    const { handle } = terrainSlot()
    applyPatchResult(handle, build())
    expect(handle.mesh.frustumCulled).toBe(false)
    upload(handle)
    expect(handle.mesh.frustumCulled).toBe(true)
  })

  it('release до заливки отпускает массивы и не поднимает version (Review Focus 2)', () => {
    const { pool, handle } = terrainSlot()
    applyPatchResult(handle, build())
    const versions = UPLOAD_ONLY.map((name) => attr(handle, name).version)
    pool.release(handle)
    for (const name of UPLOAD_ONLY) expect(attr(handle, name).array.length).toBe(0)
    expect(UPLOAD_ONLY.map((name) => attr(handle, name).version)).toEqual(versions)
  })

  it('переиспользованный слот: приход без морфа заменяет дельты прошлого владельца нулями (Review Focus 5)', () => {
    const { pool, handle } = terrainSlot()
    applyPatchResult(handle, build(true))
    upload(handle)
    pool.release(handle)
    const again = pool.acquire()!
    expect(again).toBe(handle)
    const result = build(true)
    result.arrays.morph = null
    applyPatchResult(again, result)
    const deltas = attr(again, 'morphDelta').array
    expect(deltas.length).toBe(terrainPatchVertexCount(SEGMENTS) * 3)
    expect(Array.from(deltas).every((v) => v === 0)).toBe(true)
    expect(attr(again, 'midTiltParent').array).toEqual(result.arrays.midTilts)
  })

  it('клик-рейкаст по патчу после заливки попадает', () => {
    const { handle } = terrainSlot()
    const result = build()
    applyPatchResult(handle, result)
    upload(handle)
    handle.mesh.updateMatrixWorld(true)
    const center = new Vector3().fromArray(result.center)
    const raycaster = new Raycaster(center.clone().multiplyScalar(1.5), center.clone().normalize().negate())
    expect(raycaster.intersectObject(handle.mesh, false).length).toBeGreaterThan(0)
  })

  it('два результата синхронного строителя не делят буферы', () => {
    const builder = new SyncTerrainPatchBuilder()
    const job: PatchBuildJob = { field: field(), face: 2, i: 1, j: 0, level: 3, segments: SEGMENTS, skirtDepthUnits: 0.001, wrap: detailWrapFor(undefined), morph: true }
    const results: PatchBuildResult[] = []
    builder.request(job, (r) => results.push(r), (e) => { throw e })
    builder.request(job, (r) => results.push(r), (e) => { throw e })
    expect(results[0].arrays.positions).not.toBe(results[1].arrays.positions)
    expect(results[0].arrays.heights).not.toBe(results[1].arrays.heights)
  })

  it('резидентная куча слота: рельеф 53 812 Б, вода 53 796 Б при 64 сегментах; геттер пула и сводка группы', () => {
    expect(patchSlotHeapBytes(TERRAIN_PATCH_SEGMENTS, 'terrain')).toBe(53812)
    expect(patchSlotHeapBytes(TERRAIN_PATCH_SEGMENTS, 'water')).toBe(53796)
    expect(terrainSlot().pool.heapBytesPerSlot).toBe(patchSlotHeapBytes(SEGMENTS, 'terrain'))
  })
})
