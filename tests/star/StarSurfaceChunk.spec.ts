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

  it('несёт формулы поверхности: fbm 6/0.9, ремап ×4, энергия, лимб', () => {
    expect(starSurface).toContain('float fbm(')
    expect(starSurface).toContain('0.5 + fbm(noisePos, 6, 0.9) * 4.0')
    expect(starSurface).toContain('mix(0.55, 3.0, t)')
    expect(starSurface).toContain('limbCoeff * (1.0 - mu)')
  })

  it('диск собирается с чанком: include резолвится в текст чанка', () => {
    const shader = new StarShader(stubActor())

    expect(shader.fragmentShader).toContain('float starGranulationT(')
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

  it('фейд гаснет к нулю на мелких ячейках', () => {
    // Ячейка базовой октавы ≈ 1 единица домена: 0.15 — примерно 6.7 px,
    // 0.6 — 1.7 px, ниже которых зерно всё равно было бы алиасингом
    expect(starSurface).toContain('float starGranulationFade(')
    expect(starSurface).toContain('1.0 - smoothstep(0.15, 0.6, domainPerPixel)')
  })

  it('погашенная грануляция даёт ровно среднюю ячейку t = 0.5', () => {
    // 0.5 — базовый спектральный цвет и середина энергии mix(0.55, 3.0, t):
    // при гашении пропадает зерно, а не средняя яркость диска
    expect(starSurface).toContain('float starGranulationT(vec4 noisePos, float fade)')
    expect(starSurface).toContain('if (fade <= 0.0) return 0.5;')
    expect(starSurface).toContain('mix(0.5, clamp(0.5 + fbm(noisePos, 6, 0.9) * 4.0, 0.0, 1.0), fade)')
  })
})
