import { RingShaderTemplate } from '@/core/materials/shaders/lib/RingShaderTemplate'
import { ring } from '@/config/ring'
import { RING_OPPOSITION_G } from './ringScatterMirror'

describe('RingShaderTemplate: рассеяние', () => {
  it('ветвления по стороне кольца больше нет — формула одна на обе стороны', () => {
    // Прежний if давал скачок яркости при переходе камеры через плоскость
    expect(RingShaderTemplate.fragmentShader).not.toContain('if (lightIntensity < 0.0)')
    expect(RingShaderTemplate.fragmentShader).not.toContain('lightIntensity')
  })

  it('варьинги, которые кормили только ветвление, убраны из обоих шейдеров', () => {
    // vNormal жил ради corrNormal, vWorldPosition — ради lightIntensity
    expect(RingShaderTemplate.fragmentShader).not.toContain('vNormal')
    expect(RingShaderTemplate.fragmentShader).not.toContain('vWorldPosition')
    expect(RingShaderTemplate.vertexShader).not.toContain('vNormal')
    expect(RingShaderTemplate.vertexShader).not.toContain('vWorldPosition')
  })

  it('плоской добавки яркости нет — она кладёт пол под инверсию', () => {
    expect(RingShaderTemplate.fragmentShader).not.toContain('finalColor += 0.05')
  })

  it('прошедший свет гаснет с оптической толщей, отражённый насыщается', () => {
    expect(RingShaderTemplate.fragmentShader).toContain('float transmit = exp(-tau)')
    expect(RingShaderTemplate.fragmentShader).toContain('float reflectance = 1.0 - transmit')
  })

  it('оптическая толща берётся из альфы текстуры — плотность уже там', () => {
    expect(RingShaderTemplate.fragmentShader).toContain('uRingDensityExtinction * color.a')
  })

  it('показатель обратного лепестка совпадает с числом в CPU-зеркале', () => {
    // Зеркало и GLSL обязаны считать одно и то же
    expect(RingShaderTemplate.fragmentShader).toContain(`#define RING_OPPOSITION_G ${RING_OPPOSITION_G}`)
  })
})

describe('Конфиг кольца', () => {
  it('затухание по плотности включено — иначе инверсии нет', () => {
    expect(ring.ring.densityExtinction).toBeGreaterThan(0)
  })

  it('рассеяние вперёд в диапазоне, где фаза не вырождается', () => {
    expect(ring.ring.forwardScattering).toBeGreaterThan(0)
    expect(ring.ring.forwardScattering).toBeLessThan(1)
  })
})
