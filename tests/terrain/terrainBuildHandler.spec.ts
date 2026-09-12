import { describe, expect, it } from 'vitest'
import { createWorkerState, handleWorkerMessage } from '@/core/terrain/worker/terrainBuildHandler'
import type { FromWorkerMessage } from '@/core/terrain/worker/terrainBuildProtocol'
import { registerFieldMessage } from '@/core/terrain/worker/WorkerTerrainPatchBuilder'
import { buildTerrainPatchGeometry, buildPatchIndex } from '@/core/terrain/terrainPatchGeometry'
import { TerrainHeightField } from '@/core/terrain/TerrainHeightField'
import { detailWrapFor } from '@/core/terrain/detailWrap'
import type { HeightMapData } from '@/core/terrain/heightMapFormat'
import type { TerrainAuxPayload } from '@/core/terrain/terrainAuxFormat'

// как в TerrainPatchGroupBudget.spec: 64×32, радиус Луны
function makeField(): TerrainHeightField {
  const width = 64
  const height = 32
  const data = new Uint16Array(width * height)
  for (let k = 0; k < data.length; k++) data[k] = (k * 4001) % 65535

  const map: HeightMapData = { width, height, minMeters: 0, maxMeters: 1000, data }
  return new TerrainHeightField(map, 1737.4)
}

describe('terrainBuildHandler: чистый обработчик сообщений воркера', () => {
  it('registerField из копии карты + build → массивы бит-в-бит равны постройке на главном поле; порядок ответов = порядок запросов', () => {
    const field = makeField()
    const state = createWorkerState()
    const reg = registerFieldMessage(field, 7)
    expect(reg.transfer.length).toBeGreaterThanOrEqual(1) // тело карты переносится
    expect((reg.message as { data: ArrayBuffer }).data).not.toBe(field.heightMap.data.buffer) // копия, не исходный буфер
    const ready = handleWorkerMessage(state, reg.message)
    expect(ready?.message).toEqual({ type: 'fieldReady', fieldId: 7 })
    const wrap = detailWrapFor(undefined)
    const built = handleWorkerMessage(state, {
      type: 'build',
      requestId: 1,
      fieldId: 7,
      face: 0,
      i: 1,
      j: 0,
      level: 1,
      segments: 8,
      skirtDepthUnits: 0.001,
      wrap
    })
    expect(built?.message.type).toBe('built')
    expect(built?.transfer).toHaveLength(6)
    const m = built!.message as Extract<FromWorkerMessage, { type: 'built' }>
    const ref = buildTerrainPatchGeometry(field, 0, 1, 0, 1, 8, buildPatchIndex(8), 0.001, wrap)
    expect(new Float32Array(m.positions)).toEqual(ref.geometry.getAttribute('position').array)
    expect(new Float32Array(m.midShades)).toEqual(ref.geometry.getAttribute('midShade').array)
    expect(m.center).toEqual(ref.center.toArray())
    ref.geometry.computeBoundingSphere()
    expect(m.bounds.radius).toBeCloseTo(ref.geometry.boundingSphere!.radius, 9)
  })

  it('компаньон: каждый массив aux скопирован, буферы копий в transfer, исходные не переносятся; постройка совпадает', () => {
    const plain = makeField()
    const aux = plain.exportAux()
    const field = new TerrainHeightField({ ...plain.heightMap, aux }, 1737.4)
    const reg = registerFieldMessage(field, 3)
    const originals = [field.heightMap.data.buffer, aux.levelErrorMeters.buffer, aux.clearanceGrid.buffer, aux.nodeMaxHeightMetersPyramid!.buffer, aux.nodeErrorMetersPyramid!.buffer]
    expect(reg.transfer).toHaveLength(5)
    for (const buffer of reg.transfer) expect(originals).not.toContain(buffer)
    const sent = (reg.message as { aux: TerrainAuxPayload }).aux
    expect(sent.clearanceGrid).toEqual(aux.clearanceGrid)
    expect(sent.nodeErrorMetersPyramid).toEqual(aux.nodeErrorMetersPyramid)

    const state = createWorkerState()
    handleWorkerMessage(state, reg.message)
    expect(state.fields.get(3)!.usedBakedAux).toBe(true)
    const wrap = detailWrapFor(undefined)
    const built = handleWorkerMessage(state, { type: 'build', requestId: 2, fieldId: 3, face: 2, i: 1, j: 1, level: 1, segments: 8, skirtDepthUnits: 0, wrap })
    const m = built!.message as Extract<FromWorkerMessage, { type: 'built' }>
    const ref = buildTerrainPatchGeometry(plain, 2, 1, 1, 1, 8, buildPatchIndex(8), 0, wrap)
    expect(new Float32Array(m.positions)).toEqual(ref.geometry.getAttribute('position').array)
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
