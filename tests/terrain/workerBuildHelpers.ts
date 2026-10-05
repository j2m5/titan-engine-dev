import { expect } from 'vitest'
import { TerrainHeightField } from '@/core/terrain/TerrainHeightField'
import type { HeightMapData } from '@/core/terrain/heightMapFormat'
import { detailWrapFor } from '@/core/terrain/detailWrap'
import {
  allocatePatchArrays,
  buildPatchIndex,
  buildTerrainPatchArrays,
  buildTerrainPatchGeometry,
  type PatchArrays
} from '@/core/terrain/terrainPatchGeometry'
import type { NearTileParams } from '@/core/terrain/nearTileBake'
import { nearTileBasis, type Vec3 } from '@/core/terrain/terrainNearShadowMath'
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

/** w1 ≠ w2, оба не дефолт: перестановка detailOrigin/detailOrigin2 или порча wrap видна в смещениях. */
export const ASYMMETRIC_WRAP = detailWrapFor({ detailScaleMeters: 37, detailScale2Meters: 5 })

export function patchJob(
  field: TerrainHeightField,
  face: number,
  i: number,
  j: number,
  skirtDepthUnits = 0.001,
  morph: boolean | null = true
): PatchBuildJob {
  return { field, face, i, j, level: 1, segments: 8, skirtDepthUnits, wrap: ASYMMETRIC_WRAP, morph }
}

export function buildMessageFor(job: PatchBuildJob, requestId: number, fieldId: number): ToWorkerMessage {
  const { face, i, j, level, segments, skirtDepthUnits, wrap, morph } = job
  return { type: 'build', requestId, fieldId, face, i, j, level, segments, skirtDepthUnits, wrap, morph }
}

export function builtArrays(m: Extract<FromWorkerMessage, { type: 'built' }>): PatchArrays {
  return {
    positions: new Float32Array(m.positions),
    heights: new Float32Array(m.heights),
    midTilts: new Float32Array(m.midTilts),
    midShades: new Float32Array(m.midShades),
    morph:
      m.morph === null
        ? null
        : {
            deltas: new Float32Array(m.morph.deltas),
            midTilts: new Float32Array(m.morph.midTilts),
            midShades: new Float32Array(m.morph.midShades)
          }
  }
}

/** Копия массивов результата: синхронный строитель отдаёт скретч, живущий только на время onDone. */
export function snapshotArrays(a: PatchArrays): PatchArrays {
  return {
    positions: a.positions.slice(),
    heights: a.heights.slice(),
    midTilts: a.midTilts.slice(),
    midShades: a.midShades.slice(),
    morph:
      a.morph === null
        ? null
        : { deltas: a.morph.deltas.slice(), midTilts: a.morph.midTilts.slice(), midShades: a.morph.midShades.slice() }
  }
}

/** Все четыре массива (и морф-тройка, если есть) бит-в-бит с fresh-постройкой того же задания на главном поле. */
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
  expect(arrays.heights).toEqual(geometry.getAttribute('height').array)
  expect(arrays.midTilts).toEqual(geometry.getAttribute('midTilt').array)
  expect(arrays.midShades).toEqual(geometry.getAttribute('midShade').array)

  // морф-массивы — тот же ядровый вызов с тем же флагом, бит-в-бит
  const ref = allocatePatchArrays(job.segments, job.morph !== null)
  buildTerrainPatchArrays(job.field, job.face, job.i, job.j, job.level, job.segments, job.skirtDepthUnits, job.wrap, ref, job.morph === true)
  if (ref.morph === null) {
    expect(arrays.morph).toBeNull()
  } else {
    expect(arrays.morph).not.toBeNull()
    expect(arrays.morph!.deltas).toEqual(ref.morph.deltas)
    expect(arrays.morph!.midTilts).toEqual(ref.morph.midTilts)
    expect(arrays.morph!.midShades).toEqual(ref.morph.midShades)
  }
}

/** Смещения домена детали прихода совпадают с инстансными атрибутами fresh-постройки того же задания. */
export function expectOriginsMatchFresh(
  result: { detailOrigin: [number, number, number]; detailOrigin2: [number, number, number] },
  job: PatchBuildJob
): void {
  const { geometry } = buildTerrainPatchGeometry(
    job.field, job.face, job.i, job.j, job.level, job.segments, buildPatchIndex(job.segments), job.skirtDepthUnits, job.wrap
  )
  expect(result.detailOrigin.map(Math.fround)).toEqual(Array.from(geometry.getAttribute('detailOrigin').array))
  expect(result.detailOrigin2.map(Math.fround)).toEqual(Array.from(geometry.getAttribute('detailOrigin2').array))
}

/** Плитка ближней тени вокруг направления center (нормируется). */
export function nearParams(center: Vec3, texels = 8, texelMeters = 5000): NearTileParams {
  const len = Math.hypot(...center)
  const c = center.map((v) => v / len) as Vec3
  const { east, north } = nearTileBasis(c)
  return { center: c, east, north, texels, texelMeters }
}
