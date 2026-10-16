/** Fractional area reduction. A step bounds source samples, even inside one destination pixel. */
export function createCloudReduction(
  sw: number,
  sh: number,
  dw: number,
  dh: number,
  decode: (index: number) => readonly number[],
  channels: number
) {
  const output = new Uint8Array(dw * dh * 4)
  let x = 0,
    y = 0,
    sx = 0,
    sy = 0,
    x0 = 0,
    x1 = 0,
    y0 = 0,
    y1 = 0,
    area = 0,
    started = false
  const sums = new Array<number>(channels).fill(0)
  const overlap = (a: number, b: number, c: number, d: number) => Math.max(0, Math.min(b, d) - Math.max(a, c))
  return {
    output,
    step(samples: number): boolean {
      while (y < dh && samples-- > 0) {
        if (!started) {
          x0 = (x * sw) / dw
          x1 = ((x + 1) * sw) / dw
          y0 = (y * sh) / dh
          y1 = ((y + 1) * sh) / dh
          sx = Math.floor(x0)
          sy = Math.floor(y0)
          sums.fill(0)
          area = 0
          started = true
        }
        const weight = overlap(x0, x1, sx, sx + 1) * overlap(y0, y1, sy, sy + 1)
        const decoded = decode((sy * sw + sx) * 4)
        for (let c = 0; c < channels; c++) sums[c] += decoded[c] * weight
        area += weight
        if (++sx >= Math.ceil(x1)) {
          sx = Math.floor(x0)
          sy++
        }
        if (sy >= Math.ceil(y1)) {
          for (let c = 0; c < channels; c++) output[(y * dw + x) * 4 + c] = Math.round((255 * sums[c]) / area)
          started = false
          if (++x === dw) {
            x = 0
            y++
          }
        }
      }
      return y === dh
    }
  }
}
