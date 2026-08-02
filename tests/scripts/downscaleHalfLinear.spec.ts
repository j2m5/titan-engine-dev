import { downscaleHalfLinear } from '../../scripts/lib/downscaleHalfLinear'

describe('downscaleHalfLinear: уменьшение вдвое усреднением в линейном свете', () => {
  it('ядро звезды среди чёрных пикселей не темнеет: 137, а не 64', () => {
    // один блок 2×2, три канала: яркий пиксель и три чёрных
    const source = new Uint8Array([
      255, 255, 255, 0, 0, 0,
      0, 0, 0, 0, 0, 0
    ])

    const result = downscaleHalfLinear(source, 2, 2, 3, false)

    // среднее в линейном свете: (1 + 0 + 0 + 0) / 4 = 0.25 → sRGB 137
    // наивное среднее в sRGB дало бы 64 — именно это тест и ловит
    expect(Array.from(result)).toEqual([137, 137, 137])
  })

  it('однородный блок переживает round-trip без сдвига', () => {
    const source = new Uint8Array([
      128, 128, 128, 128, 128, 128,
      128, 128, 128, 128, 128, 128
    ])

    expect(Array.from(downscaleHalfLinear(source, 2, 2, 3, false))).toEqual([128, 128, 128])
  })

  it('сторона делится на два, число каналов сохраняется', () => {
    const source = new Uint8Array(4 * 4 * 3).fill(64)

    const result = downscaleHalfLinear(source, 4, 4, 3, false)

    expect(result.length).toBe(2 * 2 * 3)
  })

  it('четыре разных блока 2×2 не путают оси: индексная арифметика верна', () => {
    // буфер 4×4, три канала. Каждый из четырёх блоков 2×2 залит своим
    // однородным значением; однородный блок значения V даёт ровно V на выходе
    // (это уже проверено round-trip'ом для 128 выше), поэтому ожидаемый
    // результат для каждого выходного пикселя однозначен. Перестановка x/y
    // или ошибка в шаге строки подставит значение соседнего блока и тест
    // упадёт.
    //
    // раскладка блоков во входном изображении:
    //   [ 10 10 | 20 20 ]
    //   [ 10 10 | 20 20 ]
    //   [ 30 30 | 40 40 ]
    //   [ 30 30 | 40 40 ]
    const row = (left: number, right: number): number[] => [
      left, left, left, left, left, left, right, right, right, right, right, right
    ]
    const source = new Uint8Array([...row(10, 20), ...row(10, 20), ...row(30, 40), ...row(30, 40)])

    const result = downscaleHalfLinear(source, 4, 4, 3, false)

    // выходной пиксель (0,0) — блок 10 (верх-лево)
    expect(Array.from(result.slice(0, 3))).toEqual([10, 10, 10])
    // выходной пиксель (1,0) — блок 20 (верх-право)
    expect(Array.from(result.slice(3, 6))).toEqual([20, 20, 20])
    // выходной пиксель (0,1) — блок 30 (низ-лево)
    expect(Array.from(result.slice(6, 9))).toEqual([30, 30, 30])
    // выходной пиксель (1,1) — блок 40 (низ-право)
    expect(Array.from(result.slice(9, 12))).toEqual([40, 40, 40])
  })

  it('альфа усредняется без гаммы: 64, а не 137', () => {
    // RGBA: у яркого пикселя альфа 255, у остальных 0
    const source = new Uint8Array([
      255, 255, 255, 255, 0, 0, 0, 0,
      0, 0, 0, 0, 0, 0, 0, 0
    ])

    const result = downscaleHalfLinear(source, 2, 2, 4, true)

    expect(Array.from(result)).toEqual([137, 137, 137, 64])
  })

  it('hasAlpha=false на четырёх каналах — четвёртый канал усредняется в линейном свете, не как альфа', () => {
    // тот же буфер, что в тесте выше, но hasAlpha=false: четвёртый канал
    // обязан пройти через гамма-ветку и дать 137, а не 64
    const source = new Uint8Array([
      255, 255, 255, 255, 0, 0, 0, 0,
      0, 0, 0, 0, 0, 0, 0, 0
    ])

    const result = downscaleHalfLinear(source, 2, 2, 4, false)

    expect(Array.from(result)).toEqual([137, 137, 137, 137])
  })

  it('нечётная сторона — ошибка, а не молчаливое округление', () => {
    const source = new Uint8Array(3 * 2 * 3)

    expect(() => downscaleHalfLinear(source, 3, 2, 3, false)).toThrow(/чётной/)
  })

  it('несходящаяся длина буфера — ошибка', () => {
    expect(() => downscaleHalfLinear(new Uint8Array(10), 2, 2, 3, false)).toThrow(/буфера/)
  })
})
