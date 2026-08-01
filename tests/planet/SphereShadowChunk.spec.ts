import { AppShaderChunk } from '@/core/materials/shaders/lib/chunks'
import { sphereShadowFunctions } from '@/core/materials/shaders/lib/chunks/SphereShadow'
import { RingShaderTemplate } from '@/core/materials/shaders/lib/RingShaderTemplate'

describe('SphereShadow: общий чанк тени планеты', () => {
  it('чанк зарегистрирован — иначе include молча раскроется в пустоту', () => {
    expect(AppShaderChunk.sphereShadowFunctions).toBe(sphereShadowFunctions)
  })

  it('сохранены умбра 0.04 и полутень 8% радиуса', () => {
    expect(sphereShadowFunctions).toContain('float getShadowFromSphere(vec3 lightDirLocal, vec3 ringPosLocal, float planetRadius)')
    expect(sphereShadowFunctions).toContain('planetRadius * 0.08')
    expect(sphereShadowFunctions).toContain('mix(0.04, 1.0, shade)')
  })

  it('кольцо перешло на общий чанк, своей копии не осталось', () => {
    expect(RingShaderTemplate.fragmentShader).toContain('#include <sphereShadowFunctions>')
    expect(RingShaderTemplate.fragmentShader).not.toContain('float getShadowFromSphere(vec3 lightDirLocal')
  })
})
