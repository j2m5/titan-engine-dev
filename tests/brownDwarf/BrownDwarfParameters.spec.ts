import { Actor } from '@/core/models/Actor'
import { BROWN_DWARF_DECK_PLUM, brownDwarfParameters } from '@/core/renderables/BrownDwarf/BrownDwarfParameters'
import { renderingDataTemplates } from '@/ui/editor/forms/dataTemplates'

function stubActor(data?: unknown, temperature?: number): Actor {
  return {
    getAttribute: (_key: string, def?: unknown): unknown => def,
    renderingObject: data ? { getAttribute: () => data } : undefined,
    physicalObject: {
      getAttribute: (key: string, def?: unknown): unknown => (key === 'temperature' ? (temperature ?? def) : def)
    }
  } as unknown as Actor
}

describe('параметры коричневого карлика', () => {
  it('без renderingObject берёт дефолты, а не падает', () => {
    const params = brownDwarfParameters(stubActor())

    expect(params.bandCount).toBe(4.5)
    expect(params.opticalDepth).toBeCloseTo(3)
    expect(params.breathAmplitude).toBeCloseTo(0.08)
    expect(params.temperature).toBe(1600)
  })

  it('данные объекта перекрывают дефолты', () => {
    const params = brownDwarfParameters(stubActor({ bandCount: 14, opticalDepth: 5 }, 1200))

    expect(params.bandCount).toBe(14)
    expect(params.opticalDepth).toBeCloseTo(5)
    expect(params.temperature).toBe(1200)
    // не заданное в данных остаётся дефолтным
    expect(params.gapGlow).toBeCloseTo(3.3)
  })

  it('нулевая амплитуда дыхания сохраняется как ноль, а не подменяется дефолтом', () => {
    // Точка отката: 0 обязан пережить ?? — иначе выключить дыхание нечем
    const params = brownDwarfParameters(stubActor({ breathAmplitude: 0 }))

    expect(params.breathAmplitude).toBe(0)
  })

  it('амплитуда дыхания зажата в [0, 1]: за единицей яркость уходит в минус', () => {
    // bdBreath даёт [1-a, 1+a]; при a > 1 нутро получает отрицательную
    // светимость, а нижней отсечки в bdShade нет намеренно
    expect(brownDwarfParameters(stubActor({ breathAmplitude: 3 })).breathAmplitude).toBe(1)
    expect(brownDwarfParameters(stubActor({ breathAmplitude: -0.5 })).breathAmplitude).toBe(0)
  })

  it('лимбовое потемнение по умолчанию 0.6', () => {
    expect(brownDwarfParameters(stubActor()).limbDarkening).toBeCloseTo(0.6)
  })

  it('нулевое лимбовое потемнение сохраняется как ноль, а не подменяется дефолтом', () => {
    // Точка отката: 0 обязан пережить ??, иначе вернуть прежний вид нечем
    expect(brownDwarfParameters(stubActor({ limbDarkening: 0 })).limbDarkening).toBe(0)
  })

  it('лимбовое потемнение зажато в [0, 1]: за единицей кромка уходит в минус', () => {
    // Множитель 1 − u·(1 − mu) при u > 1 отрицателен на малых mu, то есть
    // прогалина у лимба получает отрицательную светимость
    expect(brownDwarfParameters(stubActor({ limbDarkening: 2.5 })).limbDarkening).toBe(1)
    expect(brownDwarfParameters(stubActor({ limbDarkening: -1 })).limbDarkening).toBe(0)
  })

  it('мягкость кромки по умолчанию 0.20', () => {
    expect(brownDwarfParameters(stubActor()).deckSoftness).toBeCloseTo(0.20)
  })

  it('нулевая мягкость сохраняется как ноль, а не подменяется дефолтом', () => {
    // Точка отката: 0 обязан пережить ??, иначе вернуть прежнюю кромку нечем
    expect(brownDwarfParameters(stubActor({ deckSoftness: 0 })).deckSoftness).toBe(0)
  })

  it('мягкость зажата в [0, 1]: отрицательная переворачивает пороги smoothstep', () => {
    // Полуширина складывается из футпринта и мягкости; отрицательная мягкость
    // сужает её ниже порога сглаживания, а перевесив его — даёт smoothstep с
    // e0 > e1, что в GLSL не определено
    expect(brownDwarfParameters(stubActor({ deckSoftness: 4 })).deckSoftness).toBe(1)
    expect(brownDwarfParameters(stubActor({ deckSoftness: -0.2 })).deckSoftness).toBe(0)
  })

  it('сила тонировки палубы по умолчанию 0.5', () => {
    expect(brownDwarfParameters(stubActor()).deckTint).toBeCloseTo(0.5)
  })

  it('нулевая тонировка сохраняется как ноль, а не подменяется дефолтом', () => {
    // Точка отката: 0 обязан пережить ??, иначе вернуть планковский цвет нечем
    expect(brownDwarfParameters(stubActor({ deckTint: 0 })).deckTint).toBe(0)
  })

  it('сила тонировки зажата в [0, 1]', () => {
    expect(brownDwarfParameters(stubActor({ deckTint: 3 })).deckTint).toBe(1)
    expect(brownDwarfParameters(stubActor({ deckTint: -1 })).deckTint).toBe(0)
  })

  it('опорный сливовый цвет: синий выше зелёного', () => {
    // Это и отличает сливовый от просто тёмно-красного; при B <= G оттенок
    // уходит обратно в кирпич, и вся арка теряет смысл
    expect(BROWN_DWARF_DECK_PLUM.b).toBeGreaterThan(BROWN_DWARF_DECK_PLUM.g)
    expect(BROWN_DWARF_DECK_PLUM.r).toBeGreaterThan(BROWN_DWARF_DECK_PLUM.b)
  })

  it('шаблон редактора заведён и проходит через те же параметры', () => {
    const template = renderingDataTemplates.find((t) => t.value === 'brownDwarf')

    expect(template).toBeDefined()

    const params = brownDwarfParameters(stubActor(template!.data))

    expect(params.bandCount).toBeGreaterThan(0)
    expect(params.opticalDepth).toBeGreaterThan(0)
  })
})
