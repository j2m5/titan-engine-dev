import { AppShaderChunk } from '@/core/materials/shaders/lib/chunks'
import { brownDwarfSurface } from '@/core/materials/shaders/lib/chunks/BrownDwarfSurface'
import {
  bdBandChaos,
  bdBands,
  bdBreath,
  bdCompose,
  bdDepth,
  bdGap,
  bdPolarWeight,
  bdShade,
  bdShearAngle,
  bdTauEff,
  bdTransmit,
  bdWarpLatitude,
  BREATH_AXES,
  DECK_RELIEF_HIGH,
  DECK_RELIEF_LOW,
  GAP_GLOW_FLOOR,
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
    // cloud/cloudHigh и hot/hotDeep нарочно разные: одинаковые значения не
    // поймали бы забытый mix (композиция прошла бы тест и без него)
    const field: [number, number, number] = [0.4, 0.7, 0.3]
    const manual = bdCompose(
      // Тонового множителя нет: цвет палубы несёт всю её яркость сам
      0.2 * (1 - field[1]) + 0.05 * field[1],
      // Множитель яркости растёт с глубиной: без него красный канал был бы
      // равен gapGlow по всей прогалине разом
      (9 * (1 - field[2]) + 20 * field[2]) *
        (2 * (GAP_GLOW_FLOOR * (1 - field[2]) + 1 * field[2])) *
        bdBreath([1, 0, 0], 5, 0.08),
      bdTransmit(bdTauEff(field[0], 0.8, 3))
    )

    expect(bdShade(field, 0.8, [1, 0, 0], 0.2, 0.05, 9, 20, 3, 2, 5, 0.08)).toBeCloseTo(Math.min(manual, HDR_CEILING), 10)
  })

  it('держит потолок HDR', () => {
    // Открытая прогалина с абсурдной яркостью нутра упирается в потолок
    expect(bdShade([0, 1, 1], 1, [1, 0, 0], 0, 0, 1e6, 1e6, 3, 1, 0, 0)).toBe(HDR_CEILING)
  })

  it('объявлена в чанке', () => {
    expect(brownDwarfSurface).toContain('vec3 bdShade(')
  })
})

describe('глубина прогалин', () => {
  it('открытая прогалина глубокая, сомкнутая палуба — нулевая', () => {
    expect(bdDepth(0, 0.42)).toBe(1)
    expect(bdDepth(0.42, 0.42)).toBe(0)
    expect(bdDepth(0.8, 0.42)).toBe(0)
  })

  it('внутри прогалины есть градиент, а не ступенька', () => {
    // Ради этого глубина и берётся до порога: после него значение двоичное
    const samples = [0.05, 0.15, 0.25, 0.35].map((d) => bdDepth(d, 0.42))

    for (let i = 1; i < samples.length; i++) expect(samples[i]).toBeLessThan(samples[i - 1])
    expect(samples[0]).toBeGreaterThan(0.8)
    expect(samples[3]).toBeLessThan(0.2)
  })

  it('объявлена в чанке и посчитана до порога', () => {
    expect(brownDwarfSurface).toContain('float bdDepth(')
    // bdField обязан звать её от density (плотности), а не от tau
    // (уже пороговой толщи) — иначе градиент выродится в ступеньку
    expect(brownDwarfSurface).toContain('bdDepth(density, gapThreshold)')
  })
})

