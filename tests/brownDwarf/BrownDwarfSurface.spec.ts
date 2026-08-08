import { AppShaderChunk } from '@/core/materials/shaders/lib/chunks'
import { brownDwarfSurface } from '@/core/materials/shaders/lib/chunks/BrownDwarfSurface'
import {
  bdBreath,
  bdCompose,
  bdShade,
  bdTauEff,
  bdTransmit,
  CLOUD_TONE_BASE,
  CLOUD_TONE_RANGE,
  HDR_CEILING
} from './brownDwarfSurfaceMirror'

describe('чанк brownDwarfSurface: композиция через пропускание', () => {
  it('зарегистрирован в AppShaderChunk', () => {
    expect(AppShaderChunk.brownDwarfSurface).toBe(brownDwarfSurface)
  })

  it('пропускание монотонно убывает по толще', () => {
    const samples = [0, 0.5, 1, 2, 4, 8].map((tau) => bdTransmit(tau))

    for (let i = 1; i < samples.length; i++) {
      expect(samples[i]).toBeLessThan(samples[i - 1])
    }
  })

  it('нулевая толща открывает нутро целиком', () => {
    expect(bdCompose(0.2, 9, bdTransmit(0))).toBeCloseTo(9)
  })

  it('большая толща оставляет только палубу', () => {
    expect(bdCompose(0.2, 9, bdTransmit(20))).toBeCloseTo(0.2, 5)
  })

  it('лимб набирает толщу: tauEff растёт при падении mu', () => {
    const center = bdTauEff(0.5, 1, 3)
    const edge = bdTauEff(0.5, 0.1, 3)

    expect(edge).toBeGreaterThan(center)
    // на самом лимбе прогалины закрыты полностью
    expect(bdTransmit(bdTauEff(0.5, 1e-4, 3))).toBeCloseTo(0, 6)
  })

  it('tauEff не даёт NaN на вырожденном mu', () => {
    expect(Number.isFinite(bdTauEff(0.5, 0, 3))).toBe(true)
  })
})

describe('дыхание яркости: пересев формы невозможен', () => {
  const amplitude = 0.08
  const dirs = [
    [1, 0, 0],
    [0, 1, 0],
    [0, 0, 1],
    [0.577, 0.577, 0.577]
  ]

  it('лежит в [1-a, 1+a] при любом времени, включая скачки', () => {
    // Скачки времени — сценарий фриза: фоновая вкладка, CDP-скриншот, GC.
    // Прошлая арка умерла на том, что такой скачок пересеивал УЗОР; здесь
    // время физически не может выйти за амплитуду и не трогает форму.
    const times = [0, 0.016, 1, 60, 3600, 1e6, -1e6]

    for (const t of times) {
      for (const dir of dirs) {
        const value = bdBreath(dir, t, amplitude)

        expect(value).toBeGreaterThanOrEqual(1 - amplitude - 1e-9)
        expect(value).toBeLessThanOrEqual(1 + amplitude + 1e-9)
      }
    }
  })

  it('нулевая амплитуда делает объект полностью статичным по яркости', () => {
    expect(bdBreath([1, 0, 0], 12345, 0)).toBe(1)
  })
})

describe('bdShade: единственная точка композиции на оба LOD', () => {
  it('совпадает с ручной сборкой из примитивов', () => {
    const field: [number, number] = [0.4, 0.7]
    const manual = bdCompose(
      0.2 * (CLOUD_TONE_BASE + CLOUD_TONE_RANGE * field[1]),
      9 * 2 * bdBreath([1, 0, 0], 5, 0.08),
      bdTransmit(bdTauEff(field[0], 0.8, 3))
    )

    expect(bdShade(field, 0.8, [1, 0, 0], 0.2, 9, 3, 2, 5, 0.08)).toBeCloseTo(Math.min(manual, HDR_CEILING), 10)
  })

  it('держит потолок HDR', () => {
    // Открытая прогалина с абсурдной яркостью нутра упирается в потолок
    expect(bdShade([0, 1], 1, [1, 0, 0], 0, 1e6, 3, 1, 0, 0)).toBe(HDR_CEILING)
  })

  it('объявлена в чанке', () => {
    expect(brownDwarfSurface).toContain('vec3 bdShade(')
  })
})

describe('структурный контракт: время отрезано от формы', () => {
  it('в толщу время не входит', () => {
    // Единственная функция чанка, принимающая время, — bdBreath. Если время
    // появится в bdTauEff или bdTransmit, вернётся механизм прошлого дефекта.
    const tauEff = brownDwarfSurface.slice(
      brownDwarfSurface.indexOf('float bdTauEff'),
      brownDwarfSurface.indexOf('float bdTransmit')
    )

    expect(tauEff).not.toContain('time')
    // Граница слова обязательна: `float tau` содержит `float t` подстрокой
    expect(tauEff).not.toMatch(/\bfloat t\b/)
  })

  it('дыхание собрано на синусах, а не на шуме', () => {
    const breath = brownDwarfSurface.slice(brownDwarfSurface.indexOf('float bdBreath'))

    expect(breath).toContain('sin(')
    expect(breath).not.toContain('snoise')
    expect(breath).not.toContain('fbm')
  })
})
