import { describe, it, expect } from 'vitest'
import { Vector3 } from 'three'
import {
  makeDefaultNebulaParams,
  mergeNebulaParams,
  NEBULA_SHAPE_IDS,
  type NebulaShape,
  type NebulaParams
} from '@/core/renderables/Nebula/NebulaParams'
import { NebulaField } from '@/core/renderables/Nebula/fields/NebulaField'
import { nebulaDensityChunk } from '@/core/renderables/Nebula/material/shader/chunks/NebulaDensity'
import { createNebulaUniforms } from '@/core/renderables/Nebula/material/shader/raymarch.template'
import { applyDensityUniforms } from '@/core/renderables/Nebula/material/densityUniforms'
import { nebulaParamsFromData } from '@/core/renderables/Nebula/NebulaRenderingData'

/**
 * Силуэт проверяется ПОЛЕМ, а не пинами на числа: NebulaField — CPU-зеркало той
 * же границы, что считает шейдер, поэтому «где вещество есть, а где его нет»
 * можно спросить напрямую. Пин на формулу пережил бы, например, потерю знака.
 */
function fieldFor(shape: NebulaShape, overrides: Partial<NebulaParams> = {}): NebulaField {
  return new NebulaField(mergeNebulaParams({ shape, edgeFalloff: 0.2, ...overrides }))
}

/** Граница в точке; имена осей — как у прокси */
function at(field: NebulaField, x: number, y: number, z: number): number {
  return field.boundary(new Vector3(x, y, z))
}

describe('форма: оболочка', () => {
  const field = fieldFor('shell', { shapeThickness: 0.3 })

  it('центр пуст, стенка плотная, снаружи пусто', () => {
    expect(at(field, 0, 0, 0)).toBe(0)
    expect(at(field, 0.85, 0, 0)).toBeGreaterThan(0.5)
    expect(at(field, 1.2, 0, 0)).toBe(0)
  })

  it('пуста во ВСЕХ направлениях, а не только вдоль одной оси', () => {
    // Ловит подмену сферической полости цилиндрической
    for (const dir of [new Vector3(1, 0, 0), new Vector3(0, 1, 0), new Vector3(0, 0, 1)]) {
      expect(field.boundary(dir.clone().multiplyScalar(0.3))).toBe(0)
    }
  })
})

describe('форма: тор', () => {
  const field = fieldFor('torus', { shapeThickness: 0.3 })

  it('вещество на кольце, пусто и в центре, и на полюсах', () => {
    // Полюса — то, чем тор отличается от оболочки: у оболочки там стенка
    expect(at(field, 0.7, 0, 0)).toBeGreaterThan(0.5)
    expect(at(field, 0, 0, 0.7)).toBeGreaterThan(0.5)
    expect(at(field, 0, 0, 0)).toBe(0)
    expect(at(field, 0, 0.95, 0)).toBe(0)
  })

  it('кольцо осесимметрично', () => {
    const a: number = at(field, 0.7, 0, 0)
    const b: number = at(field, 0.7 * Math.SQRT1_2, 0, 0.7 * Math.SQRT1_2)

    expect(b).toBeCloseTo(a, 6)
  })
})

describe('форма: песочные часы', () => {
  const field = fieldFor('hourglass', { shapeThickness: 0.25 })

  it('талия на экваторе уже, чем лепестки у полюсов', () => {
    // Определение биполярности: на ОДНОМ И ТОМ ЖЕ радиусе в XZ вещество есть
    // выше по оси и отсутствует на экваторе.
    //
    // Высота взята с запасом до полюса: дефолтный axisRatios.y = 0.8, поэтому
    // y = 0.8 — это уже сама граница, где обрывается любая форма, и сравнение
    // там ничего не сказало бы о талии
    const radius: number = 0.35

    expect(at(field, radius, 0, 0)).toBe(0)
    expect(at(field, radius, 0.5, 0)).toBeGreaterThan(0.5)
  })

  it('ось талии совпадает с осью Y, а вещество вдоль неё есть', () => {
    expect(at(field, 0, 0.5, 0)).toBeGreaterThan(0.5)
    expect(at(field, 0.2, 0, 0)).toBeGreaterThan(0.5)
  })
})

