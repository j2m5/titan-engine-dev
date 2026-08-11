import { describe, it, expect } from 'vitest'
import { Vector3 } from 'three'
import { Actors, RenderingObjects } from '@storage/database'
import { NebulaField } from '@/core/renderables/Nebula/fields/NebulaField'
import { nebulaParamsFromData, type NebulaRenderingData } from '@/core/renderables/Nebula/NebulaRenderingData'
import { makeDefaultNebulaParams, type NebulaParams } from '@/core/renderables/Nebula/NebulaParams'

/**
 * Форма туманности Helix проверяется ПОЛЕМ, а не пинами на числа в данных.
 *
 * NebulaField — CPU-зеркало того же поля плотности, что считает шейдер, поэтому
 * «внутри пусто, в оболочке плотно» можно спросить напрямую. Пин на
 * `cavities[0].strength === 1` пережил бы, например, смену радиуса каверны на
 * величину, при которой полость схлопывается.
 */
function helixData(): NebulaRenderingData {
  const actor = Actors.find((a) => a.name === 'Helix Nebula')
  expect(actor, 'актор туманности Helix не найден').toBeDefined()

  const row = RenderingObjects.find((r) => r.actorId === actor!.id)
  expect(row, 'у туманности Helix нет renderingObject').toBeDefined()

  return row!.data as NebulaRenderingData
}

/** Плотность на доле r от полуразмера, вдоль экватора */
function densityAtRadius(field: NebulaField, r: number): number {
  return field.sampleDensity(new Vector3(r, 0, 0))
}

describe('туманность Helix — форма', () => {
  const params: NebulaParams = nebulaParamsFromData(helixData())
  const field: NebulaField = new NebulaField(params)

  it('это оболочка, а не плоский диск', () => {
    // Диск с вертикальной отсечкой вдвое круче радиальной читался блином, и
    // наклонённую структуру он бы срезал. Возврат к 'disk' — возврат к унынию
    expect(params.shape).toBe('ellipsoid')
    expect(params.axisRatios.y).toBeGreaterThan(0.7)
  })

  it('плотность пикует в СРЕДНЕМ слое — это и есть определение оболочки', () => {
    // Главная проверка формы, и она не про числа каверн, а про профиль: у
    // заполненного облака максимум в центре, у оболочки — в кольцевом слое.
    // Замер при написании: пик 0.64 на r = 0.6..0.7, центр ровно 0
    const radii: number[] = Array.from({ length: 21 }, (_, i) => i * 0.05)
    const profile: number[] = radii.map((r) => densityAtRadius(field, r))
    const peak: number = Math.max(...profile)
    const peakRadius: number = radii[profile.indexOf(peak)]

    expect(field.sampleDensity(new Vector3(0, 0, 0))).toBeLessThan(0.02)
    expect(peakRadius).toBeGreaterThanOrEqual(0.45)
    expect(peakRadius).toBeLessThanOrEqual(0.85)
    // Оболочка обязана быть веществом, а не дымкой
    expect(peak).toBeGreaterThan(0.3)
  })

  it('экватор плотнее меридиана — с полюса читается кольцом', () => {
    // Сплюснутость по axisRatios.y даёт кольцевой вид при взгляде с полюса, но
    // объём при этом остаётся. Замер: на r = 0.8 экватор 0.23 против 0.06
    const equator: number = field.sampleDensity(new Vector3(0.8, 0, 0))
    const meridian: number = field.sampleDensity(new Vector3(0, 0.8, 0))

    expect(equator).toBeGreaterThan(meridian * 2)
  })

  it('за внешней границей вещества нет', () => {
    expect(densityAtRadius(field, 1.05)).toBe(0)
  })

  it('плотность нигде не вырождается в NaN', () => {
    // Пара «две перемножающиеся каверны» — самый вероятный источник
    // отрицательной плотности, если у кого-то strength уедет выше единицы
    for (let r = 0; r <= 1; r += 0.05) {
      const d: number = densityAtRadius(field, r)

      expect(Number.isFinite(d)).toBe(true)
      expect(d).toBeGreaterThanOrEqual(0)
      expect(d).toBeLessThanOrEqual(1)
    }
  })
})

describe('туманность Helix — узлы и запекание', () => {
  const params: NebulaParams = nebulaParamsFromData(helixData())
  const defaults: NebulaParams = makeDefaultNebulaParams()

  it('филаменты включены прорезанием стенок Ворлея', () => {
    expect(params.noise.worleyStrength).toBeGreaterThan(defaults.noise.worleyStrength)
    expect(params.noise.ridged).toBe(1)
  })

  it('поднятая частота идёт В ПАРЕ с поднятым разрешением запекания', () => {
    // Несущая связка, и она не очевидна из данных. Поле запекается один раз в
    // 3D-текстуру (UnsignedByteType + RedFormat, байт на воксель), и на
    // дефолтных 128^3 предел Найквиста лежит НИЖЕ того, что дают повышенная
    // частота с Ворлеем: поднять один шум — получить не тонкие узлы, а алиасную
    // кашу. Разведи эти два числа — и правка молча ухудшит картинку
    expect(params.noise.frequency).toBeGreaterThan(defaults.noise.frequency)
    expect(params.quality.bakeResolution).toBeGreaterThan(defaults.quality.bakeResolution)
  })

  it('контраст не выходит за предел восьмибитного запекания', () => {
    // pow(contrast) применяется ДО квантования в байт, поэтому выше ~2.6
    // разреженная периферия начинает полосить. Это ограничение формата, а не вкуса
    expect(params.noise.contrast).toBeLessThanOrEqual(2.6)
  })
})