describe('яркость прогалины растёт с глубиной, а не только оттенок', () => {
  // Зеркало поканальное; у чёрнотельных цветов красный канал нормирован
  // единицей, поэтому здесь проверяется он. Замеренная яркость по Rec.709
  // для оттенка нутра карлика B: ядро 1.36 (блумит, порог 1.0), середина
  // 0.92, кромка 0.54 — светится только ядро.
  //
  // Глубина единицы НЕ достигает: плотность строится как 0.65*полосы +
  // 0.35*шум, шум держится около середины, поэтому минимум плотности около
  // 0.09, а потолок глубины около 0.89. Расчёт на depth = 1 занижал бы
  // яркость ядра и гасил блум — этим и была вызвана регрессия.
  const DEPTH_CEILING = 0.888
  const gap = (depth: number): number => bdShade([0, 0.5, depth], 1, [1, 0, 0], 0, 0, 1, 1, 3, 3.3, 0, 0)

  it('кромка прогалины вдвое тусклее её ядра', () => {
    // Без множителя по глубине красный канал равен gapGlow по всей прогалине
    // разом: вся она уходит в плечо кривой и выцветает в белый
    expect(gap(DEPTH_CEILING) / gap(0)).toBeGreaterThan(1.9)
  })

  it('мелкая прореха не гаснет в чёрную дыру', () => {
    expect(gap(0)).toBeCloseTo(3.3 * GAP_GLOW_FLOOR, 10)
  })

  it('яркость монотонна по глубине', () => {
    const s = [0, 0.25, 0.5, 0.75, DEPTH_CEILING].map(gap)
    for (let i = 1; i < s.length; i++) expect(s[i]).toBeGreaterThan(s[i - 1])
  })
})

