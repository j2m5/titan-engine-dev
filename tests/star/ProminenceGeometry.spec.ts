import { BufferAttribute, BufferGeometry } from 'three'
import {
  PROMINENCE_RIBBON_COUNT,
  PROMINENCE_SEGMENTS_PER_RIBBON,
  buildProminenceGeometry
} from '@/core/renderables/utils/prominenceGeometry'

function attribute(geometry: BufferGeometry, name: string): BufferAttribute {
  return geometry.getAttribute(name) as BufferAttribute
}

function maxIndex(geometry: BufferGeometry): number {
  const indices = geometry.getIndex()!.array
  let max = -1
  for (let i = 0; i < indices.length; i++) max = Math.max(max, indices[i])
  return max
}

describe('buildProminenceGeometry: размеры и индексы', () => {
  it('вершин и индексов ровно столько, сколько лент и сегментов', () => {
    // Лента — полоса из двух рядов вершин; на стык соседних сегментов
    // приходится два треугольника, последний сегмент замыкать не с чем
    const geometry = buildProminenceGeometry({ ribbonCount: 8, segmentsPerRibbon: 4 })

    expect(attribute(geometry, 'aRibbon').count).toBe(8 * 4 * 2)
    expect(geometry.getIndex()!.count).toBe(8 * (4 - 1) * 6)
  })

  it('индексы 32-битные: 16 бит упирались в потолок ровно на дефолтах', () => {
    // 2048 * 16 * 2 = 65536 вершин, максимальный индекс 65535 — последнее
    // число, представимое в Uint16Array. Одна лишняя лента заворачивала
    // индексы в начало буфера, молча и без ошибки
    const geometry = buildProminenceGeometry()

    expect(geometry.getIndex()!.array).toBeInstanceOf(Uint32Array)
  })

  it('на дефолтных параметрах индексы покрывают вершины ровно до последней', () => {
    const geometry = buildProminenceGeometry()
    const vertexCount = attribute(geometry, 'aRibbon').count

    expect(vertexCount).toBe(PROMINENCE_RIBBON_COUNT * PROMINENCE_SEGMENTS_PER_RIBBON * 2)
    expect(maxIndex(geometry)).toBe(vertexCount - 1)
  })

  it('вдвое больше лент, чем влезало в Uint16, строится без заворачивания', () => {
    // 4096 лент — 131072 вершины: прежний буфер завернул бы хвост в ноль
    const geometry = buildProminenceGeometry({ ribbonCount: 4096 })

    expect(attribute(geometry, 'aRibbon').count).toBe(131072)
    expect(maxIndex(geometry)).toBe(131071)
  })
})

describe('buildProminenceGeometry: содержимое атрибутов', () => {
  const geometry = buildProminenceGeometry({ ribbonCount: 16, segmentsPerRibbon: 4 })

  it('aRibbon: фаза строго внутри дуги, сторона ±1', () => {
    const ribbon = attribute(geometry, 'aRibbon')

    expect(ribbon.itemSize).toBe(2)

    for (let i = 0; i < ribbon.count; i++) {
      expect(ribbon.getX(i)).toBeGreaterThan(0)
      expect(ribbon.getX(i)).toBeLessThan(1)
      expect(Math.abs(ribbon.getY(i))).toBe(1)
    }
  })

  it('основания петли — единичные направления', () => {
    // Шейдер считает их направлениями на единичной сфере: длина ≠ 1 увела бы
    // ленты внутрь звезды или наружу от поверхности
    const footA = attribute(geometry, 'aFootA')
    const footB = attribute(geometry, 'aFootB')

    expect(footA.itemSize).toBe(3)
    expect(footB.itemSize).toBe(3)

    for (let i = 0; i < footA.count; i++) {
      expect(Math.hypot(footA.getX(i), footA.getY(i), footA.getZ(i))).toBeCloseTo(1, 6)
      expect(Math.hypot(footB.getX(i), footB.getY(i), footB.getZ(i))).toBeCloseTo(1, 6)
    }
  })

  it('случайные ленты лежат в [0, 1)', () => {
    const random = attribute(geometry, 'aRibbonRandom')

    expect(random.itemSize).toBe(3)

    for (let i = 0; i < random.count; i++) {
      for (const value of [random.getX(i), random.getY(i), random.getZ(i)]) {
        expect(value).toBeGreaterThanOrEqual(0)
        expect(value).toBeLessThan(1)
      }
    }
  })

  it('две стороны сегмента противоположны и делят основания и случайные ленты', () => {
    // Иначе полоса расслаивается: у её краёв разные дуга и цвет. Стороны
    // проверяются поимённо — окажись обе +1, лента схлопнулась бы в нулевую
    // ширину, а прежняя проверка |side| == 1 этого не заметила бы
    const ribbon = attribute(geometry, 'aRibbon')
    const footA = attribute(geometry, 'aFootA')
    const footB = attribute(geometry, 'aFootB')
    const random = attribute(geometry, 'aRibbonRandom')

    for (let pair = 0; pair < ribbon.count / 2; pair++) {
      const left = pair * 2
      const right = left + 1

      expect(ribbon.getY(left)).toBe(-1)
      expect(ribbon.getY(right)).toBe(1)

      // Все три компонента, а не один: рассинхрон курсора записи кратно трём
      // проскочил бы мимо проверки по одной координате
      for (const buffer of [footA, footB, random]) {
        expect(buffer.getX(left)).toBe(buffer.getX(right))
        expect(buffer.getY(left)).toBe(buffer.getY(right))
        expect(buffer.getZ(left)).toBe(buffer.getZ(right))
      }
    }
  })
})
