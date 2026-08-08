import { AppShaderChunk } from '@/core/materials/shaders/lib/chunks'
import { brownDwarfSurface } from '@/core/materials/shaders/lib/chunks/BrownDwarfSurface'
import {
  bdBands,
  bdBreath,
  bdCompose,
  bdGap,
  bdShade,
  bdTauEff,
  bdTransmit,
  BREATH_AXES,
  CLOUD_TONE_BASE,
  CLOUD_TONE_RANGE,
  GAP_MIN_WIDTH,
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

  it('положительная амплитуда действительно меняет яркость со временем', () => {
    // Дополняет проверку границ: константная функция тоже уложилась бы в
    // [1-a, 1+a], но не дышала бы. Без этой проверки обнулённая сумма
    // синусов прошла бы все тесты файла.
    expect(bdBreath(dirs[0], 0, amplitude)).not.toBeCloseTo(bdBreath(dirs[0], 10, amplitude), 6)
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
    // появится в bdTauEff, bdTransmit или bdCompose, вернётся механизм
    // прошлого дефекта.
    // Индексы проверяются явно: если сигнатура переименована и indexOf
    // вернёт -1, slice тихо схлопнется в '' и обе проверки ниже пройдут на
    // пустой строке — такой снос защиты обязан падать, а не молчать.
    const start = brownDwarfSurface.indexOf('float bdTauEff(')
    const end = brownDwarfSurface.indexOf('vec3 bdCompose(')

    expect(start).toBeGreaterThanOrEqual(0)
    expect(end).toBeGreaterThan(start)

    const tauEff = brownDwarfSurface.slice(start, end)

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

  it('числовые константы GLSL синхронизированы с зеркалом', () => {
    // Без этой проверки оси дыхания, коэффициенты тона палубы и потолок HDR
    // можно поменять прямо в GLSL, оставив зеркало (и остальные тесты файла,
    // которые гоняют только TS-сторону) прежними.
    expect(brownDwarfSurface).toContain(`#define BD_HDR_CEILING ${HDR_CEILING.toFixed(1)}`)
    expect(brownDwarfSurface).toContain(`#define BD_CLOUD_TONE_BASE ${CLOUD_TONE_BASE}`)
    expect(brownDwarfSurface).toContain(`#define BD_CLOUD_TONE_RANGE ${CLOUD_TONE_RANGE}`)

    for (const [x, y, z] of BREATH_AXES) {
      expect(brownDwarfSurface).toContain(`vec3(${x}, ${y}, ${z})`)
    }
  })

  it('частоты и фазовые коэффициенты дыхания зафиксированы', () => {
    // В зеркале не вынесены в отдельные константы (зашиты в bdBreath),
    // поэтому фиксируются термом целиком — правка множителя или
    // коэффициента при t в GLSL уронит эту строку.
    expect(brownDwarfSurface).toContain('vec3(0.71, 0.43, 0.55)) * 3.0 + t * 0.11')
    expect(brownDwarfSurface).toContain('vec3(-0.36, 0.82, 0.44)) * 5.0 - t * 0.07')
    expect(brownDwarfSurface).toContain('vec3(0.52, -0.29, 0.8)) * 8.0 + t * 0.19')
  })
})

describe('аналитическое поле: полосы и порог', () => {
  it('полосы меняют фазу от пояса к поясу', () => {
    // Центры соседних поясов: sin там равен ровно ∓1, знаки максимально
    // разнесены. Широты выводятся из bandCount, а не подобраны
    const bandCount = 9
    const center = (band: number): number => (band + 0.5) / bandCount

    expect(bdBands(center(1), 0, bandCount, 0)).toBeCloseTo(0, 6)
    expect(bdBands(center(2), 0, bandCount, 0)).toBeCloseTo(1, 6)
  })

  it('шум гнёт полосы, а не сдвигает их целиком', () => {
    // При turbulence = 0 шум на полосы не влияет вовсе
    const flat = bdBands(0.2, 0.9, 9, 0)
    const bent = bdBands(0.2, 0.9, 9, 1.6)

    expect(flat).toBeCloseTo(bdBands(0.2, -0.9, 9, 0), 10)
    expect(bent).not.toBeCloseTo(flat, 3)
  })

  it('порог даёт полный размах: по обе стороны — чистые ноль и единица', () => {
    // Ровно то, чего не было у запекания: провалы и гребни, а не средний тон
    expect(bdGap(0.1, 0.5, 0.01)).toBe(0)
    expect(bdGap(0.9, 0.5, 0.01)).toBe(1)
  })

  it('полуширина порога растёт с футпринтом, а на импосторе съедает край', () => {
    // Огромный футпринт (билборд в 12 px) обязан вырождать порог в усреднение
    const sharp = bdGap(0.52, 0.5, 0.001)
    const blurred = bdGap(0.52, 0.5, 0.5)

    expect(sharp).toBeGreaterThan(0.9)
    expect(blurred).toBeGreaterThan(0.4)
    expect(blurred).toBeLessThan(0.6)
  })

  it('нижний предел полуширины не даёт краю выродиться в ступеньку', () => {
    expect(bdGap(0.5 + GAP_MIN_WIDTH * 0.5, 0.5, 0)).toBeGreaterThan(0)
    expect(bdGap(0.5 + GAP_MIN_WIDTH * 0.5, 0.5, 0)).toBeLessThan(1)
  })
})

describe('структурный контракт поля', () => {
  it('bdField объявлен и берёт fwidth от плотности', () => {
    expect(brownDwarfSurface).toContain('vec2 bdField(')
    expect(brownDwarfSurface).toContain('fwidth(')
  })

  it('времени в поле нет', () => {
    // Слайс обязан быть ОГРАНИЧЕН телом bdField: bdShade ниже по чанку
    // законно принимает свой параметр `float t` (время дыхания) — открытый
    // до конца строки срез поймал бы его как ложное срабатывание.
    // Индексы проверяются явно по тому же образцу, что и в
    // «в толщу время не входит»: тихий откат к пустой строке обязан падать.
    const start = brownDwarfSurface.indexOf('vec2 bdField(')
    const end = brownDwarfSurface.indexOf('float bdTauEff(')

    expect(start).toBeGreaterThanOrEqual(0)
    expect(end).toBeGreaterThan(start)

    const field = brownDwarfSurface.slice(start, end)

    expect(field).not.toContain('time')
    expect(field).not.toMatch(/\bfloat t\b/)
  })

  it('поле не держит собственной копии fbm', () => {
    // fbm живёт в чанке звезды; дубль — второй источник правды
    expect(brownDwarfSurface).not.toContain('float fbm(')
  })
})
