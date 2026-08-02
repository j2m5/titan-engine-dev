/**
 * Уменьшение вдвое усреднением блоков 2×2 в ЛИНЕЙНОМ свете.
 *
 * Функция для ЦВЕТОВЫХ карт в sRGB (диффуз, скайбокс). Карты высот, нормалей и
 * прочие данные ею уменьшать нельзя: там байты — не яркость, и гамма к ним
 * неприменима.
 *
 * Почему линейный свет. Ядро звезды на чёрном фоне — блок вида (255, 0, 0, 0).
 * Среднее в sRGB даёт 64, то есть линейные 0.05; правильное среднее в линейном
 * свете даёт 0.25, то есть sRGB 137. Разница в пять раз по яркости, причём
 * ровно на тех пикселях, которые пробивают порог блума. Железо для sRGB-текстур
 * фильтрует именно так: декодирует в линейное ДО усреднения, — поэтому линейный
 * путь ещё и совпадает с тем, как выглядит нынешняя минификация на экране.
 *
 * Альфа (четвёртый канал) усредняется без гаммы: она хранит непрозрачность.
 */

/** sRGB-байт → линейное значение; 256 записей вместо pow на каждый пиксель */
const SRGB_TO_LINEAR: Float64Array = new Float64Array(256)

for (let i = 0; i < 256; i++) {
  const v: number = i / 255
  SRGB_TO_LINEAR[i] = v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4)
}

function linearToSrgbByte(linear: number): number {
  const v: number = linear <= 0.0031308 ? linear * 12.92 : 1.055 * Math.pow(linear, 1 / 2.4) - 0.055

  return Math.max(0, Math.min(255, Math.round(v * 255)))
}

export function downscaleHalfLinear(
  source: Uint8Array,
  width: number,
  height: number,
  channels: number
): Uint8Array {
  if (width % 2 !== 0 || height % 2 !== 0) {
    throw new Error(`Сторона обязана быть чётной, получено ${width}×${height}`)
  }

  if (source.length !== width * height * channels) {
    throw new Error(
      `Длина буфера не сходится: ${source.length} против ${width * height * channels}`
    )
  }

  const outWidth: number = width / 2
  const outHeight: number = height / 2
  const out: Uint8Array = new Uint8Array(outWidth * outHeight * channels)
  const hasAlpha: boolean = channels === 4

  for (let y = 0; y < outHeight; y++) {
    const rowTop: number = 2 * y * width * channels
    const rowBottom: number = (2 * y + 1) * width * channels

    for (let x = 0; x < outWidth; x++) {
      const left: number = 2 * x * channels
      const a: number = rowTop + left
      const b: number = a + channels
      const c: number = rowBottom + left
      const d: number = c + channels
      const dst: number = (y * outWidth + x) * channels

      for (let channel = 0; channel < channels; channel++) {
        if (hasAlpha && channel === 3) {
          out[dst + channel] = Math.round(
            (source[a + 3] + source[b + 3] + source[c + 3] + source[d + 3]) / 4
          )
          continue
        }

        const sum: number =
          SRGB_TO_LINEAR[source[a + channel]] +
          SRGB_TO_LINEAR[source[b + channel]] +
          SRGB_TO_LINEAR[source[c + channel]] +
          SRGB_TO_LINEAR[source[d + channel]]

        out[dst + channel] = linearToSrgbByte(sum / 4)
      }
    }
  }

  return out
}
