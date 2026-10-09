import { AppShaderChunk } from '@/core/materials/shaders/lib/chunks'
import { createSkyboxSampleUniforms, skyboxSampleFunctions, skyboxSampleUniforms } from '@/core/materials/shaders/lib/chunks/SkyboxSample'
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
