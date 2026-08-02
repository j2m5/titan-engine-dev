import { AppShaderChunk } from '@/core/materials/shaders/lib/chunks'
import { skyboxSampleFunctions, skyboxSampleUniforms } from '@/core/materials/shaders/lib/chunks/SkyboxSample'
import { background } from '@/config/background'
import { BlackHoleShaderTemplate } from '@/core/renderables/BlackHole/BlackHoleShaderTemplate'

describe('SkyboxSample: общая выборка фона с расширением хайлайтов', () => {
  it('чанки зарегистрированы — иначе include молча раскроется в пустоту', () => {
    expect(AppShaderChunk.skyboxSampleFunctions).toBe(skyboxSampleFunctions)
    expect(AppShaderChunk.skyboxSampleUniforms).toBe(skyboxSampleUniforms)
  })

  it('сигнатура принимает флип по X — ориентацию задаёт вызывающая сторона', () => {
    expect(skyboxSampleFunctions).toContain(
      'vec3 sampleSkyboxHdr(samplerCube tex, vec3 direction, float flipX)'
    )
  })

  it('ниже порога расширение тождественно — небо целиком не светлеет', () => {
    expect(skyboxSampleFunctions).toContain('max(raw - uSkyHighlightThreshold, vec3(0.0))')
    expect(skyboxSampleFunctions).toContain('raw + excess * (uSkyHighlightBoost - 1.0)')
  })

  it('расширение включено: подобранная на приёмке сила', () => {
    expect(background.background.highlightBoost).toBe(9)
  })

  it('порог конфига в допустимом диапазоне', () => {
    expect(background.background.highlightThreshold).toBeGreaterThan(0)
    expect(background.background.highlightThreshold).toBeLessThanOrEqual(1)
  })
})

describe('Чёрная дыра: линзированный фон через общий чанк', () => {
  const source = BlackHoleShaderTemplate.fragmentShader

  it('подключает чанки выборки', () => {
    expect(source).toContain('#include <skyboxSampleUniforms>')
    expect(source).toContain('#include <skyboxSampleFunctions>')
  })

  it('зовёт общую функцию и не сэмплит кубмапу сам', () => {
    expect(source).toContain('sampleSkyboxHdr(skybox,')
    expect(source).not.toContain('texture(skybox, vec3(envMapFlipX * direction.x, direction.yz))')
  })

  it('ориентация линзированного пути осталась своей ручкой', () => {
    expect(source).toContain('uniform float envMapFlipX;')
  })
})
