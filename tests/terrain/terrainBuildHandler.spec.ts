import { describe, expect, it } from 'vitest'
import { createWorkerState, handleWorkerMessage } from '@/core/terrain/worker/terrainBuildHandler'
import type { FromWorkerMessage } from '@/core/terrain/worker/terrainBuildProtocol'
import { registerFieldMessage } from '@/core/terrain/worker/WorkerTerrainPatchBuilder'
import { buildTerrainPatchGeometry, buildPatchIndex } from '@/core/terrain/terrainPatchGeometry'
import { detailWrapFor } from '@/core/terrain/detailWrap'
import type { TerrainAuxPayload } from '@/core/terrain/terrainAuxFormat'
import { buildMessageFor, builtArrays, expectMatchesFreshBuild, makeField, patchJob } from './workerBuildHelpers'

type BuiltMessage = Extract<FromWorkerMessage, { type: 'built' }>

describe('terrainBuildHandler: чистый обработчик сообщений воркера', () => {
  it('registerField из копии карты + build → все шесть массивов бит-в-бит с постройкой на главном поле', () => {
    const field = makeField()
    const state = createWorkerState()
    const reg = registerFieldMessage(field, 7)
    expect(reg.transfer.length).toBeGreaterThanOrEqual(1) // тело карты переносится
    expect((reg.message as { data: ArrayBuffer }).data).not.toBe(field.heightMap.data.buffer) // копия, не исходный буфер
    const ready = handleWorkerMessage(state, reg.message)
    expect(ready?.message).toEqual({ type: 'fieldReady', fieldId: 7 })

    const job = patchJob(field, 0, 1, 0)
    const built = handleWorkerMessage(state, buildMessageFor(job, 1, 7))
    expect(built?.message.type).toBe('built')
    expect(built?.transfer).toHaveLength(6)
    const m = built!.message as BuiltMessage
    const arrays = builtArrays(m)
    expectMatchesFreshBuild(arrays, job)
    expect(arrays.detailPos).not.toEqual(arrays.detailPos2) // стенд различает слои детали

    const ref = buildTerrainPatchGeometry(field, 0, 1, 0, 1, 8, buildPatchIndex(8), 0.001, job.wrap)
    expect(m.center).toEqual(ref.center.toArray())
    ref.geometry.computeBoundingSphere()
    expect(m.bounds.radius).toBeCloseTo(ref.geometry.boundingSphere!.radius, 9)
  })

  it('компаньон всегда из exportAux: поле без запечённого aux шлёт копии, исходные массивы переживают перенос; воркер не пересчитывает', () => {
    const field = makeField() // без map.aux — payload посчитан главным полем
    expect(field.usedBakedAux).toBe(false)
    const own = field.exportAux()
    const originals = [
      field.heightMap.data.buffer,
      own.levelErrorMeters.buffer,
      own.clearanceGrid.buffer,
      own.nodeMaxHeightMetersPyramid!.buffer,
      own.nodeErrorMetersPyramid!.buffer
    ]
    const byteLengths = originals.map((b) => b.byteLength)

    const reg = registerFieldMessage(field, 3)
    expect((reg.message as { aux: TerrainAuxPayload }).aux).toEqual(own)
    expect(reg.transfer).toHaveLength(5)
    for (const buffer of reg.transfer) expect(originals).not.toContain(buffer)

    const posted = structuredClone(reg.message, { transfer: reg.transfer }) // как postMessage
    expect(reg.transfer.every((b) => b.byteLength === 0)).toBe(true) // отсоединены копии
    expect(originals.map((b) => b.byteLength)).toEqual(byteLengths) // исходники целы

    const state = createWorkerState()
    handleWorkerMessage(state, posted)
    expect(state.fields.get(3)!.usedBakedAux).toBe(true)
    const job = patchJob(field, 2, 1, 1, 0)
    const built = handleWorkerMessage(state, buildMessageFor(job, 2, 3))
    expectMatchesFreshBuild(builtArrays(built!.message as BuiltMessage), job)
  })

  it('build по неизвестному полю — сообщение error, не исключение; releaseField забывает поле', () => {
    const state = createWorkerState()
    const res = handleWorkerMessage(state, {
      type: 'build',
      requestId: 5,
      fieldId: 99,
      face: 0,
      i: 0,
      j: 0,
      level: 1,
      segments: 8,
      skirtDepthUnits: 0,
      wrap: detailWrapFor(undefined)
    })
    expect(res?.message).toMatchObject({ type: 'error', requestId: 5 })
    const field = makeField()
    handleWorkerMessage(state, registerFieldMessage(field, 1).message)
    expect(state.fields.size).toBe(1)
    expect(handleWorkerMessage(state, { type: 'releaseField', fieldId: 1 })).toBeNull()
    expect(state.fields.size).toBe(0)
  })
})
