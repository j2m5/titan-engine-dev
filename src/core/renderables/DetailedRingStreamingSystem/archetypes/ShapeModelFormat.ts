import { BufferAttribute, BufferGeometry } from 'three'

/**
 * Бинарный формат реальной модели формы астероида (`asteroids/shapes/<имя>_<ярус>.bin`).
 *
 * Модели тел из открытых архивов (PDS Small Bodies Node, DAMIT) режутся
 * офлайн-скриптом (scripts/build-shape-models.ts) до двух ярусов — l0 (~640
 * треугольников) и near (~2000), см. TIER_TRIANGLES в scripts/lib/shapeModel —
 * центрируются по объёмному центроиду и нормируются на
 * максимальный радиус 1 (та же нормировка, что у процедурной радиальной
 * функции: масштаб инстанса и силуэт билборда общие).
 *
 * Раскладка (little-endian, всё выровнено на 4 байта):
 *   u32 magic 'TESH' · u32 version · u32 vertexCount · u32 indexCount ·
 *   f32[3·vertexCount] positions · f32[3·vertexCount] normals · u32[indexCount] indices
 */
export const SHAPE_MODEL_MAGIC = 0x48534554
export const SHAPE_MODEL_VERSION = 1
const HEADER_BYTES = 16

export type ShapeModelTier = 'l0' | 'near'

export interface ShapeModelData {
  positions: Float32Array
  normals: Float32Array
  indices: Uint32Array
}

/** Путь бинарника модели относительно корня текстур (тот же корень, что у карт высот) */
export function shapeModelPath(name: string, tier: ShapeModelTier): string {
  return `asteroids/shapes/${name}_${tier}.bin`
}

export function encodeShapeModel(data: ShapeModelData): ArrayBuffer {
  const vertexCount = data.positions.length / 3
  if (data.normals.length !== data.positions.length) throw new Error('ShapeModel: normals/positions length mismatch')
  const buffer = new ArrayBuffer(HEADER_BYTES + data.positions.byteLength + data.normals.byteLength + data.indices.byteLength)
  const header = new DataView(buffer, 0, HEADER_BYTES)
  header.setUint32(0, SHAPE_MODEL_MAGIC, true)
  header.setUint32(4, SHAPE_MODEL_VERSION, true)
  header.setUint32(8, vertexCount, true)
  header.setUint32(12, data.indices.length, true)
  new Float32Array(buffer, HEADER_BYTES, data.positions.length).set(data.positions)
  new Float32Array(buffer, HEADER_BYTES + data.positions.byteLength, data.normals.length).set(data.normals)
  new Uint32Array(buffer, HEADER_BYTES + data.positions.byteLength * 2, data.indices.length).set(data.indices)
  return buffer
}

export function parseShapeModel(buffer: ArrayBuffer): ShapeModelData {
  if (buffer.byteLength < HEADER_BYTES) throw new Error('ShapeModel: buffer too short')
  const header = new DataView(buffer, 0, HEADER_BYTES)
  if (header.getUint32(0, true) !== SHAPE_MODEL_MAGIC) throw new Error('ShapeModel: bad magic')
  const version = header.getUint32(4, true)
  if (version !== SHAPE_MODEL_VERSION) throw new Error(`ShapeModel: unsupported version ${version}`)
  const vertexCount = header.getUint32(8, true)
  const indexCount = header.getUint32(12, true)
  const expected = HEADER_BYTES + vertexCount * 24 + indexCount * 4
  if (buffer.byteLength !== expected) throw new Error(`ShapeModel: length ${buffer.byteLength}, expected ${expected}`)

  // Копии, а не view: буфер ответа fetch может быть переиспользован
  const positions = new Float32Array(buffer, HEADER_BYTES, vertexCount * 3).slice()
  const normals = new Float32Array(buffer, HEADER_BYTES + vertexCount * 12, vertexCount * 3).slice()
  const indices = new Uint32Array(buffer, HEADER_BYTES + vertexCount * 24, indexCount).slice()
  for (const i of indices) {
    if (i >= vertexCount) throw new Error('ShapeModel: index out of range')
  }
  return { positions, normals, indices }
}

/**
 * Геометрия архетипа из данных модели. surfaceData (freshness/cavity запечённых
 * процедурных архетипов) у реальной модели нулевой — явный атрибут, чтобы
 * стрим пула нёс тот же набор атрибутов, что и процедурный.
 */
export function shapeModelGeometry(data: ShapeModelData, radius: number): BufferGeometry {
  const positions = new Float32Array(data.positions.length)
  for (let i = 0; i < positions.length; i++) positions[i] = data.positions[i] * radius
  const geometry = new BufferGeometry()
  geometry.setAttribute('position', new BufferAttribute(positions, 3))
  geometry.setAttribute('normal', new BufferAttribute(data.normals.slice(), 3))
  geometry.setAttribute('surfaceData', new BufferAttribute(new Float32Array((positions.length / 3) * 4), 4))
  geometry.setIndex(new BufferAttribute(data.indices.slice(), 1))
  return geometry
}
