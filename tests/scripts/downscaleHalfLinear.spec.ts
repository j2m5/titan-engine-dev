import { downscaleHalfLinear } from '../../scripts/lib/downscaleHalfLinear'

describe('downscaleHalfLinear: уменьшение вдвое усреднением в линейном свете', () => {
  it('ядро звезды среди чёрных пикселей не темнеет: 137, а не 64', () => {
    // один блок 2×2, три канала: яркий пиксель и три чёрных
    const source = new Uint8Array([
      255, 255, 255, 0, 0, 0,
      0, 0, 0, 0, 0, 0
    ])

    const result = downscaleHalfLinear(source, 2, 2, 3)

    // среднее в линейном свете: (1 + 0 + 0 + 0) / 4 = 0.25 → sRGB 137
    // наивное среднее в sRGB дало бы 64 — именно это тест и ловит
    expect(Array.from(result)).toEqual([137, 137, 137])
  })

  it('однородный блок переживает round-trip без сдвига', () => {
    const source = new Uint8Array([
      128, 128, 128, 128, 128, 128,
      128, 128, 128, 128, 128, 128
    ])

    expect(Array.from(downscaleHalfLinear(source, 2, 2, 3))).toEqual([128, 128, 128])
  })

  it('сторона делится на два, число каналов сохраняется', () => {
    const source = new Uint8Array(4 * 4 * 3).fill(64)

    const result = downscaleHalfLinear(source, 4, 4, 3)

    expect(result.length).toBe(2 * 2 * 3)
  })

  it('альфа усредняется без гаммы: 64, а не 137', () => {
    // RGBA: у яркого пикселя альфа 255, у остальных 0
    const source = new Uint8Array([
      255, 255, 255, 255, 0, 0, 0, 0,
      0, 0, 0, 0, 0, 0, 0, 0
    ])

    const result = downscaleHalfLinear(source, 2, 2, 4)

    expect(Array.from(result)).toEqual([137, 137, 137, 64])
  })

  it('нечётная сторона — ошибка, а не молчаливое округление', () => {
    const source = new Uint8Array(3 * 2 * 3)

    expect(() => downscaleHalfLinear(source, 3, 2, 3)).toThrow(/чётной/)
  })

  it('несходящаяся длина буфера — ошибка', () => {
    expect(() => downscaleHalfLinear(new Uint8Array(10), 2, 2, 3)).toThrow(/буфера/)
  })
})
