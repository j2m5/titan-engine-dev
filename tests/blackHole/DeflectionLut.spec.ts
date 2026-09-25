import { HalfFloatType, LinearFilter } from 'three'
import {
  DEFLECTION_LUT_B_MIN,
  DEFLECTION_LUT_SIZE,
  bakeDeflectionAngles,
  bakeOutsideAngles,
  chordDeflectionAngle,
  createDeflectionLutTexture,
  createOutsideLutTexture,
  farFieldDeflection,
  outsideDeflection
} from '@/core/renderables/BlackHole/deflectionLut'
import { BlackHoleShaderTemplate } from '@/core/renderables/BlackHole/BlackHoleShaderTemplate'
import { BlackHoleMaterial } from '@/core/renderables/BlackHole/BlackHoleMaterial'
import { BlackHoleParameters } from '@/core/renderables/BlackHole/BlackHoleParameters'
import { blackHole } from '@/config/blackHole'
import { Actor } from '@/core/models/Actor'

const SIMULATION_RS = 27
const DPHI = blackHole.blackHole.integrationDphi

/** Узел i в единицах прицельного параметра — та же краевая формула, что в печке */
function lutB(index: number): number {
  return (
    DEFLECTION_LUT_B_MIN + (index / (DEFLECTION_LUT_SIZE - 1)) * (SIMULATION_RS - DEFLECTION_LUT_B_MIN)
  )
}

// Мышиный actor: BlackHoleParameters читает physicalObject.mass и опциональные
// атрибуты — тот же приём, что tests/blackHole/BlackHoleBackgroundSource.spec.ts
function stubActor(): Actor {
  return {
    physicalObject: {
      getAttribute: (key: string, def?: unknown): unknown => (key === 'mass' ? 8.54e36 : def)
    },
    renderingObject: null,
    getAttribute: (key: string, def?: unknown): unknown => (key === 'name' ? 'Sagittarius A*' : def)
  } as unknown as Actor
}

describe('bakeDeflectionAngles: печка угла отклонения', () => {
  const angles = bakeDeflectionAngles(SIMULATION_RS, DPHI)

  it('домен покрыт без дыр: длина, конечность, неотрицательность', () => {
    expect(angles.length).toBe(DEFLECTION_LUT_SIZE)

    for (const angle of angles) {
      expect(Number.isFinite(angle)).toBe(true)
      expect(angle).toBeGreaterThanOrEqual(0)
    }
  })

  it('слабое поле: дальше от дыры — слабее отклонение', () => {
    for (let i = 1; i < angles.length; i++) {
      expect(angles[i]).toBeLessThanOrEqual(angles[i - 1] + 1e-6)
    }
  })

  it('LUT — ПОЛНОЕ отклонение: на краю зоны совпадает с рядом дальнего поля (стык с экранным проходом < 0.5 px)', () => {
    // Снаружи меша кадр сдвигает GravitationalLensEffect по ряду farFieldDeflection;
    // последний узел LUT читается ровно на b = simulationRs
    expect(Math.abs(angles[DEFLECTION_LUT_SIZE - 1] - farFieldDeflection(SIMULATION_RS))).toBeLessThan(2e-4)
  })

  it('ряд дальнего поля: b = 26.92 rs → 0.07863 рад (эталон интегратора Бине со старта 2e4 rs)', () => {
    expect(farFieldDeflection(26.92)).toBeCloseTo(0.07863, 4)
    expect(farFieldDeflection(1000)).toBeCloseTo(2 / 1000, 5)
  })

  it('паритет на b = 8: LUT ≈ хорда живого интегратора (старт с кромки) + наружная добавка δ(8)', () => {
    // Геодезическая ветка шейдера интегрирует от кромки сферы и прибавляет δ(b);
    // LUT-ветка читает полное отклонение — на общей границе они обязаны сойтись
    // с точностью секущей последнего шага живого интегратора (~2e-4)
    const chord = chordDeflectionAngle(DEFLECTION_LUT_B_MIN, SIMULATION_RS, DPHI)
    const total = chord + outsideDeflection(DEFLECTION_LUT_B_MIN, SIMULATION_RS, DPHI)

    expect(chord).toBeGreaterThan(0.25)
    expect(Math.abs(angles[0] - total)).toBeLessThan(1e-5)
  })

  it('перецеливание на входе: хорда — почти всё полное отклонение (b = 8: наружная часть < 1 %)', () => {
    const chord = chordDeflectionAngle(DEFLECTION_LUT_B_MIN, SIMULATION_RS, DPHI)
    expect(Math.abs(angles[0] - chord) / angles[0]).toBeLessThan(0.01)
  })

  it('наружная добавка δ(b) на области геодезической ветки (b ≤ diskOuter + 1.5 ≈ 17): мала, ниже захвата — 0', () => {
    const outside = bakeOutsideAngles(SIMULATION_RS, DPHI)

    expect(outside.length).toBe(DEFLECTION_LUT_SIZE)
    expect(outsideDeflection(0, SIMULATION_RS, DPHI)).toBe(0)
    expect(outsideDeflection(2.5, SIMULATION_RS, DPHI)).toBe(0)
    for (const b of [3, 4, 6, 8, 12, 17]) {
      // δ компенсирует и наружную часть, и погрешность секущей живого интегратора — поэтому знак любой
      expect(Math.abs(outsideDeflection(b, SIMULATION_RS, DPHI))).toBeLessThan(0.01)
    }
    expect(outsideDeflection(8, SIMULATION_RS, DPHI)).toBeGreaterThan(0)
  })

  it('текстура δ(b): тот же формат, что у основной LUT', () => {
    const texture = createOutsideLutTexture(SIMULATION_RS, DPHI)

    expect(texture.image.width).toBe(DEFLECTION_LUT_SIZE)
    expect(texture.type).toBe(HalfFloatType)
    expect(texture.minFilter).toBe(LinearFilter)
    expect(texture.name).toBe('BlackHole.OutsideLut')
    texture.dispose()
  })

  it('санити против аналитики слабого поля при b ≈ 12: полное отклонение в пределах 15 %', () => {
    let index = 0
    for (let i = 0; i < DEFLECTION_LUT_SIZE; i++) {
      if (Math.abs(lutB(i) - 12) < Math.abs(lutB(index) - 12)) index = i
    }
    const b = lutB(index)
    const legacy = 2 / b + 2.945243 / (b * b)

    expect(Math.abs(angles[index] - legacy) / legacy).toBeLessThan(0.15)
  })

  it('вырожденная зона (simulationRs ≤ B_MIN): нули, а не мусор', () => {
    // LUT-ветка в шейдере при таком радиусе недостижима (b ≤ simulationRs < B_MIN)
    expect(bakeDeflectionAngles(DEFLECTION_LUT_B_MIN, DPHI)).toEqual(new Float32Array(DEFLECTION_LUT_SIZE))
  })
})

