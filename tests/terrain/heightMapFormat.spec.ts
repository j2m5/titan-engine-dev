import { describe, expect, it } from 'vitest'
import { HEIGHT_MAP_HEADER_BYTES, parseHeightMap } from '@/core/terrain/heightMapFormat'
import { encodeHeightMap, normalizeToUint16 } from '../../scripts/lib/heightMapEncode'

function toArrayBuffer(buffer: Buffer): ArrayBuffer {
  return buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength) as ArrayBuffer
}

describe('Формат карты высот: round-trip энкодер ↔ парсер', () => {
  it('encode → parse возвращает исходные метаданные и данные', () => {
    const data = new Uint16Array([0, 1000, 30000, 65535, 42, 7, 8, 9])
    const encoded = encodeHeightMap({ width: 4, height: 2, minMeters: -9150, maxMeters: 10777, data })

    const parsed = parseHeightMap(toArrayBuffer(encoded))

    expect(parsed.width).toBe(4)
    expect(parsed.height).toBe(2)
    expect(parsed.minMeters).toBeCloseTo(-9150, 2)
    expect(parsed.maxMeters).toBeCloseTo(10777, 2)
    expect(Array.from(parsed.data)).toEqual(Array.from(data))
  })

  it('нормировка: min → 0, max → 65535, середина линейна, выбросы клампятся', () => {
    const out = normalizeToUint16(new Float32Array([-100, 0, 100, -500, 500]), -100, 100)

    expect(out[0]).toBe(0)
    expect(out[1]).toBe(32768)
    expect(out[2]).toBe(65535)
    expect(out[3]).toBe(0)
    expect(out[4]).toBe(65535)
  })

  it('нулевой или отрицательный диапазон высот — ошибка, а не деление на ноль', () => {
    expect(() => normalizeToUint16(new Float32Array([1]), 5, 5)).toThrow()
  })

  it('битый magic — ошибка с внятным сообщением', () => {
    const encoded = encodeHeightMap({ width: 1, height: 1, minMeters: 0, maxMeters: 1, data: new Uint16Array([1]) })
    encoded.writeUInt32LE(0xdeadbeef, 0)

    expect(() => parseHeightMap(toArrayBuffer(encoded))).toThrow(/magic/i)
  })

  it('несовпадение длины тела с width×height — ошибка', () => {
    const encoded = encodeHeightMap({ width: 2, height: 2, minMeters: 0, maxMeters: 1, data: new Uint16Array(4) })

    expect(() => parseHeightMap(toArrayBuffer(encoded).slice(0, HEIGHT_MAP_HEADER_BYTES + 2))).toThrow(/размер/i)
  })

  it('обрезанный заголовок — ошибка', () => {
    expect(() => parseHeightMap(new ArrayBuffer(10))).toThrow()
  })
})
