import { PerspectiveCamera } from 'three'
import { AtmosphereEffect } from '@/core/graphic/effects/atmosphere/AtmosphereEffect'
import {
  buildAtmosphereEffectFragment,
  buildSlotGlsl
} from '@/core/graphic/effects/atmosphere/atmosphereSlotShader'
import { AtmosphereRegistry } from '@/core/services/AtmosphereRegistry'

describe('Атмосфера: дебаг-виды слагаемых', () => {
  it('uniform uDebugView объявлен и в uniforms эффекта, и в шейдере', () => {
    const effect = new AtmosphereEffect(new PerspectiveCamera(), new AtmosphereRegistry())

    expect(effect.uniforms.get('uDebugView')).toBeDefined()
    expect(effect.uniforms.get('uDebugView')!.value).toBe(0)
    expect(buildAtmosphereEffectFragment()).toContain('uniform float uDebugView')
  })

  it('дебаг-ветка отдаёт сырые слагаемые ДО колена (диагностика без искажений)', () => {
    const src = buildSlotGlsl(0)
    const debugBranch = src.indexOf('uDebugView > 0.5')
    const knee = src.indexOf('excess * uSlot0_hdrKnee')

    expect(debugBranch).toBeGreaterThan(-1)
    expect(knee).toBeGreaterThan(-1)
    expect(debugBranch).toBeLessThan(knee)
  })

  it('вид 1 — сырая радиантность на экспозиции, вид 2 — трансмиттанс', () => {
    const src = buildSlotGlsl(0)

    expect(src).toContain('radiance * uSlot0_exposure')
    expect(src).toContain('uDebugView < 2.5 ? transmittance')
  })

  it('инвариант колена не сломан (кросс-чек с PostprocessingContract)', () => {
    expect(buildSlotGlsl(0)).toContain('min(scatter, vec3(1.0)) + excess * uSlot0_hdrKnee')
  })
})
