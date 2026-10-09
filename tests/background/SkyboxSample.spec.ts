import { AppShaderChunk } from '@/core/materials/shaders/lib/chunks'
import { createSkyboxSampleUniforms, skyboxSampleFunctions, skyboxSampleUniforms } from '@/core/materials/shaders/lib/chunks/SkyboxSample'
import { background } from '@/config/background'
import { RawShaderMaterial } from 'three'
import { BlackHoleShaderTemplate } from '@/core/renderables/BlackHole/BlackHoleShaderTemplate'
import { BlackHoleMaterial } from '@/core/renderables/BlackHole/BlackHoleMaterial'
import { BlackHoleParameters } from '@/core/renderables/BlackHole/BlackHoleParameters'
import { SkyboxBackground } from '@/core/renderables/SkyboxBackground'
import { createSkyUniforms } from '@/core/materials/shaders/lib/chunks/SkySample'
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
    // Верхняя граница — уровень 2 из 255 в линейном свете (та же формула
    // sRGB-декода, что и в докблоке background.ts): полоса Млечного Пути
    // начинается с уровня 2, пьедестал обязан остаться СТРОГО внутри уровня 1
    const level2Linear = 2 / 255 / 12.92
    expect(background.background.floor).toBeGreaterThan(0)
    expect(background.background.floor).toBeLessThan(level2Linear)
  })
})

describe('Чёрная дыра: небо через общий чанк', () => {
  const source = BlackHoleShaderTemplate.fragmentShader

  it('подключает чанки неба и не сэмплит кубмапу сама', () => {
    expect(source).toContain('#include <skySampleUniforms>')
    expect(source).toContain('#include <skySampleFunctions>')
    expect(source).not.toContain('sampleSkyboxHdr(')
    expect(source).not.toContain('texture(skybox,')
  })

  it('фон и ЧД ссылаются на одни и те же экземпляры юниформов неба', () => {
    const skyboxBackground = new SkyboxBackground(null)
    const blackHoleMaterial = new BlackHoleMaterial(new BlackHoleParameters(stubBlackHoleActor()))
    const bgUniforms = (skyboxBackground.material as RawShaderMaterial).uniforms

    for (const key of Object.keys(createSkyUniforms())) {
      expect(blackHoleMaterial.uniforms[key]).toBe(bgUniforms[key])
    }
    blackHoleMaterial.dispose()
  })
})

describe('Контракт юниформов общий у обоих потребителей', () => {
  it('каждый юниформ, объявленный в skyboxSampleUniforms, есть среди ключей фабрики, и наоборот', () => {
    // Удаление объявления не ловится ни регистрацией чанков, ни телом функции,
    // ни проводкой из конфига: GLSL молча падает на компиляции с undeclared
    // identifier у ОБОИХ потребителей — чёрный фон и не собравшийся материал ЧД
    const declaredNames = Array.from(skyboxSampleUniforms.matchAll(/uniform\s+\w+\s+(\w+)\s*;/g))
      .map(match => match[1])
      .sort()
    const factoryKeys = Object.keys(createSkyboxSampleUniforms()).sort()

    expect(declaredNames).toEqual(factoryKeys)
  })

  it('фабрика возвращает свежие Uniform-инстансы при каждом вызове', () => {
    const a = createSkyboxSampleUniforms()
    const b = createSkyboxSampleUniforms()

    expect(a.uSkyHighlightThreshold).not.toBe(b.uSkyHighlightThreshold)
    expect(a.uSkyHighlightBoost).not.toBe(b.uSkyHighlightBoost)
    expect(a.uSkyFlipX).not.toBe(b.uSkyFlipX)
  })
})
