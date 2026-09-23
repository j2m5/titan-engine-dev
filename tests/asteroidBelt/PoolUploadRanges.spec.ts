import { describe, it, expect } from 'vitest'
import { BoxGeometry, Vector3, type InstancedBufferAttribute, type InstancedMesh } from 'three'
import { InstancePool } from '@/core/renderables/DetailedRingStreamingSystem/InstancePool'

const K = 3
const makePool = (): InstancePool =>
  new InstancePool(
    { maxInstances: 400 },
    { maxInstances: 300 },
    { maxInstances: 800 },
    Array.from({ length: K }, () => new BoxGeometry(1, 1, 1)),
    Array.from({ length: K }, () => new BoxGeometry(1, 1, 1)),
    2.5
  )

type Range = { start: number; count: number }
const attr = (pool: InstancePool, stream: number, name: string): InstancedBufferAttribute =>
  (pool.getRenderObjects()[stream] as InstancedMesh).geometry.getAttribute(name) as InstancedBufferAttribute
const matrixAttr = (pool: InstancePool, stream: number): InstancedBufferAttribute =>
  (pool.getRenderObjects()[stream] as InstancedMesh).instanceMatrix
const ranges = (a: InstancedBufferAttribute): Range[] => a.updateRanges

/** Объединение диапазонов покрывает ровно [start, end) в элементах массива */
const covers = (rs: Range[], start: number, end: number): boolean => {
  const sorted = [...rs].sort((a, b) => a.start - b.start)
  let cursor = start
  for (const r of sorted) {
    if (r.start > cursor) return false
    cursor = Math.max(cursor, r.start + r.count)
  }
  return cursor >= end && sorted.every((r) => r.start >= start && r.start + r.count <= end)
}

describe('InstancePool: заливка на GPU только тронутыми диапазонами', () => {
  it('запись матриц регистрирует диапазон по слотам, а не весь буфер', () => {
    const pool = makePool()
    const stream = pool.billboardStream
    const a = pool.allocate(stream, 5)!
    pool.writeMatrices(stream, a.offset, new Float32Array(5 * 16).fill(1))
    pool.commitUpdates()

    const rs = ranges(matrixAttr(pool, stream))
    expect(rs.length).toBeGreaterThan(0)
    expect(covers(rs, a.offset * 16, (a.offset + 5) * 16)).toBe(true)
    // Не весь буфер: 800 инстансов × 16 чисел
    const total = rs.reduce((n, r) => n + r.count, 0)
    expect(total).toBeLessThan(800 * 16)
  })

  it('fade, смещение и порог регистрируют диапазоны своих атрибутов', () => {
    const pool = makePool()
    const stream = pool.billboardStream
    const a = pool.allocate(stream, 7)!
    pool.writeFade(stream, a.offset, 7, 0.5)
    pool.writeOrigins(stream, a.offset, 7, new Vector3(1, 2, 3))
    pool.writeMaxDistance(stream, a.offset, 7, 42)
    pool.commitUpdates()

    expect(covers(ranges(attr(pool, stream, 'instanceFade')), a.offset, a.offset + 7)).toBe(true)
    expect(covers(ranges(attr(pool, stream, 'instanceOrigin')), a.offset * 3, (a.offset + 7) * 3)).toBe(true)
    expect(covers(ranges(attr(pool, stream, 'instanceMaxDistance')), a.offset, a.offset + 7)).toBe(true)
  })

  it('освобождение обнуляет слоты и регистрирует их под заливку', () => {
    const pool = makePool()
    const stream = 0
    const a = pool.allocate(stream, 4)!
    pool.writeMatrices(stream, a.offset, new Float32Array(4 * 16).fill(1))
    pool.writeFade(stream, a.offset, 4, 1)
    pool.commitUpdates()
    // Имитация рендера: залил и очистил диапазоны
    matrixAttr(pool, stream).clearUpdateRanges()
    attr(pool, stream, 'instanceFade').clearUpdateRanges()

    pool.release(a)
    pool.commitUpdates()

    expect(covers(ranges(matrixAttr(pool, stream)), a.offset * 16, (a.offset + 4) * 16)).toBe(true)
    expect(covers(ranges(attr(pool, stream, 'instanceFade')), a.offset, a.offset + 4)).toBe(true)
  })

  it('коммит без записей не добавляет диапазонов', () => {
    const pool = makePool()
    const stream = pool.billboardStream
    const a = pool.allocate(stream, 2)!
    pool.writeMatrices(stream, a.offset, new Float32Array(2 * 16))
    pool.commitUpdates()
    matrixAttr(pool, stream).clearUpdateRanges()

    pool.commitUpdates()
    expect(ranges(matrixAttr(pool, stream))).toEqual([])
  })

  it('разбросанные слоты сливаются в немногие вызовы, далёкие остаются отдельными', () => {
    const pool = makePool()
    const stream = pool.billboardStream
    // Десять секторов по 5 инстансов через каждые 20 слотов — зазоры меньше допуска
    for (let i = 0; i < 10; i++) pool.writeMatrices(stream, i * 20, new Float32Array(5 * 16).fill(1))
    // И один далеко — дальше допуска в 512 инстансов
    pool.writeMatrices(stream, 780, new Float32Array(5 * 16).fill(1))
    pool.commitUpdates()

    const rs = ranges(matrixAttr(pool, stream))
    expect(rs.length).toBe(2)
    expect(covers(rs.filter((r) => r.start < 780 * 16), 0, (9 * 20 + 5) * 16)).toBe(true)
    expect(covers(rs.filter((r) => r.start >= 780 * 16), 780 * 16, 785 * 16)).toBe(true)
    // Слак ограничен: первый диапазон не тянется до второго
    const first = [...rs].sort((a, b) => a.start - b.start)[0]
    expect(first.start + first.count).toBeLessThanOrEqual((9 * 20 + 5) * 16)
  })
})