describe('поворот формы', () => {
  it('поворот на 90 градусов вокруг X кладёт кольцо тора в другую плоскость', () => {
    // Самая прямая проверка того, что поворот вообще применяется, а не съедается
    const flat = fieldFor('torus', { shapeThickness: 0.3 })
    const tilted = fieldFor('torus', {
      shapeThickness: 0.3,
      shapeRotation: new Vector3(Math.PI / 2, 0, 0)
    })

    // Ось X лежит в плоскости кольца при обоих поворотах
    expect(at(tilted, 0.7, 0, 0)).toBeCloseTo(at(flat, 0.7, 0, 0), 6)

    // А Z и Y меняются ролями
    expect(at(flat, 0, 0, 0.7)).toBeGreaterThan(0.5)
    expect(at(flat, 0, 0.7, 0)).toBe(0)
    expect(Math.max(at(tilted, 0, 0.7, 0), at(tilted, 0, -0.7, 0))).toBeGreaterThan(0.5)
    expect(at(tilted, 0, 0, 0.7)).toBe(0)
  })

  it('нулевой поворот тождественен — старые сцены не двигаются', () => {
    const params: NebulaParams = makeDefaultNebulaParams()

    expect(params.shapeRotation.equals(new Vector3(0, 0, 0))).toBe(true)
    expect(new NebulaField(params).boundary(new Vector3(0.4, 0.2, 0.1))).toBeCloseTo(
      new NebulaField(mergeNebulaParams({ shapeRotation: new Vector3(0, 0, 0) })).boundary(
        new Vector3(0.4, 0.2, 0.1)
      ),
      12
    )
  })

  it('поворот применяется ДО сплющивания — форма мнётся по своим осям', () => {
    // Иначе наклонённый тор сплющивался бы не по своей нормали, а по оси прокси
    expect(nebulaDensityChunk).toContain('vec3 a = (uShapeRotation * p) * uInvAxis;')
  })
})

describe('обратная совместимость и проводка', () => {
  it('прежние формы сохранили свои коды', () => {
    // Коды уезжают в uShape числами; вставка новой формы в середину сдвинула бы
    // все последующие и молча переназначила формы уже заведённым туманностям
    expect(NEBULA_SHAPE_IDS.ellipsoid).toBe(0)
    expect(NEBULA_SHAPE_IDS.disk).toBe(1)
  })

  it('эллипсоид и диск считаются ровно как раньше', () => {
    // Толщина к ним не применяется вовсе, поэтому её значение не должно на них влиять
    const thin = fieldFor('disk', { shapeThickness: 0.05 })
    const thick = fieldFor('disk', { shapeThickness: 0.9 })

    expect(at(thin, 0.5, 0.1, 0.2)).toBeCloseTo(at(thick, 0.5, 0.1, 0.2), 12)
  })

  it('толщина клампится — ноль делил бы на ноль в торе', () => {
    expect(mergeNebulaParams({ shapeThickness: 0 }).shapeThickness).toBeGreaterThan(0)
    expect(mergeNebulaParams({ shapeThickness: 5 }).shapeThickness).toBeLessThan(1)
  })

  it('код формы и толщина доезжают до юниформов', () => {
    const uniforms = createNebulaUniforms()

    applyDensityUniforms(uniforms, mergeNebulaParams({ shape: 'hourglass', shapeThickness: 0.4 }))

    expect(uniforms.uShape.value).toBe(NEBULA_SHAPE_IDS.hourglass)
    expect(uniforms.uShapeThickness.value).toBeCloseTo(0.4, 12)
  })

  it('углы поворота приходят из данных в ГРАДУСАХ', () => {
    const params: NebulaParams = nebulaParamsFromData({ shape: 'torus', shapeRotation: [90, 0, 0] })

    expect(params.shapeRotation.x).toBeCloseTo(Math.PI / 2, 9)
  })
})
