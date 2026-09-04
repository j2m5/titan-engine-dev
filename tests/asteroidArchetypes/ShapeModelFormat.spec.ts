import {
  encodeShapeModel,
  parseShapeModel,
  shapeModelGeometry,
  shapeModelPath,
  SHAPE_MODEL_MAGIC
} from '@/core/renderables/DetailedRingStreamingSystem/archetypes/ShapeModelFormat'

const sample = () => ({
  positions: new Float32Array([0, 0, 1, 1, 0, 0, 0, 1, 0, -1, 0, 0]),
  normals: new Float32Array([0, 0, 1, 1, 0, 0, 0, 1, 0, -1, 0, 0]),
  indices: new Uint32Array([0, 1, 2, 0, 2, 3])
})

describe('ShapeModelFormat: бинарник реальной модели формы', () => {
  it('путь: asteroids/shapes/<имя>_<ярус>.bin', () => {
    expect(shapeModelPath('itokawa', 'l0')).toBe('asteroids/shapes/itokawa_l0.bin')
    expect(shapeModelPath('bennu', 'near')).toBe('asteroids/shapes/bennu_near.bin')
  })

  it('encode → parse даёт побитово те же массивы', () => {
    const data = sample()
    const parsed = parseShapeModel(encodeShapeModel(data))
    expect(Array.from(parsed.positions)).toEqual(Array.from(data.positions))
    expect(Array.from(parsed.normals)).toEqual(Array.from(data.normals))
    expect(Array.from(parsed.indices)).toEqual(Array.from(data.indices))
  })

  it('заголовок: magic, версия, счётчики; длина буфера = 16 + 24·V + 4·I', () => {
    const buffer = encodeShapeModel(sample())
    const header = new DataView(buffer)
    expect(header.getUint32(0, true)).toBe(SHAPE_MODEL_MAGIC)
    expect(header.getUint32(4, true)).toBe(1)
    expect(header.getUint32(8, true)).toBe(4)
    expect(header.getUint32(12, true)).toBe(6)
    expect(buffer.byteLength).toBe(16 + 4 * 24 + 6 * 4)
  })

  it('parse отвергает чужой magic, обрезанный буфер и индекс за пределами вершин', () => {
    const good = encodeShapeModel(sample())
    const badMagic = good.slice(0)
    new DataView(badMagic).setUint32(0, 0x12345678, true)
    expect(() => parseShapeModel(badMagic)).toThrow(/magic/)
    expect(() => parseShapeModel(good.slice(0, good.byteLength - 4))).toThrow(/length/)
    const badIndex = encodeShapeModel({ ...sample(), indices: new Uint32Array([0, 1, 9]) })
    expect(() => parseShapeModel(badIndex)).toThrow(/index/)
  })

  it('parse копирует данные: правка исходного буфера не трогает результат', () => {
    const buffer = encodeShapeModel(sample())
    const parsed = parseShapeModel(buffer)
    new Float32Array(buffer, 16, 1)[0] = 42
    expect(parsed.positions[0]).toBe(0)
  })

  it('геометрия: позиции × radius, нормали как есть, нулевой surfaceData vec4, индекс', () => {
    const geometry = shapeModelGeometry(sample(), 2.5)
    const pos = geometry.getAttribute('position')
    expect(pos.count).toBe(4)
    expect(pos.getZ(0)).toBeCloseTo(2.5, 6)
    expect(geometry.getAttribute('normal').getZ(0)).toBe(1)
    const surface = geometry.getAttribute('surfaceData')
    expect(surface.itemSize).toBe(4)
    expect(surface.count).toBe(4)
    expect(Array.from(surface.array as Float32Array).every((v) => v === 0)).toBe(true)
    expect(geometry.getIndex()!.count).toBe(6)
  })
})
