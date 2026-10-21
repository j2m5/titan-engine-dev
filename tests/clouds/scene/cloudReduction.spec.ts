import { describe, expect, it } from 'vitest'
import { createCloudReduction } from '@/core/clouds/appearance/cloudPreparationSteps'

describe('cloud area reduction', () => {
  it.each([
    [1, 1],
    [4, 4],
    [3, 2],
    [1, 7],
    [8, 1]
  ])('integrates aligned %sx%s blocks after decoding, retaining channels and partial work', (bw, bh) => {
    const dw = 3,
      dh = 2,
      sw = dw * bw,
      sh = dh * bh
    const pixels = Array.from({ length: sw * sh }, (_, i) => [
      ((i * 37) % 256) / 255,
      (((i * 53) % 256) / 255) ** 2,
      i % 2
    ])
    const expected = new Uint8Array(dw * dh * 4)
    const expectedOrder: number[] = []
    for (let y = 0; y < dh; y++)
      for (let x = 0; x < dw; x++) {
        const sum = [0, 0, 0]
        for (let row = y * bh; row < (y + 1) * bh; row++)
          for (let col = x * bw; col < (x + 1) * bw; col++) {
            const index = row * sw + col
            expectedOrder.push(index * 4)
            pixels[index].forEach((value, c) => (sum[c] += value))
          }
        sum.forEach((value, c) => (expected[(y * dw + x) * 4 + c] = Math.round((255 * value) / (bw * bh))))
      }
    for (const budget of [1, 7, 256]) {
      const visited: number[] = []
      const job = createCloudReduction(
        sw,
        sh,
        dw,
        dh,
        (index) => {
          visited.push(index)
          return pixels[index / 4]
        },
        3
      )
      let done = false
      while (!done) {
        const start = visited.length
        done = job.step(budget)
        expect(visited.length - start).toBeLessThanOrEqual(budget)
      }
      expect(job.output).toEqual(expected)
      expect(visited).toEqual(expectedOrder)
      expect(job.step(1)).toBe(true)
      expect(visited).toEqual(expectedOrder)
    }
  })
  it('keeps fractional weighting when only one axis has an integral ratio', () => {
    const job = createCloudReduction(7, 4, 3, 2, (index) => [(index / 4) % 7 >= 3 ? 1 : 0], 1)
    while (!job.step(5)) {
      /* finish bounded work */
    }
    expect(Array.from(job.output).filter((_, i) => i % 4 === 0)).toEqual([0, 182, 255, 0, 182, 255])
  })
})
