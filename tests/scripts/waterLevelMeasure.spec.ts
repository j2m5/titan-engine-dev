import { describe, expect, it } from 'vitest'
import {
  confusionCounts,
  otsuThreshold,
  precisionRecallF1,
  resampleNearest
} from '../../scripts/lib/waterLevelMeasure'

describe('otsuThreshold: бимодальный порог на гистограмме blueness', () => {
  it('чёткая бимодальная гистограмма: порог ложится в седловину между модами', () => {
    // мода «суша» вокруг 0 (±3), мода «вода» вокруг 30 (±3) — раздел заведомо
    // между 3 и 27
    const values: number[] = []
    for (let i = 0; i < 200; i++) values.push(-3 + (i % 7))
    for (let i = 0; i < 200; i++) values.push(27 + (i % 7))

    const { threshold, fractionAbove } = otsuThreshold(Int16Array.from(values))

    // пустой промежуток 4..26 — межклассовая дисперсия одинакова на любом
    // пороге внутри него, первый достигнутый максимум (верхний край нижней
    // моды) и побеждает: седловина — весь промежуток [3, 27), не точка
    expect(threshold).toBeGreaterThanOrEqual(3)
    expect(threshold).toBeLessThan(27)
    // ровно половина входа выше порога — обе моды равного размера
    expect(fractionAbove).toBeCloseTo(0.5, 5)
  })

  it('несимметричные моды: перевес по массе не смещает порог за пределы седловины', () => {
    const values: number[] = []
    for (let i = 0; i < 900; i++) values.push(-2 + (i % 5)) // большая мода «суша»
    for (let i = 0; i < 100; i++) values.push(28 + (i % 5)) // малая мода «вода»

    const { threshold, fractionAbove } = otsuThreshold(Int16Array.from(values))

    expect(threshold).toBeGreaterThanOrEqual(2)
    expect(threshold).toBeLessThan(28)
    expect(fractionAbove).toBeCloseTo(0.1, 2)
  })

  it('вырожденный вход (один класс, второй изначально пуст): порог на левом крае диапазона, все значения выше', () => {
    const values = new Int16Array(50).fill(5)

    const { threshold, fractionAbove } = otsuThreshold(values)

    expect(threshold).toBe(-255)
    expect(fractionAbove).toBe(1)
  })
})

describe('resampleNearest: ближайший сосед по полутекселным центрам', () => {
  it('совпадающие размеры — identity-копия, не alias исходного буфера', () => {
    const src = Uint8Array.from([1, 2, 3, 4, 5, 6, 7, 8])
    const out = resampleNearest(src, 2, 2, 2, 2, 2)

    expect(Array.from(out)).toEqual(Array.from(src))

    out[0] = 255
    expect(src[0]).toBe(1) // копия — правка результата не трогает вход
  })

  it('известный случай 4×4 → 2×2 (1 канал): выборка по формуле u=(x+0.5)/width', () => {
    // src[y][x] = y*4+x — значение кодирует координату источника
    const src = Uint8Array.from({ length: 16 }, (_, i) => i)

    const out = resampleNearest(src, 4, 4, 1, 2, 2)

    // dst(0,0): u=v=0.25 → sx=sy=floor(0.25*4)=1 → src(1,1)=5
    // dst(1,0): u=0.75 → sx=3, v=0.25 → sy=1           → src(3,1)=7
    // dst(0,1): u=0.25 → sx=1, v=0.75 → sy=3           → src(1,3)=13
    // dst(1,1): u=v=0.75 → sx=sy=3                     → src(3,3)=15
    expect(Array.from(out)).toEqual([5, 7, 13, 15])
  })

  it('многоканальный вход: все каналы текселя переносятся вместе', () => {
    // 2×2, 3 канала — тексель (1,1) = [40,41,42]
    const src = Uint8Array.from([0, 0, 0, 10, 10, 10, 20, 20, 20, 40, 41, 42])

    const out = resampleNearest(src, 2, 2, 3, 1, 1)

    // dst(0,0) единственный: u=v=0.5 → sx=sy=floor(0.5*2)=1 → тексель (1,1)
    expect(Array.from(out)).toEqual([40, 41, 42])
  })
})

describe('confusionCounts + precisionRecallF1: согласие классификатора на известных матрицах', () => {
  it('смешанная матрица: precision/recall/F1 сходятся с ручным расчётом', () => {
    // tp=3, fp=1, fn=2
    const predicted = [1, 1, 1, 1, 0, 0]
    const actual = [1, 1, 1, 0, 1, 1]

    const counts = confusionCounts(predicted, actual)
    expect(counts).toEqual({ tp: 3, fp: 1, fn: 2 })

    const { precision, recall, f1 } = precisionRecallF1(counts)
    expect(precision).toBeCloseTo(3 / 4, 10)
    expect(recall).toBeCloseTo(3 / 5, 10)
    expect(f1).toBeCloseTo((2 * (3 / 4) * (3 / 5)) / (3 / 4 + 3 / 5), 10)
  })

  it('идеальное совпадение: precision=recall=F1=1', () => {
    const mask = [1, 0, 1, 1, 0]
    const { precision, recall, f1 } = precisionRecallF1(confusionCounts(mask, mask))

    expect(precision).toBe(1)
    expect(recall).toBe(1)
    expect(f1).toBe(1)
  })

  it('ничего не предсказано и ничего не размечено (tp=fp=fn=0): P=R=F1=0, не NaN', () => {
    const zeros = [0, 0, 0, 0]
    const { precision, recall, f1 } = precisionRecallF1(confusionCounts(zeros, zeros))

    expect(precision).toBe(0)
    expect(recall).toBe(0)
    expect(f1).toBe(0)
  })

  it('всё предсказано, ничего не размечено (fn=0, tp=0): recall=0 (не 1) — пустое множество фактов не значит полный охват', () => {
    const predicted = [1, 1, 1]
    const actual = [0, 0, 0]

    const { precision, recall, f1 } = precisionRecallF1(confusionCounts(predicted, actual))

    expect(precision).toBe(0)
    expect(recall).toBe(0)
    expect(f1).toBe(0)
  })
})
