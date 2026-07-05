import { noiseFunctions } from '@/core/materials/shaders/lib/chunks/Noise'

describe('Noise chunk: snoiseGrad', () => {
  it('определяет производный симплекс, возвращающий vec4(value, gradient)', () => {
    expect(noiseFunctions).toContain('vec4 snoiseGrad(vec3 v)')
  })

  it('переиспользует существующие примитивы шума (permute/taylorInvSqrt)', () => {
    const body = noiseFunctions.slice(noiseFunctions.indexOf('vec4 snoiseGrad'))
    expect(body).toContain('permute(')
    expect(body).toContain('taylorInvSqrt(')
  })
})
