import { describe, expect, it } from 'vitest'
import { bandPassSpherical, blurSpherical, extendedBoxParams, gaussianBlurSpherical } from '../../scripts/lib/sphericalBandFilter'

function makeWave(width: number, height: number, cyclesX: number): Float64Array {
  const out = new Float64Array(width * height)
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) out[y * width + x] = Math.sin((2 * Math.PI * cyclesX * x) / width)
  return out
}

function rms(a: Float64Array): number {
  return Math.sqrt(a.reduce((s, v) => s + v * v, 0) / a.length)
}

/** Широта центра строки по полутексельной конвенции: строка 0 — север, height−1 — юг. */
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
    // ближе к полосе — причина ограничивать пояс проверки).
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

describe('gaussianBlurSpherical', () => {
  it('константа остаётся константой (размытие не смещает уровень)', () => {
    const w = 64,
      h = 32
    const src = new Float64Array(w * h).fill(0.37)

    const out = gaussianBlurSpherical(src, w, h, 2)

    for (const v of out) expect(v).toBeCloseTo(0.37, 12)
  })

  it('σ ≤ 0 — тождество (копия входа, не тот же буфер)', () => {
    const w = 8,
      h = 4
    const src = makeWave(w, h, 2)

    const out = gaussianBlurSpherical(src, w, h, 0)

    expect(Array.from(out)).toEqual(Array.from(src))
    expect(out).not.toBe(src)
  })

  it('ступенька сглаживается: скачок расползается на несколько текселей', () => {
    const w = 128,
      h = 8
    const src = new Float64Array(w * h)
    for (let y = 0; y < h; y++) for (let x = w / 2; x < w; x++) src[y * w + x] = 1

    const out = gaussianBlurSpherical(src, w, h, 3)
    const row = Array.from(out.subarray((h / 2) * w, (h / 2) * w + w))

    const edge = w / 2
    expect(row[edge - 1]).toBeGreaterThan(0) // «холодная» сторона подтянута вверх
    expect(row[edge]).toBeLessThan(1) // «горячая» — просажена вниз
    let maxJump = 0
    for (let x = 1; x < w; x++) maxJump = Math.max(maxJump, Math.abs(row[x] - row[x - 1]))
    expect(maxJump).toBeLessThan(0.5) // исходный скачок был 1.0
  })

  it('среднее сохраняется (поле, постоянное по широте: EW заворачивается, NS тождество)', () => {
    const w = 128,
      h = 32
    const src = new Float64Array(w * h)
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++) src[y * w + x] = 0.5 + 0.4 * Math.sin((2 * Math.PI * x) / 11)

    const mean = (a: Float64Array): number => a.reduce((s, v) => s + v, 0) / a.length
    const out = gaussianBlurSpherical(src, w, h, 2)

    expect(mean(out)).toBeCloseTo(mean(src), 12)
  })

  it('детерминизм', () => {
    const w = 64,
      h = 32
    const src = makeWave(w, h, 5)

    expect(Array.from(gaussianBlurSpherical(src, w, h, 1.5))).toEqual(Array.from(gaussianBlurSpherical(src, w, h, 1.5)))
  })
})

describe('extendedBoxParams', () => {
  it('целая дисперсия → alpha 0, m как у целого бокса', () => {
    for (const m of [0, 1, 2, 5]) {
      const sigma = Math.sqrt(m * (m + 1)) // σ² = 3·v_m
      expect(extendedBoxParams(sigma, 100)).toEqual({ m, alpha: 0 })
    }
  })

  it('alpha непрерывна по σ и уходит к 1 у следующего целого', () => {
    // Наклон ширины dw/dσ максимален у конца отрезка m=0: 6σ/(3−σ²)² → ≈8.5
    // при σ → √2, то есть ≈0.085 на шаг 0.01; округление радиуса давало скачок 2.
    let prev = extendedBoxParams(0.01, 100)
    for (let sigma = 0.02; sigma < 6; sigma += 0.01) {
      const p = extendedBoxParams(sigma, 100)
      const width = 2 * p.m + 1 + 2 * p.alpha
      const prevWidth = 2 * prev.m + 1 + 2 * prev.alpha
      expect(width - prevWidth).toBeGreaterThanOrEqual(0)
      expect(width - prevWidth).toBeLessThan(0.1) // эффективная ширина без скачков
      prev = p
    }
  })

  it('дисперсия ядра одного прохода = σ²/3', () => {
    for (const sigma of [0.3, 0.9, 1.5, 3.7]) {
      const { m, alpha } = extendedBoxParams(sigma, 100)
      const norm = 2 * m + 1 + 2 * alpha
      let v = 0
      for (let k = -m; k <= m; k++) v += k * k
      v += 2 * alpha * (m + 1) ** 2
      expect(v / norm).toBeCloseTo((sigma * sigma) / 3, 9)
    }
  })

  it('потолок maxRadius', () => {
    expect(extendedBoxParams(1e6, 7)).toEqual({ m: 7, alpha: 0 })
  })
})

