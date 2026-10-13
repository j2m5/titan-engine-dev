import { AppShaderChunk } from '@/core/materials/shaders/lib/chunks'
import { starSurface } from '@/core/materials/shaders/lib/chunks/StarSurface'
import { StarShader } from '@/core/materials/shaders/StarShader'
import { StarShaderTemplate } from '@/core/materials/shaders/lib/StarShaderTemplate'
import { Actor } from '@/core/models/Actor'

function stubActor(): Actor {
  return {
    getAttribute: (key: string, def?: unknown): unknown => def,
    physicalObject: {
      getAttribute: (key: string, def?: unknown): unknown => (key === 'temperature' ? 5700 : def)
    }
  } as unknown as Actor
}

describe('чанк starSurface: одна формула поверхности на оба LOD', () => {
  it('зарегистрирован в AppShaderChunk', () => {
    // Диск включает чанк через #include <starSurface>, который резолвит
    // AbstractShader.prepareSource по этому реестру
    expect(AppShaderChunk.starSurface).toBe(starSurface)
  })

  it('диск собирается с чанком: include резолвится в текст чанка', () => {
    const shader = new StarShader(stubActor())

    expect(shader.fragmentShader).toContain('vec3 starGranulationRadiance(')
    expect(shader.fragmentShader).not.toContain('#include <starSurface>')
  })

  it('шаблон диска не держит собственной копии формул', () => {
    // Дубль формулы — это будущая рассинхронизация LOD при первой правке
    expect(StarShaderTemplate.fragmentShader).toContain('#include <starSurface>')
    expect(StarShaderTemplate.fragmentShader).not.toContain('float fbm(')
  })
})

describe('чанк starSurface: гашение грануляции с расстоянием', () => {
  it('несёт экранную меру домена шума — общую для обоих LOD', () => {
    // Мера в единицах домена на пиксель, а не в километрах до камеры: она не
    // зависит ни от радиуса звезды, ни от fov, ни от высоты окна, поэтому на
    // дистанции переключения диск и билборд гаснут одинаково по построению
    expect(starSurface).toContain('float starDomainPerPixel(')
    expect(starSurface).toContain('max(length(dFdx(domainPos)), length(dFdy(domainPos)))')
  })

  // Численное поведение фильтра проверяют granulationFiltering.gpu.ts и
  // granulationPhotometry.gpu.ts: сравнение с усреднённым полным спектром.
})
