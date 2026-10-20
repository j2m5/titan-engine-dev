/** Area reduction. A step bounds source samples, even inside one destination pixel. */
export function createCloudReduction(
  sw: number,
  sh: number,
  dw: number,
  dh: number,
  decode: (index: number) => readonly number[],
  channels: number
) {
  const output = new Uint8Array(dw * dh * 4)
  const blockWidth = sw / dw,
    blockHeight = sh / dh
  if (Number.isInteger(blockWidth) && blockWidth >= 1 && Number.isInteger(blockHeight) && blockHeight >= 1)
    return alignedReduction(sw, dw, dh, blockWidth, blockHeight, decode, channels, output)
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

/** Integral blocks have unit overlap for every source pixel. Keep the same
 * row-major summation and quantize only after a complete destination pixel.
 */
function alignedReduction(
  sw: number,
  dw: number,
  dh: number,
  blockWidth: number,
  blockHeight: number,
  decode: (index: number) => readonly number[],
  channels: number,
  output: Uint8Array
) {
  const area = blockWidth * blockHeight,
    rowSkip = (sw - blockWidth) * 4,
    sums = new Array<number>(channels).fill(0)
  let x = 0,
    y = 0,
    sx = 0,
    sy = 0,
    index = 0
  return {
    output,
    step(samples: number): boolean {
      while (y < dh && samples-- > 0) {
        const decoded = decode(index)
        for (let c = 0; c < channels; c++) sums[c] += decoded[c]
        index += 4
        if (++sx === blockWidth) {
          sx = 0
          sy++
          index += rowSkip
        }
        if (sy === blockHeight) {
          for (let c = 0; c < channels; c++) output[(y * dw + x) * 4 + c] = Math.round((255 * sums[c]) / area)
          sums.fill(0)
          sy = 0
          if (++x === dw) {
            x = 0
            y++
          }
          index = (y * blockHeight * sw + x * blockWidth) * 4
        }
      }
      return y === dh
    }
  }
}
