import { Vector2, Vector3 } from 'three'
import { createImpostorLayout, frameBasis, selectImpostorFrames, impostorTileUv } from '@/core/renderables/DetailedRingStreamingSystem/impostors/impostorLayout'

const layout = createImpostorLayout(8, 64)

function blendedDirection(direction: Vector3): Vector3 {
  const selection = selectImpostorFrames(direction, layout)
  const result = new Vector3()
  selection.frames.forEach((frame, i) => result.addScaledVector(frameBasis(frame, layout).direction, selection.weights[i]))
  return result.normalize()
}

describe('ракурсы полносферического импостора', () => {
  it('оставляет место всем плиткам и ограничивает mip одной плиткой', () => {
    expect(layout).toEqual({ gridSize: 8, frameSize: 64, pageSize: 512, mipCount: 10, maxSampleMip: 6 })
    expect(impostorTileUv(new Vector2(0, 0), 9, 0, layout).toArray()).toEqual([64.5 / 512, 64.5 / 512])
    expect(impostorTileUv(new Vector2(1, 1), 9, 0, layout).toArray()).toEqual([127.5 / 512, 127.5 / 512])
    expect(impostorTileUv(new Vector2(0.1, 0.9), 9, 6, layout).toArray()).toEqual([1.5 / 8, 1.5 / 8])
  })

  it.each([[1, 64], [8, 63], [8, 0], [NaN, 64], [8, Infinity], [2.5, 64]])('отвергает неверную сетку %s × %s', (grid, frame) => {
    expect(() => createImpostorLayout(grid, frame)).toThrow(RangeError)
  })

  it('покрывает всю сферу тремя неотрицательными весами', () => {
    for (let i = 0; i < 401; i++) {
      const z = 1 - 2 * (i + 0.5) / 401
      const radius = Math.sqrt(1 - z * z)
      const direction = new Vector3(radius * Math.cos(i * 2.39996323), radius * Math.sin(i * 2.39996323), z)
      const { frames, weights } = selectImpostorFrames(direction, layout)
      expect(new Set(frames).size).toBe(3)
      expect(frames.every(frame => frame >= 0 && frame < 64)).toBe(true)
      expect(weights.every(weight => weight >= -1e-12)).toBe(true)
      expect(weights.reduce((a, b) => a + b)).toBeCloseTo(1, 12)
      expect(blendedDirection(direction).dot(direction)).toBeGreaterThan(0.96)
    }
  })

  it('в узле возвращает именно его направление с тем же базисом у дублей', () => {
    for (let i = 0; i < 64; i++) {
      const frame = frameBasis(i, layout)
      expect(blendedDirection(frame.direction).distanceTo(frame.direction)).toBeLessThan(1e-10)
      expect(frame.right.dot(frame.up)).toBeCloseTo(0, 12)
      expect(frame.right.clone().cross(frame.up).distanceTo(frame.direction)).toBeLessThan(1e-12)
    }
    for (const corner of [0, 7, 56, 63]) {
      const frame = frameBasis(corner, layout)
      expect(frame.direction.toArray()).toEqual([0, 0, -1])
      expect(frame.right.toArray()).toEqual(frameBasis(0, layout).right.toArray())
      expect(frame.up.toArray()).toEqual(frameBasis(0, layout).up.toArray())
    }
  })

  it('не скачет при пересечении полюса, шва и диагоналей ячеек', () => {
    const epsilon = 1e-8
    for (const direction of [new Vector3(1, 0, -1), new Vector3(-1, 0, -1), new Vector3(0, 1, -1), new Vector3(0, -1, -1), new Vector3(0, 0, -1), new Vector3(0, 0, 1), new Vector3(1, 1, 1)]) {
      const before = blendedDirection(direction.clone().add(new Vector3(epsilon, epsilon, 0)))
      const after = blendedDirection(direction.clone().add(new Vector3(-epsilon, -epsilon, 0)))
      expect(before.distanceTo(after)).toBeLessThan(1e-6)
    }
  })

  it('отвергает нулевой или нечисловой вектор и чужой кадр', () => {
    expect(() => selectImpostorFrames(new Vector3(), layout)).toThrow(RangeError)
    expect(() => selectImpostorFrames(new Vector3(NaN, 1, 0), layout)).toThrow(RangeError)
    expect(() => frameBasis(64, layout)).toThrow(RangeError)
  })
})