describe('тёмная палуба не ровная', () => {
  // Жалоба владельца: светлые полосы детализированы, тёмные однородны.
  // Причина была в том, что два механизма гасили друг друга — цвет палубы
  // темнел с высотой верхушки, а тоновый множитель с высотой светлел.
  // Перепад выходил 1.11 раза, то есть палуба читалась плоской.
  const deck = (h: number, hot: number): number =>
    bdShade([1, h, 0], 1, [1, 0, 0], 0.25, 0.1125, hot, hot, 3, 3.3, 0, 0)

  it('сама палуба даёт перепад больше двух раз', () => {
    expect(deck(0, 0) / deck(1, 0)).toBeGreaterThan(2)
  })

  it('с протечкой свечения снизу перепад остаётся заметным', () => {
    // Протечка постоянна по палубе и слегка сглаживает перепад
    expect(deck(0, 1) / deck(1, 1)).toBeGreaterThan(1.6)
  })

  it('толща палубы следует плотности и выше порога', () => {
    // Порог обрезал всё плотнее себя в единицу, и форма вихрей в тёмных
    // областях терялась — хотя в плотности она ровно та же, что в светлых
    expect(brownDwarfSurface).toContain('BD_DECK_RELIEF_LOW, BD_DECK_RELIEF_HIGH, density')
    expect(brownDwarfSurface).toContain('density) * relief')
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
    expect(brownDwarfSurface).toContain(`#define BD_DECK_RELIEF_LOW ${DECK_RELIEF_LOW}`)
    expect(brownDwarfSurface).toContain(`#define BD_DECK_RELIEF_HIGH ${DECK_RELIEF_HIGH}`)

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
    expect(brownDwarfSurface).toContain('vec3 bdField(')
    expect(brownDwarfSurface).toContain('fwidth(')
  })

  it('времени в поле нет', () => {
    // Слайс обязан быть ОГРАНИЧЕН телом bdField: bdShade ниже по чанку
    // законно принимает свой параметр `float t` (время дыхания) — открытый
    // до конца строки срез поймал бы его как ложное срабатывание.
    // Индексы проверяются явно по тому же образцу, что и в
    // «в толщу время не входит»: тихий откат к пустой строке обязан падать.
    const start = brownDwarfSurface.indexOf('vec3 bdField(')
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

describe('турбулентность газового гиганта', () => {
  it('коробление сдвигает широту, а нулевая ручка его выключает', () => {
    expect(bdWarpLatitude(0.3, 0.8, 0)).toBe(0.3)
    expect(bdWarpLatitude(0.3, 0.8, 0.1)).toBeCloseTo(0.38, 10)
  })

  it('пояса перестают быть равной ширины: расстояния между нулями расходятся', () => {
    // Нули sin(широта·PI·bandCount) — границы поясов. При короблении
    // расстояния между ними обязаны различаться, иначе это та же линейка
    const bandCount = 9
    const noise = (y: number): number => Math.sin(y * 17.3) * Math.cos(y * 7.1)
    const edges: number[] = []

    for (let y = -0.9; y < 0.9; y += 0.0005) {
      const a = Math.sin(bdWarpLatitude(y, noise(y), 0.08) * Math.PI * bandCount)
      const b = Math.sin(bdWarpLatitude(y + 0.0005, noise(y + 0.0005), 0.08) * Math.PI * bandCount)

      if (a * b < 0) edges.push(y)
    }

    const widths = edges.slice(1).map((e, i) => e - edges[i])
    const spread = Math.max(...widths) / Math.min(...widths)

    expect(edges.length).toBeGreaterThan(8)
    expect(spread).toBeGreaterThan(1.3)
  })

  it('сдвиг меняет знак от пояса к поясу', () => {
    const bandCount = 9
    const center = (band: number): number => (band + 0.5) / bandCount

    expect(bdShearAngle(center(1), bandCount, 0.5)).toBeCloseTo(-0.5, 10)
    expect(bdShearAngle(center(2), bandCount, 0.5)).toBeCloseTo(0.5, 10)
  })

  it('нулевой сдвиг — точка отката', () => {
    // toBeCloseTo, а не toBe: sin(...) может быть отрицательным, и
    // IEEE754 отрицательное×0 даёт -0 — Object.is(-0, 0) внутри toBe ложно,
    // хотя по величине это тот же ноль
    expect(bdShearAngle(0.37, 9, 0)).toBeCloseTo(0, 10)
  })

  it('пер-поясная сила турбулентности лежит в [0.4, 1] и не обнуляется', () => {
    // Ноль означал бы пояс без всякой турбулентности — гладкую полосу
    for (const n of [-1, -0.5, 0, 0.5, 1]) {
      expect(bdBandChaos(n)).toBeGreaterThanOrEqual(0.4)
      expect(bdBandChaos(n)).toBeLessThanOrEqual(1)
    }
  })
})

describe('структурный контракт турбулентности', () => {
  it('поле берёт деталь двух масштабов', () => {
    const start = brownDwarfSurface.indexOf('vec3 bdField(')
    const end = brownDwarfSurface.indexOf('float bdTauEff(')
    const field = brownDwarfSurface.slice(start, end)

    expect(start).toBeGreaterThanOrEqual(0)
    expect(end).toBeGreaterThan(start)
    expect((field.match(/fbm\(/g) ?? []).length).toBeGreaterThanOrEqual(4)
    expect(field).not.toContain('time')
  })
})

describe('полярный развал поясов', () => {
  it('на экваторе полосы целы, у полюса гаснут', () => {
    expect(bdPolarWeight(0, 1)).toBe(1)
    expect(bdPolarWeight(0.5, 1)).toBe(1)
    expect(bdPolarWeight(0.99, 1)).toBe(0)
  })

  it('переход монотонный и симметричный по знаку широты', () => {
    const samples = [0.75, 0.8, 0.85, 0.9, 0.95].map((y) => bdPolarWeight(y, 1))

    for (let i = 1; i < samples.length; i++) expect(samples[i]).toBeLessThan(samples[i - 1])
    expect(bdPolarWeight(-0.88, 1)).toBeCloseTo(bdPolarWeight(0.88, 1), 12)
  })

  it('нулевая ручка — точка отката: пояса доходят до полюсов', () => {
    expect(bdPolarWeight(0.99, 0)).toBe(1)
  })
})

describe('структурный контракт вихрей', () => {
  it('вихри объявлены, крутят домен вокруг своей оси и имеют ноль', () => {
    expect(brownDwarfSurface).toContain('vec3 bdVortices(')
    // Формула Родрига: поворот вокруг оси, проходящей через центр вихря
    expect(brownDwarfSurface).toContain('cross(centre, warped)')
    expect(brownDwarfSurface).toContain('BD_VORTEX_COUNT')
  })

  it('вихри стоят до вычисления домена шума, иначе они его не коробят', () => {
    const field = brownDwarfSurface.slice(brownDwarfSurface.indexOf('vec3 bdField('))
    const vort = field.indexOf('bdVortices(')
    const domain = field.indexOf('vec4 p =')

    expect(vort).toBeGreaterThanOrEqual(0)
    expect(domain).toBeGreaterThan(vort)
  })
})
