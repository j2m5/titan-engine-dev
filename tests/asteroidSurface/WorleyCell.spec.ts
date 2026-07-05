import { noiseFunctions } from '@/core/materials/shaders/lib/chunks/Noise'

describe('Noise chunk: worleyCell', () => {
  it('определяет расширенный Worley с out-направлением', () => {
    expect(noiseFunctions).toContain('vec4 worleyCell(vec3 P, out vec3 toNearest)')
  })

  it('переиспользует примитивы cellular (permute/mod289)', () => {
    const body = noiseFunctions.slice(noiseFunctions.indexOf('vec4 worleyCell'))
    expect(body).toContain('cellular_permute(')
    expect(body).toContain('cellular_mod289(')
  })

  it('не ломает существующий cellular3d (регресс-замок под Nebula)', () => {
    expect(noiseFunctions).toContain('vec2 cellular3d(vec3 P)')
  })
})
