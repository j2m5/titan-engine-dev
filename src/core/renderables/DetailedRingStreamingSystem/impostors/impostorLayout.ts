import { Vector2, Vector3 } from 'three'

export const IMPOSTOR_SLOT_CAPACITY = 64

export interface ImpostorLayout {
  gridSize: number
  frameSize: number
  pageSize: number
  mipCount: number
  maxSampleMip: number
}

export interface ImpostorFrameBasis {
  direction: Vector3
  right: Vector3
  up: Vector3
}

export interface ImpostorFrameSelection {
  frames: [number, number, number]
  weights: [number, number, number]
}

const sign = (value: number): number => value < 0 ? -1 : 1

export function createImpostorLayout(gridSize: number, frameSize: number): ImpostorLayout {
  if (!Number.isSafeInteger(gridSize) || gridSize < 2 || !Number.isSafeInteger(frameSize) || frameSize < 1 || !Number.isInteger(Math.log2(frameSize))) {
    throw new RangeError('Неверный размер атласа астероидов')
  }
  const pageSize = gridSize * frameSize
  if (!Number.isSafeInteger(pageSize)) throw new RangeError('Слишком большой атлас астероидов')
  return { gridSize, frameSize, pageSize, mipCount: Math.floor(Math.log2(pageSize)) + 1, maxSampleMip: Math.log2(frameSize) }
}

/** Направление захвата — от центра формы к камере. */
export function frameBasis(index: number, layout: ImpostorLayout): ImpostorFrameBasis {
  if (!Number.isInteger(index) || index < 0 || index >= layout.gridSize ** 2) throw new RangeError('Ракурс вне атласа')
  let x = 2 * (index % layout.gridSize) / (layout.gridSize - 1) - 1
  let y = 2 * Math.floor(index / layout.gridSize) / (layout.gridSize - 1) - 1
  const z = 1 - Math.abs(x) - Math.abs(y)
  if (z < 0) {
    const previousX = x
    x = (1 - Math.abs(y)) * sign(previousX)
    y = (1 - Math.abs(previousX)) * sign(y)
  }
  // У дублирующихся граничных направлений одинаковые нули и базисы.
  const direction = new Vector3(Math.abs(x) < 1e-14 ? 0 : x, Math.abs(y) < 1e-14 ? 0 : y, Math.abs(z) < 1e-14 ? 0 : z).normalize()
  const reference = Math.abs(direction.z) < 0.99 ? new Vector3(0, 0, 1) : new Vector3(0, 1, 0)
  const right = reference.cross(direction).normalize()
  const up = direction.clone().cross(right)
  return { direction, right, up }
}

export function selectImpostorFrames(direction: Vector3, layout: ImpostorLayout): ImpostorFrameSelection {
  const length = Math.abs(direction.x) + Math.abs(direction.y) + Math.abs(direction.z)
  if (!Number.isFinite(length) || length === 0) throw new RangeError('Неверное направление импостора')
  let x = direction.x / length
  let y = direction.y / length
  if (direction.z < 0) {
    const previousX = x
    x = (1 - Math.abs(y)) * sign(previousX)
    y = (1 - Math.abs(previousX)) * sign(y)
  }
  const gx = Math.min(layout.gridSize - 1, Math.max(0, (x * 0.5 + 0.5) * (layout.gridSize - 1)))
  const gy = Math.min(layout.gridSize - 1, Math.max(0, (y * 0.5 + 0.5) * (layout.gridSize - 1)))
  const ix = Math.min(layout.gridSize - 2, Math.floor(gx))
  const iy = Math.min(layout.gridSize - 2, Math.floor(gy))
  const fx = gx - ix
  const fy = gy - iy
  const base = iy * layout.gridSize + ix
  return fx + fy <= 1
    ? { frames: [base, base + 1, base + layout.gridSize], weights: [1 - fx - fy, fx, fy] }
    : { frames: [base + layout.gridSize + 1, base + layout.gridSize, base + 1], weights: [fx + fy - 1, 1 - fx, 1 - fy] }
}

/** Clamp применяется отдельно для каждого mip, до трилинейного смешивания. */
export function impostorTileUv(uv: Vector2, frame: number, mip: number, layout: ImpostorLayout): Vector2 {
  if (!Number.isInteger(mip) || mip < 0 || mip > layout.maxSampleMip || !Number.isInteger(frame) || frame < 0 || frame >= layout.gridSize ** 2) {
    throw new RangeError('Тексель вне атласа')
  }
  const size = layout.frameSize / 2 ** mip
  const page = layout.gridSize * size
  return new Vector2(
    ((frame % layout.gridSize) * size + Math.min(size - 0.5, Math.max(0.5, uv.x * size))) / page,
    (Math.floor(frame / layout.gridSize) * size + Math.min(size - 0.5, Math.max(0.5, uv.y * size))) / page
  )
}
