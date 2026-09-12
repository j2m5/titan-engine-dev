import { expect } from 'vitest'
import { TerrainHeightField } from '@/core/terrain/TerrainHeightField'
import type { HeightMapData } from '@/core/terrain/heightMapFormat'
import { detailWrapFor } from '@/core/terrain/detailWrap'
import { buildPatchIndex, buildTerrainPatchGeometry, type PatchArrays } from '@/core/terrain/terrainPatchGeometry'
import type { PatchBuildJob } from '@/core/terrain/terrainPatchBuilder'
import type { FromWorkerMessage, ToWorkerMessage } from '@/core/terrain/worker/terrainBuildProtocol'

/** 64×32, радиус Луны — как в TerrainPatchGroupBudget.spec. */
export function makeField(): TerrainHeightField {
  const width = 64
  const height = 32
  const data = new Uint16Array(width * height)
  for (let k = 0; k < data.length; k++) data[k] = (k * 4001) % 65535

  const map: HeightMapData = { width, height, minMeters: 0, maxMeters: 1000, data }
  return new TerrainHeightField(map, 1737.4)
}

/** w1 ≠ w2, оба не дефолт: перестановка detailPos/detailPos2 или порча wrap видна в массивах. */
export const ASYMMETRIC_WRAP = detailWrapFor({ detailScaleMeters: 37, detailScale2Meters: 5 })

export function patchJob(field: TerrainHeightField, face: number, i: number, j: number, skirtDepthUnits = 0.001): PatchBuildJob {
  return { field, face, i, j, level: 1, segments: 8, skirtDepthUnits, wrap: ASYMMETRIC_WRAP }
}

export function buildMessageFor(job: PatchBuildJob, requestId: number, fieldId: number): ToWorkerMessage {
  const { face, i, j, level, segments, skirtDepthUnits, wrap } = job
  return { type: 'build', requestId, fieldId, face, i, j, level, segments, skirtDepthUnits, wrap }
}

export function builtArrays(m: Extract<FromWorkerMessage, { type: 'built' }>): PatchArrays {
  return {
    positions: new Float32Array(m.positions),
    detailPos: new Float32Array(m.detailPos),
    detailPos2: new Float32Array(m.detailPos2),
    heights: new Float32Array(m.heights),
    midTilts: new Float32Array(m.midTilts),
    midShades: new Float32Array(m.midShades)
  }
}

/** Копия массивов результата: синхронный строитель отдаёт скретч, живущий только на время onDone. */
export function snapshotArrays(a: PatchArrays): PatchArrays {
  return {
    positions: a.positions.slice(),
    detailPos: a.detailPos.slice(),
    detailPos2: a.detailPos2.slice(),
    heights: a.heights.slice(),
    midTilts: a.midTilts.slice(),
    midShades: a.midShades.slice()
  }
}

/** Все шесть массивов бит-в-бит с fresh-постройкой того же задания на главном поле. */
export function expectMatchesFreshBuild(arrays: PatchArrays, job: PatchBuildJob): void {
  const { geometry } = buildTerrainPatchGeometry(
    job.field,
    job.face,
    job.i,
    job.j,
    job.level,
    job.segments,
    buildPatchIndex(job.segments),
    job.skirtDepthUnits,
    job.wrap
  )
  expect(arrays.positions).toEqual(geometry.getAttribute('position').array)
  expect(arrays.detailPos).toEqual(geometry.getAttribute('detailPos').array)
  expect(arrays.detailPos2).toEqual(geometry.getAttribute('detailPos2').array)
  expect(arrays.heights).toEqual(geometry.getAttribute('height').array)
  expect(arrays.midTilts).toEqual(geometry.getAttribute('midTilt').array)
  expect(arrays.midShades).toEqual(geometry.getAttribute('midShade').array)
}
