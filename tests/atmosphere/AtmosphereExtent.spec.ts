import { describe, it, expect } from 'vitest'
import { validateDatabase, DatabaseSnapshot } from '@/core/framework/validation/validateDatabase'
import { atmosphereTuningRanges } from '@/core/renderables/Atmosphere/AtmosphereConfig'
import { shippedSnapshot } from '../helpers/shippedSnapshot'

/**
 * Протяжённость атмосферы задаёт ШКАЛА ВЫСОТ, а не topRadius.
 *
 * Плотность вещества — exp(−h/H); видимая на лимбе полоса набирается за первые
 * ~7 шкал, выше оболочка оптически пуста. Поэтому у тела с земной H и большим
 * радиусом атмосфера выходит волосяной линией, а рост topRadius не меняет
 * НИЧЕГО — растёт только вакуум. Кейс, с которого правило заведено: Явин Прайм
 * (R = 195 500 км) с H = 25 км давал полосу 0.08% радиуса — доли пикселя на
 * диске, при том что у Титана (R = 2575 км) те же 20 км дают почти 10%.
 *
 * Здесь заперты три следствия: правило валидатора об обеих границах
 * оболочка/H, относительный потолок ручек тюнинга и сама поставляемая
 * строка гиганта.
 */

/** Доля радиуса, которую занимает видимая на лимбе полоса (≈7 шкал высот). */
const VISIBLE_BAND_SCALE_HEIGHTS = 7

function layer(scaleHeight: number) {
  return { width: 0, expTerm: 1, expScale: -1 / scaleHeight, linearTerm: 0, constantTerm: 0 }
}

const EMPTY = { width: 0, expTerm: 0, expScale: 0, linearTerm: 0, constantTerm: 0 }

/** Строка атмосферы с заданной оболочкой и шкалой высот; коэффициенты неважны, важна геометрия. */
function atmosphereRow(shellKm: number, scaleHeightKm: number, active = true) {
  return {
    id: 1,
    actorId: 11,
    data: {
      solarIrradiance: [1.474, 1.8504, 1.91198],
      sunAngularRadius: 0.004,
      bottomRadius: 6360,
      topRadius: 6360 + shellKm,
      rayleighDensity: [EMPTY, layer(scaleHeightKm)],
      rayleighScattering: active ? [0.005802, 0.013558, 0.0331] : [0, 0, 0],
      mieDensity: [EMPTY, EMPTY],
      mieScattering: [0, 0, 0],
      mieExtinction: [0, 0, 0],
      miePhaseFunctionG: 0.8,
      absorptionDensity: [EMPTY, EMPTY],
      absorptionExtinction: [0, 0, 0],
      groundAlbedo: [0.1, 0.1, 0.1],
      muSMin: -0.207912
    }
  }
}

function snapshotWith(row: ReturnType<typeof atmosphereRow>): DatabaseSnapshot {
  return {
    categories: [
      { id: 1, alias: 'barycenter', name: 'Barycenter' },
      { id: 2, alias: 'planet', name: 'Planet' }
    ],
    actors: [
      { id: 10, categoryId: 1, parentId: null, name: 'Root', description: '', color: '#fff' },
      { id: 11, categoryId: 2, parentId: 10, name: 'P11', description: '', color: '#fff' }
    ],
    orbits: [],
    rotationObjects: [],
    physicalObjects: [],
    renderingObjects: [row],
    placements: [],
    resources: [],
    actorResource: []
  }
}

const extentWarnings = (row: ReturnType<typeof atmosphereRow>): string[] =>
  validateDatabase(snapshotWith(row))
    .warnings.filter((w) => /scale heights/.test(w.message))
    .map((w) => w.message)

describe('Протяжённость атмосферы: оболочка против шкалы высот', () => {
  it('согласованная оболочка (10 шкал) проходит молча', () => {
    expect(extentWarnings(atmosphereRow(80, 8))).toEqual([])
  })

  it('оболочка в 40 шкал: рост topRadius бесполезен, и валидатор это говорит', () => {
    const [message] = extentWarnings(atmosphereRow(320, 8))

    expect(message).toMatch(/40\.0 scale heights/)
    expect(message).toMatch(/raising topRadius adds nothing/)
  })

  it('оболочка в 3 шкалы: профиль обрезан, на границе оболочки жёсткий край', () => {
    const [message] = extentWarnings(atmosphereRow(24, 8))

    expect(message).toMatch(/hard edge/)
  })

  it('выключенное вещество в счёт не идёт: нулевые коэффициенты — профиль на картинку не влияет', () => {
    // Та же геометрия, что и в кейсе «40 шкал», но рэлей погашен в ноль
    expect(extentWarnings(atmosphereRow(320, 8, false))).toEqual([])
  })
})

describe('Потолки ручек тюнинга выводятся из радиуса тела', () => {
  it('малое тело сохраняет прежний земной потолок в 100 км', () => {
    // Титан: R/40 = 64 км, то есть ниже исторического потолка — ручка не изменилась
    expect(atmosphereTuningRanges(2575).scaleHeightMax).toBe(100)
  })

  it('газовый гигант получает потолок в десятки раз выше абсолютных 100 км', () => {
    const { scaleHeightMax, shellMax } = atmosphereTuningRanges(195500)

    // Прежние 100 км на Явине Прайме — 0.05% радиуса: атмосфера тоньше пикселя
    expect(100 * VISIBLE_BAND_SCALE_HEIGHTS / 195500).toBeLessThan(0.004)
    // Новый потолок выводит видимую полосу за 10% радиуса
    expect((scaleHeightMax * VISIBLE_BAND_SCALE_HEIGHTS) / 195500).toBeGreaterThan(0.1)
    // Оболочка тянется на 20 шкал — ровно до границы, за которой начинается вакуум
    expect(shellMax).toBe(20 * scaleHeightMax)
  })
})

describe('Поставляемая база', () => {
  it('Явин Прайм: видимая полоса — проценты радиуса, а не доли пикселя', async () => {
    const snapshot = await shippedSnapshot()
    const row = snapshot.renderingObjects.find((r) => r.id === 28)!
    const data = row.data as unknown as {
      bottomRadius: number
      topRadius: number
      rayleighDensity: [{ expScale: number }, { expScale: number }]
    }

    const scaleHeight = -1 / data.rayleighDensity[1].expScale
    const shells = (data.topRadius - data.bottomRadius) / scaleHeight

    expect((scaleHeight * VISIBLE_BAND_SCALE_HEIGHTS) / data.bottomRadius).toBeGreaterThan(0.02)
    // Оболочка сопровождает шкалу: не пустая и не режущая профиль
    expect(shells).toBeGreaterThanOrEqual(5)
    expect(shells).toBeLessThanOrEqual(20)
  })

  it('превышение оболочки над 20 шкалами осталось ровно у одной известной строки', async () => {
    const flagged = validateDatabase(await shippedSnapshot())
      .warnings.filter((w) => /scale heights/.test(w.message))
      .map((w) => w.entity)

    // TOI-519b (id 22): 42 шкалы, то есть 95% его оболочки — вакуум.
    // Строка оставлена как есть намеренно: правка её вида — отдельное решение
    expect(flagged).toEqual([22])
  })
})
