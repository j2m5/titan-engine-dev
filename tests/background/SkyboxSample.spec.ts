import { CubeTexture, RawShaderMaterial } from 'three'
import { AppShaderChunk } from '@/core/materials/shaders/lib/chunks'
import { createSkyboxSampleUniforms, skyboxSampleFunctions, skyboxSampleUniforms } from '@/core/materials/shaders/lib/chunks/SkyboxSample'
import { background } from '@/config/background'
import { BlackHoleShaderTemplate } from '@/core/renderables/BlackHole/BlackHoleShaderTemplate'
import { BlackHoleMaterial } from '@/core/renderables/BlackHole/BlackHoleMaterial'
import { BlackHoleParameters } from '@/core/renderables/BlackHole/BlackHoleParameters'
import { SkyboxBackground } from '@/core/renderables/SkyboxBackground'
import { Actor } from '@/core/models/Actor'

/**
 * Мышиный actor: BlackHoleParameters читает только physicalObject.mass —
 * тот же приём, что в tests/blackHole/BlackHoleBackgroundSource.spec.ts
 */
function stubBlackHoleActor(): Actor {
  return {
    physicalObject: {
      getAttribute: (key: string, def?: unknown): unknown => (key === 'mass' ? 8.54e36 : def)
    },
    renderingObject: null,
    getAttribute: (key: string, def?: unknown): unknown => (key === 'name' ? 'Sagittarius A*' : def)
  } as unknown as Actor
}

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
    expect(skyboxSampleFunctions).toContain('excess * (uSkyHighlightBoost - 1.0)')
  })

  it('расширение включено: подобранная на приёмке сила', () => {
    expect(background.background.highlightBoost).toBe(9)
  })

  it('порог конфига в допустимом диапазоне', () => {
    expect(background.background.highlightThreshold).toBeGreaterThan(0)
    expect(background.background.highlightThreshold).toBeLessThanOrEqual(1)
  })

  it('подъём вычитает пьедестал с отсечкой в ноль и умножает остаток', () => {
    // Вычитание, а не гладкий множитель: пустое небо стоит на уровнях 0–1, и
    // только отсечка в ноль оставляет космос чёрным при подъёме полосы
    expect(skyboxSampleFunctions).toContain('max(raw - uSkyFloor, vec3(0.0)) * uSkyGain')
  })

  it('порог хайлайтов меряется по ИСХОДНОЙ выборке, а не по поднятой', () => {
    // Иначе множитель сдвигает смысл порога: под расширение попадает втрое
    // больше пикселей, звёзды блумят там, где раньше не блумили, а замеренное
    // значение порога приходится искать заново
    expect(skyboxSampleFunctions).toContain('max(raw - uSkyHighlightThreshold, vec3(0.0))')
    expect(skyboxSampleFunctions).not.toContain('lifted - uSkyHighlightThreshold')
  })

  it('в кадр уходит поднятая выборка, а не исходная', () => {
    expect(skyboxSampleFunctions).toContain('lifted + excess * (uSkyHighlightBoost - 1.0)')
  })

  it('подъём включён: множитель больше единицы', () => {
    // 1 означает выключенный подъём — отгружать так нельзя, иначе арка
    // не делает ничего
    expect(background.background.gain).toBeGreaterThan(1)
  })

  it('пьедестал мал и положителен — это уровень 1 из 255, а не элемент вида', () => {
    expect(background.background.floor).toBeGreaterThan(0)
    expect(background.background.floor).toBeLessThan(0.01)
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
    expect(source).not.toContain('texture(skybox, vec3(')
  })

  it('ориентация линзированного пути — общий юниформ uSkyFlipX, не своя копия', () => {
    // Отдельной ручки envMapFlipX здесь нет:
    // её убрали, потому что разный знак флипа у двух потребителей одной
    // кубмапы зеркалит линзированное небо относительно окружающего.
    // Ручка ориентации осталась, но теперь общая с прямым фоном
    expect(source).toContain('sampleSkyboxHdr(skybox, direction, uSkyFlipX)')
    expect(source).not.toContain('envMapFlipX')
  })
})

describe('Контракт юниформов общий у обоих потребителей', () => {
  it('фабрика возвращает свежие Uniform-инстансы при каждом вызове', () => {
    const a = createSkyboxSampleUniforms()
    const b = createSkyboxSampleUniforms()

    expect(a.uSkyHighlightThreshold).not.toBe(b.uSkyHighlightThreshold)
    expect(a.uSkyHighlightBoost).not.toBe(b.uSkyHighlightBoost)
    expect(a.uSkyFlipX).not.toBe(b.uSkyFlipX)
  })

  it('прямой фон и линзированный путь ЧД получают один и тот же набор ключей с одинаковыми значениями', () => {
    const skyboxBackground = new SkyboxBackground(new CubeTexture())
    const blackHoleMaterial = new BlackHoleMaterial(new BlackHoleParameters(stubBlackHoleActor()))

    const bgUniforms = (skyboxBackground.material as RawShaderMaterial).uniforms
    const bhUniforms = blackHoleMaterial.uniforms

    for (const key of ['uSkyHighlightThreshold', 'uSkyHighlightBoost', 'uSkyFloor', 'uSkyGain', 'uSkyFlipX']) {
      expect(bgUniforms[key]).toBeDefined()
      expect(bhUniforms[key]).toBeDefined()
      expect(bgUniforms[key].value).toBe(bhUniforms[key].value)
    }
  })

  it('значения приходят из конфига фона, а не подобраны вручную по месту', () => {
    const skyboxBackground = new SkyboxBackground(new CubeTexture())
    const uniforms = (skyboxBackground.material as RawShaderMaterial).uniforms

    expect(uniforms.uSkyHighlightThreshold.value).toBe(background.background.highlightThreshold)
    expect(uniforms.uSkyHighlightBoost.value).toBe(background.background.highlightBoost)
    expect(uniforms.uSkyFloor.value).toBe(background.background.floor)
    expect(uniforms.uSkyGain.value).toBe(background.background.gain)
  })
})