describe('createDeflectionLutTexture: формат текстуры', () => {
  it('256×1, half-float, линейная фильтрация, без мипмапов', () => {
    const texture = createDeflectionLutTexture(SIMULATION_RS, DPHI)

    expect(texture.image.width).toBe(DEFLECTION_LUT_SIZE)
    expect(texture.image.height).toBe(1)
    expect(texture.type).toBe(HalfFloatType)
    expect(texture.magFilter).toBe(LinearFilter)
    expect(texture.minFilter).toBe(LinearFilter)
    expect(texture.generateMipmaps).toBe(false)

    texture.dispose()
  })
})

describe('шейдер ЧД: аналитика слабого поля заменена LUT-веткой', () => {
  const frag: string = BlackHoleShaderTemplate.fragmentShader

  it('полином, окно и кроссфейд удалены', () => {
    expect(frag).not.toContain('2.945243')
    expect(frag).not.toContain('BLEND_BAND')
    expect(frag).not.toContain('analyticBlend')
    expect(frag).not.toContain('edgeWindow')
  })

  it('LUT объявлен и сэмплируется по домену [WEAK_FIELD_B, simulationRs]', () => {
    expect(frag).toContain('uniform highp sampler2D deflectionLut;')
    expect(frag).toContain('texture(deflectionLut,')
    expect(frag).toContain('(b - WEAK_FIELD_B) / (simulationRs - WEAK_FIELD_B)')
  })

  it('выборка совмещает сетку по краям с центрами текселей', () => {
    expect(frag).toContain('(0.5 + t * 255.0) / 256.0')
    // 255/256 в шейдере обязаны быть (SIZE-1)/SIZE — литералы, но с поводком
    expect(DEFLECTION_LUT_SIZE).toBe(256)
  })

  it('нижняя граница домена LUT равна WEAK_FIELD_B шейдера — несущий инвариант шва', () => {
    const match = frag.match(/const\s+float\s+WEAK_FIELD_B\s*=\s*([0-9.]+)/)

    expect(match).not.toBeNull()
    expect(Number(match![1])).toBe(DEFLECTION_LUT_B_MIN)
  })

  it('вход снаружи перецеливается в локальное направление: u′ = √(1 − t²(1 − 1/r0)) / (t·r0); камера внутри — прежнее условие', () => {
    expect(frag).toContain('sqrt(max(1.0 - tangential * tangential * (1.0 - 1.0 / r0), 0.0)) / (tangential * r0)')
    expect(frag).toContain('-radial / (r0 * tangential)')
  })

  it('при побеге снаружи-вошедшего луча направление доворачивается на δ(b) из OutsideLut', () => {
    expect(frag).toContain('uniform highp sampler2D outsideLut;')
    expect(frag).toContain('texture(outsideLut, vec2((0.5 + (b / simulationRs) * 255.0) / 256.0, 0.5)).r')
    expect(frag).toMatch(/cos\(delta\) \* escape \+ sin\(delta\) \* inward/)
    expect(frag).toContain('traceGeodesic(cameraRs, rayDir, tEnter, b, crossings)')
  })
})

describe('BlackHoleMaterial: проводка LUT', () => {
  it('текстура создана при конструировании и освобождается dispose материала', () => {
    // RawShaderMaterial.dispose текстуры юниформов не разбирает — LUT живёт
    // только здесь, и без override.dispose утекала бы на каждой пересборке
    const material = new BlackHoleMaterial(new BlackHoleParameters(stubActor()))
    const lut = material.uniforms.deflectionLut.value

    expect(lut).not.toBeNull()
    expect(lut.image.width).toBe(DEFLECTION_LUT_SIZE)

    const onDispose = vi.fn()
    lut.addEventListener('dispose', onDispose)

    material.dispose()

    expect(onDispose).toHaveBeenCalledOnce()
  })

  it('вторая таблица δ(b) создана и освобождается вместе с первой', () => {
    const material = new BlackHoleMaterial(new BlackHoleParameters(stubActor()))
    const outside = material.uniforms.outsideLut.value

    expect(outside).not.toBeNull()
    expect(outside.name).toBe('BlackHole.OutsideLut')

    const onDispose = vi.fn()
    outside.addEventListener('dispose', onDispose)
    material.dispose()

    expect(onDispose).toHaveBeenCalledOnce()
  })
})
