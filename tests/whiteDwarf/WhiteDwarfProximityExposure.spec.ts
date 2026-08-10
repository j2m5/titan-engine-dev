import { describe, it, expect } from 'vitest'
import { PerspectiveCamera, Scene, WebGLRenderer, Group } from 'three'
import { frameCoverage, proximityExposure } from '@/core/renderables/WhiteDwarf/proximityExposure'
import { wdShade, WD_HDR_CEILING } from './whiteDwarfSurfaceMirror'
import { planckX } from '@/core/materials/shaders/lib/helpers'
import { WhiteDwarfShaderTemplate } from '@/core/renderables/WhiteDwarf/WhiteDwarfShaderTemplate'
import { WhiteDwarfImpostorShaderTemplate } from '@/core/renderables/WhiteDwarf/WhiteDwarfImpostorShaderTemplate'
import { Actor } from '@/core/models/Actor'
import { WhiteDwarf } from '@/core/renderables/WhiteDwarf/WhiteDwarf'
import { config } from '@/core/framework/config'
import { toThreeJSUnits } from '@/core/helpers/scaling'

const FLOOR = 0.45
const START = 0.1
const END = 0.65

describe('proximityExposure — кривая адаптации', () => {
  it('ниже start единица РОВНО, а не приближённо', () => {
    // Страж неизменности дальнего вида: вся калибровка арки карлика жива
    // байт-в-байт, пока диск мал в кадре
    expect(proximityExposure(0, FLOOR, START, END)).toBe(1)
    expect(proximityExposure(START, FLOOR, START, END)).toBe(1)
    expect(proximityExposure(START * 0.5, FLOOR, START, END)).toBe(1)
  })

  it('выше end ровно floor', () => {
    expect(proximityExposure(END, FLOOR, START, END)).toBe(FLOOR)
    expect(proximityExposure(1, FLOOR, START, END)).toBe(FLOOR)
    // Камера внутри тела: coverage >> 1, пол держится
    expect(proximityExposure(100, FLOOR, START, END)).toBe(FLOOR)
  })

  it('между порогами монотонно не возрастает', () => {
    let previous = 1
    for (let i = 0; i <= 20; i++) {
      const value = proximityExposure(START + ((END - START) * i) / 20, FLOOR, START, END)
      expect(value).toBeLessThanOrEqual(previous)
      previous = value
    }
  })

  it('непрерывна на обоих краях', () => {
    const epsilon = 1e-6
    expect(proximityExposure(START + epsilon, FLOOR, START, END)).toBeCloseTo(1, 5)
    expect(proximityExposure(END - epsilon, FLOOR, START, END)).toBeCloseTo(FLOOR, 5)
  })

  it('floor = 1 даёт тождественную единицу — точка отката', () => {
    for (const coverage of [0, START, (START + END) / 2, END, 3]) {
      expect(proximityExposure(coverage, 1, START, END)).toBe(1)
    }
  })
})

describe('frameCoverage — доля кадра', () => {
  it('точка прилёта radius*3 при fov 50 даёт около 0.71', () => {
    // Ориентир из спеки: дистанция до центра 3R, высота кадра 2*tan(25°)*3R
    const radius = 2.93
    expect(frameCoverage(radius, radius * 3, 50)).toBeCloseTo(0.7147, 3)
  })

  it('нулевая дистанция не делит на ноль', () => {
    expect(Number.isFinite(frameCoverage(1, 0, 50))).toBe(true)
  })
})

describe('wdShade — экспозиция после потолка', () => {
  it('умножает КЛИПОВАННОЕ значение, а не вход клипа', () => {
    // Sirius B прибит к потолку всей поверхностью: с exposure 0.5 обязан выйти
    // ровно в полпотолка. Умножь exposure до min — вышло бы min(вход/2, 32),
    // то есть для пробившего потолок тела те же 32, и спад не работал бы
    const clipped = wdShade(1, [1, 1, 1], planckX(25200), 1000, 0.5)
    clipped.forEach((value: number) => expect(value).toBe(WD_HDR_CEILING * 0.5))
  })

  it('exposure = 1 воспроизводит прежний выход — точка отката', () => {
    // mu = 1: лимб ровно единица, остаётся min(intensity, потолок)
    const result = wdShade(1, [1, 1, 1], planckX(11820), 40, 1)
    expect(result).toEqual([32, 32, 32])
  })
})

describe('юниформ uProximityExposure', () => {
  it('есть в обоих шаблонах с нейтральной единицей', () => {
    expect(WhiteDwarfShaderTemplate.uniforms.uProximityExposure.value).toBe(1)
    expect(WhiteDwarfImpostorShaderTemplate.uniforms.uProximityExposure.value).toBe(1)
  })
})

function exposureStubActor(): Actor {
  return {
    getAttribute: (key: string, def?: unknown): unknown => (key === 'name' ? 'G29-38' : def),
    renderingObject: { getAttribute: () => ({}) },
    physicalObject: {
      getAttribute: (key: string, def?: unknown): unknown =>
        key === 'radius' ? 8840 : key === 'temperature' ? 11820 : def
    }
  } as unknown as Actor
}

/** Прогон onBeforeRender с камерой на заданной дистанции (в радиусах тела) */
function exposureAt(body: WhiteDwarf, distanceRadii: number): number {
  const camera = new PerspectiveCamera(50, 1, 0.1, 1e9)
  camera.position.set(0, 0, toThreeJSUnits(8840) * distanceRadii)
  camera.updateMatrixWorld()
  body.updateMatrixWorld()
  body.onBeforeRender(
    {} as WebGLRenderer,
    {} as Scene,
    camera,
    body.geometry,
    body.material,
    null as unknown as Group
  )

  return body.material.uniforms.uProximityExposure.value as number
}

describe('onBeforeRender тела — прокси-экспозиция', () => {
  it('вдали единица ровно', () => {
    // coverage на 100R = 2/(100*2*tan(25)) ~ 0.021 — глубоко ниже start
    expect(exposureAt(new WhiteDwarf(exposureStubActor()), 100)).toBe(1)
  })

  it('в середине кривой экспозиция строго между полом и единицей', () => {
    // 5R -> coverage = 1/(5*tan(25 гр.)) ~ 0.43 — между start 0.1 и end 0.65.
    // Точка прилёта (3R, coverage ~0.71) при стартовом end уже лежит на полу,
    // поэтому середина кривой проверяется здесь, а пол — тестом ниже
    const value = exposureAt(new WhiteDwarf(exposureStubActor()), 5)
    expect(value).toBeLessThan(1)
    expect(value).toBeGreaterThan(config('whiteDwarf.proximityExposureFloor'))
  })

  it('вплотную держит пол из конфига', () => {
    expect(exposureAt(new WhiteDwarf(exposureStubActor()), 1.05)).toBe(
      config('whiteDwarf.proximityExposureFloor')
    )
  })

  it('ортографическая камера прохода не трогает юниформ', () => {
    // Проходы вне главного цикла (пост-эффекты) не должны сбивать экспозицию
    const body = new WhiteDwarf(exposureStubActor())
    exposureAt(body, 1.05)
    const before = body.material.uniforms.uProximityExposure.value
    body.onBeforeRender(
      {} as WebGLRenderer,
      {} as Scene,
      new (class { isPerspectiveCamera = false })() as unknown as PerspectiveCamera,
      body.geometry,
      body.material,
      null as unknown as Group
    )
    expect(body.material.uniforms.uProximityExposure.value).toBe(before)
  })
})
