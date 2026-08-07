import { HalfFloatType, LinearFilter } from 'three'
import {
  DEFLECTION_LUT_B_MIN,
  DEFLECTION_LUT_SIZE,
  bakeDeflectionAngles,
  createDeflectionLutTexture
} from '@/core/renderables/BlackHole/deflectionLut'
import { BlackHoleShaderTemplate } from '@/core/renderables/BlackHole/BlackHoleShaderTemplate'
import { BlackHoleMaterial } from '@/core/renderables/BlackHole/BlackHoleMaterial'
import { BlackHoleParameters } from '@/core/renderables/BlackHole/BlackHoleParameters'
import { blackHole } from '@/config/blackHole'
import { Actor } from '@/core/models/Actor'

const SIMULATION_RS = 27
const DPHI = blackHole.blackHole.integrationDphi

/** Центр текселя i в единицах прицельного параметра — та же формула, что в печке */
function lutB(index: number): number {
  return (
    DEFLECTION_LUT_B_MIN + ((index + 0.5) / DEFLECTION_LUT_SIZE) * (SIMULATION_RS - DEFLECTION_LUT_B_MIN)
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

  it('на краю зоны отклонение сходит в ноль — бесшовность с фоном вне меша', () => {
    expect(angles[DEFLECTION_LUT_SIZE - 1]).toBeLessThan(0.01)
  })

  it('санити против прежней аналитики: тот же порядок величины при b ≈ 12', () => {
    // Полная старая форма: полином слабого поля × окно хорды (edgeWindow при
    // таком b равен 1). НЕ пин равенства — LUT честнее аналитики; допуск
    // широкий и ловит только грубую поломку печки (знак, единицы, домен)
    let index = 0
    for (let i = 0; i < DEFLECTION_LUT_SIZE; i++) {
      if (Math.abs(lutB(i) - 12) < Math.abs(lutB(index) - 12)) index = i
    }
    const b = lutB(index)
    const x = b / SIMULATION_RS
    const legacy = (2 / b + 2.945243 / (b * b)) * Math.sqrt(1 - x * x)

    expect(Math.abs(angles[index] - legacy) / legacy).toBeLessThan(0.15)
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
    expect(frag).toContain('uniform sampler2D deflectionLut;')
    expect(frag).toContain('texture(deflectionLut,')
    expect(frag).toContain('(b - WEAK_FIELD_B) / (simulationRs - WEAK_FIELD_B)')
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
})
