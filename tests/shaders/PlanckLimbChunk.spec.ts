import { describe, it, expect } from 'vitest'
import { planckLimb as planckLimbChunk } from '@/core/materials/shaders/lib/chunks/PlanckLimb'
import { whiteDwarfSurface } from '@/core/materials/shaders/lib/chunks/WhiteDwarfSurface'
import { AppShaderChunk } from '@/core/materials/shaders/lib/chunks'
import { WhiteDwarfShaderTemplate } from '@/core/renderables/WhiteDwarf/WhiteDwarfShaderTemplate'
import { WhiteDwarfImpostorShaderTemplate } from '@/core/renderables/WhiteDwarf/WhiteDwarfImpostorShaderTemplate'
import { planckX } from '@/core/materials/shaders/lib/helpers'
import { planckLimb, PLANCK_LIMB_EDDINGTON_TAU } from '../helpers/planckLimbMirror'

describe('чанк planckLimb', () => {
  it('зарегистрирован в реестре', () => {
    expect(AppShaderChunk.planckLimb).toBe(planckLimbChunk)
  })

  it('константа GLSL синхронизирована с зеркалом', () => {
    expect(planckLimbChunk).toContain(`#define PLANCK_LIMB_EDDINGTON_TAU ${PLANCK_LIMB_EDDINGTON_TAU}`)
  })

  it('sOne считается выражением, а не литералом', () => {
    // Иначе центр диска перестаёт быть ровно единицей
    expect(planckLimbChunk).toContain('float sOne = pow(0.75 * (1.0 + PLANCK_LIMB_EDDINGTON_TAU), 0.25);')
  })

  it('формула одна: у белого карлика своей копии нет', () => {
    expect(whiteDwarfSurface).not.toContain('vec3 wdLimb(')
    expect(whiteDwarfSurface).toContain('planckLimb(mu, planckX)')
  })

  it('оба шаблона карлика подключают planckLimb ДО своего чанка', () => {
    // prepareSource не рекурсивен: зависимость подключает потребитель
    for (const template of [WhiteDwarfShaderTemplate, WhiteDwarfImpostorShaderTemplate]) {
      const limb: number = template.fragmentShader.indexOf('#include <planckLimb>')
      const surface: number = template.fragmentShader.indexOf('#include <whiteDwarfSurface>')

      expect(limb).toBeGreaterThanOrEqual(0)
      expect(limb).toBeLessThan(surface)
    }
  })

  it('холодная звезда темнеет к лимбу сильно и хроматически', () => {
    // 3700 K — режим Вина: кромка уходит в багровый
    const [r, , b] = planckLimb(0, planckX(3700))

    expect(r).toBeCloseTo(0.206, 2)
    expect(b).toBeCloseTo(0.122, 2)
  })
})
