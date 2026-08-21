import { PerspectiveCamera } from 'three'
import { AtmosphereEffect } from '@/core/graphic/effects/atmosphere/AtmosphereEffect'
import { buildSlotGlsl, slotUniformName } from '@/core/graphic/effects/atmosphere/atmosphereSlotShader'
import { AtmosphereRegistry } from '@/core/services/AtmosphereRegistry'

describe('AtmosphereEffect: линейный HDR-выход (тонмап — в постобработке)', () => {
  const slot: string = buildSlotGlsl(0)

  it('самотонмап 1-exp(...) убран из слота', () => {
    // Кривая 1-e^-x давала бы двойной тонмаппинг поверх общего AgX
    expect(slot).not.toContain('exp(-radiance')
    expect(slot).not.toContain('1.0 - exp(')
  })

  it('линейный выход, колено HDR-избытка и потолок 64 — в этом порядке', () => {
    const linearIdx: number = slot.indexOf('vec3 scatter = radiance * uSlot0_exposure;')
    const kneeIdx: number = slot.indexOf('excess * uSlot0_hdrKnee')
    const ceilIdx: number = slot.indexOf('min(scatter, vec3(64.0))')
    expect(linearIdx).toBeGreaterThan(-1)
    expect(kneeIdx).toBeGreaterThan(linearIdx)
    expect(ceilIdx).toBeGreaterThan(kneeIdx)
  })

  it('hdrKnee объявлен юниформом слота с нейтральным дефолтом 1.0', () => {
    expect(slot).toContain('uniform float uSlot0_hdrKnee;')
    expect(slot).toContain('uniform float uSlot0_exposure;')
    const effect = new AtmosphereEffect(new PerspectiveCamera(), new AtmosphereRegistry())
    expect(effect.uniforms.get(slotUniformName(0, 'hdrKnee'))!.value).toBe(1)
  })
})