describe('blurSpherical: нет широтного шва', () => {
  it('отклик на изотропный шум гладок по широте — нет скачков между соседними полосами строк', () => {
    // детерминированный шум 2048×256; σ = 1.5 экваториальных текселя (пороги старой
    // формулы ~39°, ~60°, ~68°). Ширина 2048, а не 512: на 512 статистический шум
    // RMS строки у ±60…80° (мало независимых отсчётов при широком EW-ядре) сам
    // по себе давал скачки ~0.3–0.5 и у старого, и у нового кода.
    const w = 2048,
      h = 256
    const src = new Float64Array(w * h)
    let s = 12345
    for (let i = 0; i < src.length; i++) {
      s = (s * 1103515245 + 12345) >>> 0
      src[i] = s / 2 ** 32 - 0.5
    }
    const out = blurSpherical(src, w, h, 1.5)
    // RMS EW-разности по строке, нормированная на cos^1.5 φ: для белого шума под
    // ядром σx = σ/cos φ, σy = σ дисперсия EW-разности ∝ σx⁻³·σy⁻¹, так что честный
    // фильтр даёт плоский профиль; нормировка на cos φ оставляла тренд ∝ tan φ,
    // который у полюсов сам перерастал порог.
    const rowRms = (y: number): number => {
      let acc = 0
      for (let x = 0; x < w; x++) {
        const d = out[y * w + ((x + 1) % w)] - out[y * w + x]
        acc += d * d
      }
      return Math.sqrt(acc / w) / Math.cos(rowLatitude(y, h)) ** 1.5
    }
    // скачок между соседними окнами по 6 строк не больше 3× медианного (старая формула давала выброс на пороге);
    // пояс |φ| ≤ 70°: выше EW-ядро шире ~8 текселей и RMS строки — шум выборки
    const steps: number[] = []
    for (let y = 12; y < h - 12; y++) {
      if (Math.abs(rowLatitude(y, h)) > (70 * Math.PI) / 180) continue
      let a = 0
      let b = 0
      for (let k = 0; k < 6; k++) {
        a += rowRms(y - 6 + k) / 6
        b += rowRms(y + k) / 6
      }
      steps.push(Math.abs(Math.log(b / a)))
    }
    const sorted = [...steps].sort((p, q) => p - q)
    const median = sorted[Math.floor(sorted.length / 2)]
    expect(Math.max(...steps)).toBeLessThan(3 * median + 0.02)
  })

  it('профиль ядра без шума: энергия EW-разности отклика на импульс гладка по широте до 85°', () => {
    // Импульс в x=0 каждой строки — по NS поле постоянно, отклик строки = само EW-ядро.
    // Σ(Δk)² ∝ σx⁻³ = (σ/cos φ)⁻³, деление на cos³ φ даёт плоский профиль.
    const w = 2048,
      h = 256
    const src = new Float64Array(w * h)
    for (let y = 0; y < h; y++) src[y * w] = 1

    for (const sigma of [0.7, 1.5]) {
      const out = blurSpherical(src, w, h, sigma)
      const v = (y: number): number => {
        let acc = 0
        for (let x = 0; x < w; x++) {
          const d = out[y * w + ((x + 1) % w)] - out[y * w + x]
          acc += d * d
        }
        return acc / Math.cos(rowLatitude(y, h)) ** 3
      }
      const limit = (85 * Math.PI) / 180
      let worst = 0
      for (let y = 1; y < h; y++) {
        if (Math.abs(rowLatitude(y, h)) >= limit || Math.abs(rowLatitude(y - 1, h)) >= limit) continue
        worst = Math.max(worst, Math.abs(Math.log(v(y) / v(y - 1))))
      }
      expect(worst, `σ=${sigma}`).toBeLessThan(0.05)
    }
  })
})

describe('extendedBoxParams: нечисловые σ', () => {
  it('σ ≤ 0 и NaN — тождество', () => {
    expect(extendedBoxParams(0, 10)).toEqual({ m: 0, alpha: 0 })
    expect(extendedBoxParams(-1, 10)).toEqual({ m: 0, alpha: 0 })
    expect(extendedBoxParams(Number.NaN, 10)).toEqual({ m: 0, alpha: 0 })
  })

  it('σ = ∞ и σ² = ∞ — потолок, без конечного потолка — ошибка', () => {
    expect(extendedBoxParams(Number.POSITIVE_INFINITY, 7)).toEqual({ m: 7, alpha: 0 })
    expect(extendedBoxParams(1e200, 7)).toEqual({ m: 7, alpha: 0 })
    expect(() => extendedBoxParams(Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY)).toThrow(/потолка/)
  })
})
