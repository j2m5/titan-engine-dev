import { AppShaderChunk } from '@/core/materials/shaders/lib/chunks'
import { skyboxSampleFunctions, skyboxSampleUniforms } from '@/core/materials/shaders/lib/chunks/SkyboxSample'
import { background } from '@/config/background'

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

  it('дефолт конфига нейтрален: boost 1 не меняет картинку', () => {
    expect(background.background.highlightBoost).toBe(1)
  })

  it('порог конфига в допустимом диапазоне', () => {
    expect(background.background.highlightThreshold).toBeGreaterThan(0)
    expect(background.background.highlightThreshold).toBeLessThanOrEqual(1)
  })
})
