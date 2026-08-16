import { Buffer } from 'node:buffer'
import { describe, expect, it } from 'vitest'
import { readRawInt16Dem, resampleDemGrid } from '../../scripts/lib/rawDem'

function int16Buffer(values: number[]): Buffer {
  const buffer = Buffer.alloc(values.length * 2)

  values.forEach((value, i) => buffer.writeInt16LE(value, i * 2))

  return buffer
}

describe('readRawInt16Dem: чтение PDS IMG (сырой int16 LE)', () => {
  it('применяет масштаб и сохраняет отрицательные высоты', () => {
    // LDEM: значения в единицах 0.5 м — впадина −18274 (−9137 м) должна выжить
    const data = readRawInt16Dem(int16Buffer([-18274, 0, 21554, 100]), 2, 2, 0.5)

    expect(data[0]).toBeCloseTo(-9137, 5)
    expect(data[1]).toBe(0)
    expect(data[2]).toBeCloseTo(10777, 5)
    expect(data[3]).toBeCloseTo(50, 5)
  })

  it('несовпадение размера файла с width×height×2 — ошибка с внятным сообщением', () => {
    expect(() => readRawInt16Dem(int16Buffer([1, 2, 3]), 2, 2, 1)).toThrow(/размер/i)
  })

  it('bigEndian=true читает MSB_INTEGER (MOLA PDS) вместо LSB', () => {
    const buffer = Buffer.alloc(4)

    buffer.writeInt16BE(-8206, 0) // Эллада
    buffer.writeInt16BE(21181, 2) // Олимп

    const data = readRawInt16Dem(buffer, 2, 1, 1, true)

    expect(data[0]).toBe(-8206)
    expect(data[1]).toBe(21181)
  })
})

describe('resampleDemGrid: area-average даунсемпл', () => {
  it('2×2 → 1×1 даёт среднее четырёх пикселей', () => {
    const out = resampleDemGrid(new Float32Array([0, 100, 200, 300]), 2, 2, 1, 1)

    expect(out.length).toBe(1)
    expect(out[0]).toBeCloseTo(150, 5)
  })

  it('4×2 → 2×1 усредняет свои квадранты независимо', () => {
    const out = resampleDemGrid(new Float32Array([0, 100, 1000, 2000, 0, 100, 1000, 2000]), 4, 2, 2, 1)

    expect(out.length).toBe(2)
    expect(out[0]).toBeCloseTo(50, 5)
    expect(out[1]).toBeCloseTo(1500, 5)
  })

  it('совпадающие размеры возвращают те же значения', () => {
    const source = new Float32Array([1, 2, 3, 4, 5, 6])

    const out = resampleDemGrid(source, 3, 2, 3, 2)

    expect(Array.from(out)).toEqual([1, 2, 3, 4, 5, 6])
  })

  it('порядок высот сохраняется при некратном даунсемпле', () => {
    // монотонный градиент слева направо не должен перемешаться
    const source = new Float32Array(10 * 2)
    for (let y = 0; y < 2; y++) for (let x = 0; x < 10; x++) source[y * 10 + x] = x * 10

    const out = resampleDemGrid(source, 10, 2, 3, 1)

    expect(out[0]).toBeLessThan(out[1])
    expect(out[1]).toBeLessThan(out[2])
  })
})
