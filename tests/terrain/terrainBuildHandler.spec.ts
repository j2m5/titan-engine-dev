import { describe, expect, it } from 'vitest'
import { createWorkerState, handleWorkerMessage } from '@/core/terrain/worker/terrainBuildHandler'
import type { FromWorkerMessage } from '@/core/terrain/worker/terrainBuildProtocol'
import { registerFieldMessage } from '@/core/terrain/worker/WorkerTerrainPatchBuilder'
import { buildTerrainPatchGeometry, buildPatchIndex } from '@/core/terrain/terrainPatchGeometry'
import { detailWrapFor } from '@/core/terrain/detailWrap'
import type { TerrainAuxPayload } from '@/core/terrain/terrainAuxFormat'
import { buildShadowHeightBits } from '@/core/terrain/terrainShadowBits'
import { buildNearTileHeights } from '@/core/terrain/nearTileBake'
import {
  buildMessageFor,
  builtArrays,
  expectMatchesFreshBuild,
  expectOriginsMatchFresh,
  makeField,
  nearParams,
  patchJob
} from './workerBuildHelpers'

type BuiltMessage = Extract<FromWorkerMessage, { type: 'built' }>

describe('terrainBuildHandler: чистый обработчик сообщений воркера', () => {
  it('registerField из копии карты + build → все массивы (с морф-тройкой) бит-в-бит с постройкой на главном поле', () => {
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
    expect(built?.transfer).toHaveLength(7)
    const m = built!.message as BuiltMessage
    const arrays = builtArrays(m)
    expectMatchesFreshBuild(arrays, job)
    expectOriginsMatchFresh(m, job)
    expect(m.detailOrigin).not.toEqual(m.detailOrigin2) // стенд различает слои детали

    const ref = buildTerrainPatchGeometry(field, 0, 1, 0, 1, 8, buildPatchIndex(8), 0.001, job.wrap, true)
    expect(m.center).toEqual(ref.center.toArray())
    // сфера fresh-сборки уже выставлена applyPatchBounds (с учётом родительской формы)
    expect(m.bounds.radius).toBeCloseTo(ref.geometry.boundingSphere!.radius, 9)
  })

  it('build с morph: true несёт три морф-буфера в transfer (7), с null (вода) — null и 1 буфер, без полосы; false — нулевые дельты', () => {
    const field = makeField()
    const state = createWorkerState()
    handleWorkerMessage(state, registerFieldMessage(field, 7).message)

    // глубже корня: родительская форма отличается от своей
    const deep = { ...patchJob(field, 0, 1, 0, 0.001, true), level: 4 }
    const withMorph = handleWorkerMessage(state, buildMessageFor(deep, 1, 7))
    expect(withMorph?.transfer).toHaveLength(7)
    const m = withMorph!.message as BuiltMessage
    expect(m.morph).not.toBeNull()
    for (const buffer of [m.morph!.deltas, m.morph!.midTilts, m.morph!.midShades]) expect(withMorph!.transfer).toContain(buffer)
    const arrays = builtArrays(m)
    expectMatchesFreshBuild(arrays, deep)
    expect(arrays.morph!.deltas.some((v) => v !== 0)).toBe(true)

    // задание воды: по сети идут только positions, полоса и морф — null
    const waterJob = { ...deep, morph: null }
    const none = handleWorkerMessage(state, buildMessageFor(waterJob, 2, 7))
    expect(none?.transfer).toHaveLength(1)
    const noneMessage = none!.message as BuiltMessage
    expect(none!.transfer[0]).toBe(noneMessage.positions)
    expect(noneMessage.morph).toBeNull()
    expect(noneMessage.heights).toBeNull()
    expect(noneMessage.midTilts).toBeNull()
    expect(noneMessage.midShades).toBeNull()
    expectMatchesFreshBuild(builtArrays(noneMessage), waterJob)

    const off = { ...deep, morph: false }
    const flat = handleWorkerMessage(state, buildMessageFor(off, 3, 7))
    expect(flat?.transfer).toHaveLength(7)
    const flatArrays = builtArrays(flat!.message as BuiltMessage)
    expectMatchesFreshBuild(flatArrays, off)
    expect(flatArrays.morph!.deltas.every((v) => v === 0)).toBe(true)
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

  it('buildShadow по зарегистрированному полю — биты низкой карты из копии, буфер уходит переносом', () => {
    const field = makeField()
    const state = createWorkerState()
    handleWorkerMessage(state, registerFieldMessage(field, 4).message)
    const res = handleWorkerMessage(state, { type: 'buildShadow', requestId: 9, fieldId: 4 })
    const message = res!.message as Extract<FromWorkerMessage, { type: 'shadowBuilt' }>
    const expected = buildShadowHeightBits(field.heightMap)
    expect(message).toMatchObject({ type: 'shadowBuilt', requestId: 9, width: expected.width, height: expected.height })
    expect(Array.from(new Uint16Array(message.bits))).toEqual(Array.from(expected.bits))
    expect(res!.transfer).toEqual([message.bits])
    expect(handleWorkerMessage(state, { type: 'buildShadow', requestId: 10, fieldId: 99 })?.message).toMatchObject({
      type: 'error',
      requestId: 10
    })
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
      wrap: detailWrapFor(undefined),
      morph: null
    })
    expect(res?.message).toMatchObject({ type: 'error', requestId: 5 })
    const field = makeField()
    handleWorkerMessage(state, registerFieldMessage(field, 1).message)
    expect(state.fields.size).toBe(1)
    expect(handleWorkerMessage(state, { type: 'releaseField', fieldId: 1 })).toBeNull()
    expect(state.fields.size).toBe(0)
  })
})

describe('terrainBuildHandler: плитка ближней тени', () => {
  it('buildNearTile — те же числа, что у прямого бейка; буфер уходит переносом; неизвестное поле — error', () => {
    const field = makeField()
    const state = createWorkerState()
    handleWorkerMessage(state, registerFieldMessage(field, 4).message)
    const params = nearParams([0.3, 0.5, 0.8])
    const res = handleWorkerMessage(state, { type: 'buildNearTile', requestId: 9, fieldId: 4, params })
    const message = res!.message as Extract<FromWorkerMessage, { type: 'nearTileBuilt' }>

    expect(message.type).toBe('nearTileBuilt')
    expect(message.requestId).toBe(9)
    expect(Array.from(new Float32Array(message.heights))).toEqual(Array.from(buildNearTileHeights(field, params)))
    expect(res!.transfer).toEqual([message.heights])
    expect(handleWorkerMessage(state, { type: 'buildNearTile', requestId: 10, fieldId: 99, params })?.message).toMatchObject({
      type: 'error',
      requestId: 10
    })
  })
})
