import { describe, expect, it } from 'vitest'
import { bandPassSpherical } from '../../scripts/lib/sphericalBandFilter'

function makeWave(width: number, height: number, cyclesX: number): Float64Array {
  const out = new Float64Array(width * height)
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) out[y * width + x] = Math.sin((2 * Math.PI * cyclesX * x) / width)
  return out
}

function rms(a: Float64Array): number {
  return Math.sqrt(a.reduce((s, v) => s + v * v, 0) / a.length)
}

/** Широта центра строки по полутексельной конвенции: строка 0 — юг, height−1 — север. */
function rowLatitude(y: number, height: number): number {
  return Math.PI * ((y + 0.5) / height - 0.5)
}

describe('bandPassSpherical', () => {
  it('НЧ-волна (λ=width, длиннее σ_low) подавляется в экваториальном поясе', () => {
    // λ=256 (весь виток, cyclesX=1). Порог выведен из передаточной функции
    // гауссианы T(λ,σ)=exp(−2π²σ²/λ²) (частотный отклик box-триплета близок
    // к ней, см. докблок модуля): T(256,16)≈0.9258, T(256,1)≈0.9997 →
    // утечка DoG на экваторе |T_high−T_low|≈0.0739. У края пояса (|lat|=30°,
    // cos=0.866) EW-радиус честно растёт на 1/cos, эффективная σ_low растёт
    // до ~18.5 → утечка там же по формуле ≈0.097 (волна физически короче,
    // легально ближе к полосе — это НЕ дефект, а причина ограничивать пояс).
    // Порог 0.2 — это ~2× худшей континуальной оценки (0.097), запас на
    // огрубление гауссианы тройным box-приближением.
    const w = 256,
      h = 128
    const src = makeWave(w, h, 1)
    const out = bandPassSpherical(src, w, h, 16, 1)

    const beltOut: number[] = []
    const beltSrc: number[] = []
    for (let y = 0; y < h; y++) {
      if (Math.abs(rowLatitude(y, h)) >= Math.PI / 6) continue // |широта| < 30°
      for (let x = 0; x < w; x++) {
        beltOut.push(out[y * w + x])
        beltSrc.push(src[y * w + x])
      }
    }
    const beltRms = (a: number[]): number => Math.sqrt(a.reduce((s, v) => s + v * v, 0) / a.length)

    expect(beltRms(beltOut) / beltRms(beltSrc)).toBeLessThan(0.2)
  })

  it('волна в полосе проходит с малыми потерями', () => {
    const w = 256,
      h = 128
    const src = makeWave(w, h, 32) // период 8 текселей: выше σ_low=16, ниже σ_high=0.5
    const out = bandPassSpherical(src, w, h, 16, 0.5)
    expect(rms(out) / rms(src)).toBeGreaterThan(0.6)
  })

  it('ВЧ-шум давится σ_high', () => {
    const w = 256,
      h = 128
    const src = new Float64Array(w * h).map(() => 0) // одиночный тексель-импульс
    src[64 * w + 128] = 1
    const out = bandPassSpherical(src, w, h, 16, 3)
    expect(Math.max(...out)).toBeLessThan(0.05) // импульс размазан σ_high=3
  })

  it('широтная честность: одна ФИЗИЧЕСКАЯ волна на экваторе и 60° фильтруется одинаково', () => {
    // На 60° cos=0.5: та же физическая длина волны занимает вдвое БОЛЬШЕ текселей
    // (арка на тексель у 60° вдвое короче экваториальной — см. slopeMapEncode).
    // При одновременном удвоении текселей волны и эффективных σ (÷cos(lat)) отклик
    // фильтра инвариантен — это и есть широтная честность EW-прохода.
    const w = 256
    const h = 400
    const src = new Float64Array(w * h)

    const eqCenter = Math.round(h / 2)
    let equatorRow = eqCenter
    let bestEq = Infinity
    for (let y = 0; y < h; y++) {
      const d = Math.abs(rowLatitude(y, h))
      if (d < bestEq) {
        bestEq = d
        equatorRow = y
      }
    }

    const target60 = Math.PI / 3
    let row60 = 0
    let best60 = Infinity
    for (let y = 0; y < h; y++) {
      const d = Math.abs(rowLatitude(y, h) - target60)
      if (d < best60) {
        best60 = d
        row60 = y
      }
    }

    const half = 70 // > 3·radius(σ_low=16)=48 — соседи по NS внутри полосы идентичны, блюр их не меняет
    const periodEq = 8
    const period60 = 16 // физически та же волна: период удвоен вместе с 1/cos(60°)=2

    for (let y = equatorRow - half; y <= equatorRow + half; y++)
      for (let x = 0; x < w; x++) src[y * w + x] = Math.sin((2 * Math.PI * x) / periodEq)
    for (let y = row60 - half; y <= row60 + half; y++)
      for (let x = 0; x < w; x++) src[y * w + x] = Math.sin((2 * Math.PI * x) / period60)

    const out = bandPassSpherical(src, w, h, 16, 0.5)

    const outEqRow = out.subarray(equatorRow * w, equatorRow * w + w)
    const out60Row = out.subarray(row60 * w, row60 * w + w)
    const rmsEq = rms(outEqRow)
    const rms60 = rms(out60Row)

    expect(rmsEq).toBeGreaterThan(0.1) // сам факт прохождения волны через полосу
    expect(Math.abs(rmsEq / rms60 - 1)).toBeLessThan(0.2)
  })

  it('заворот долготы: волна, пересекающая шов x=0, фильтруется без разрыва', () => {
    const w = 256,
      h = 32
    const src = new Float64Array(w * h)
    const period = 8 // в полосе (σ_low=16, σ_high=0.5), как в тесте прохождения
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++) src[y * w + x] = Math.cos((2 * Math.PI * x) / period) // максимум на шве x=0

    const out = bandPassSpherical(src, w, h, 16, 0.5)
    const y = Math.floor(h / 2)
    const row = out.subarray(y * w, y * w + w)

    let sumAdjacent = 0
    for (let x = 0; x < w - 1; x++) sumAdjacent += Math.abs(row[x + 1] - row[x])
    const meanAdjacent = sumAdjacent / (w - 1)
    const seamDiff = Math.abs(row[0] - row[w - 1])

    // шовный переход (x=width−1 → x=0) не должен выделяться на фоне обычных
    // соседних разностей — иначе заворот сломан и шов виден как разрыв
    expect(seamDiff).toBeLessThan(3 * meanAdjacent)
  })

  it('детерминизм и отсутствие NaN у полюсов', () => {
    const w = 128,
      h = 64
    const src = makeWave(w, h, 5)
    const out1 = bandPassSpherical(src, w, h, 16, 1)
    const out2 = bandPassSpherical(src, w, h, 16, 1)

    expect(Array.from(out1)).toEqual(Array.from(out2))

    for (let x = 0; x < w; x++) {
      expect(Number.isFinite(out1[x])).toBe(true) // верхняя строка (полюс)
      expect(Number.isFinite(out1[(h - 1) * w + x])).toBe(true) // нижняя строка (полюс)
    }
  })
})
