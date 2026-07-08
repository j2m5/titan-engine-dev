import { vi, type MockInstance } from 'vitest'
import type { Texture } from 'three'
import { readRingAlphaProfile } from '@/core/renderables/DetailedRingStreamingSystem/RingAlphaReadback'

/**
 * Собирает фейковый canvas: drawImage — noop, getImageData отдаёт заранее
 * подготовленные RGBA-пиксели (jsdom без node-canvas не умеет 2D-контекст).
 */
const stubCanvas = (alphaByColumn: number[]): HTMLCanvasElement => {
  const pixels = new Uint8ClampedArray(alphaByColumn.length * 4)
  alphaByColumn.forEach((a, i) => {
    pixels[i * 4 + 3] = Math.round(a * 255)
  })

  return {
    width: 0,
    height: 0,
    getContext: () => ({
      clearRect: () => undefined,
      drawImage: () => undefined,
      getImageData: () => ({ data: pixels })
    })
  } as unknown as HTMLCanvasElement
}

const fakeTexture = (image: unknown): Texture => ({ image }) as unknown as Texture

describe('readRingAlphaProfile: построение профиля из альфы текстуры', () => {
  let createElementSpy: MockInstance | null = null

  afterEach(() => {
    createElementSpy?.mockRestore()
    createElementSpy = null
  })

  it('строит профиль: колонка текстуры ↔ радиальный бин (u = (r - inner)/(outer - inner))', () => {
    // 4 колонки: непрозрачно | пусто | пусто | полупрозрачно
    createElementSpy = vi.spyOn(document, 'createElement').mockReturnValue(stubCanvas([1, 0, 0, 0.5]))

    const profile = readRingAlphaProfile(fakeTexture({ width: 4, height: 2 }), 100, 200)
    expect(profile).not.toBeNull()
    expect(profile!.weightForBand(100, 125)).toBeCloseTo(1, 5)
    expect(profile!.weightForBand(125, 175)).toBe(0)
    expect(profile!.weightForBand(175, 200)).toBeCloseTo(128 / 255, 5) // 0.5 в 8-битной альфе
  })

  it('без изображения или с вырожденными радиусами → null', () => {
    expect(readRingAlphaProfile(fakeTexture(null), 100, 200)).toBeNull()
    expect(readRingAlphaProfile(fakeTexture({ width: 0, height: 0 }), 100, 200)).toBeNull()
    expect(readRingAlphaProfile(fakeTexture({ width: 4, height: 4 }), 200, 100)).toBeNull()
  })

  it('compressed-текстура (ktx2 и т.п.) не читается через canvas → null', () => {
    const texture = { image: { width: 4, height: 4 }, isCompressedTexture: true } as unknown as Texture
    expect(readRingAlphaProfile(texture, 100, 200)).toBeNull()
  })

  it('2D-контекст недоступен (jsdom/страховка) → null, не исключение', () => {
    // Без мока createElement: jsdom-канвас без node-canvas отдаёт null-контекст
    expect(readRingAlphaProfile(fakeTexture({ width: 4, height: 4 }), 100, 200)).toBeNull()
  })

  it('альфа не выше alphaTest считается пустотой (семантика гейта 2D-кольца)', () => {
    createElementSpy = vi.spyOn(document, 'createElement').mockReturnValue(stubCanvas([1, 0.1, 0, 0.5]))

    const profile = readRingAlphaProfile(fakeTexture({ width: 4, height: 2 }), 100, 200, { alphaTest: 0.2 })
    expect(profile).not.toBeNull()
    expect(profile!.weightForBand(100, 125)).toBeCloseTo(1, 5)
    expect(profile!.weightForBand(125, 150)).toBe(0) // 0.1 ≤ 0.2 → пустота
    expect(profile!.weightForBand(150, 175)).toBe(0)
    expect(profile!.weightForBand(175, 200)).toBeCloseTo(128 / 255, 5)
  })

  it('размытие: масса чуть выходит за кромку субкольца, далёкая пустота остаётся пустой', () => {
    // 16 колонок, субкольцо в колонках 6–7 (радиусы [160, 180]), вокруг пустота
    const columns = new Array<number>(16).fill(0)
    columns[6] = 1
    columns[7] = 1
    createElementSpy = vi.spyOn(document, 'createElement').mockReturnValue(stubCanvas(columns))

    // Бин = 10 единиц радиуса; сигма = 1 бин
    const profile = readRingAlphaProfile(fakeTexture({ width: 16, height: 2 }), 100, 260, { blurRadius: 10 })
    expect(profile).not.toBeNull()

    const core = profile!.weightForBand(160, 180) // сердцевина субкольца
    const fringe = profile!.weightForBand(140, 160) // соседняя полоса — мягкий хвост
    const far = profile!.weightForBand(100, 120) // дальше 3σ — пустота
    expect(core).toBeGreaterThan(0.5)
    expect(fringe).toBeGreaterThan(0)
    expect(fringe).toBeLessThan(core * 0.5)
    expect(far).toBe(0)

    // Размытие перераспределяет массу, но не создаёт и не теряет её (субкольцо вдали от краёв)
    const sharp = readRingAlphaProfile(fakeTexture({ width: 16, height: 2 }), 100, 260)
    expect(profile!.weightForBand(100, 260)).toBeCloseTo(sharp!.weightForBand(100, 260), 3)
  })

  it('порог применяется ДО размытия: хвост тянется от кромки после отсечки', () => {
    // Колонка 5 — гало ниже порога, оно не должно подпитывать хвост
    const columns = new Array<number>(16).fill(0)
    columns[5] = 0.1
    columns[6] = 1
    columns[7] = 1
    createElementSpy = vi.spyOn(document, 'createElement').mockReturnValue(stubCanvas(columns))

    const blurred = readRingAlphaProfile(fakeTexture({ width: 16, height: 2 }), 100, 260, {
      alphaTest: 0.2,
      blurRadius: 10
    })
    const clean = (() => {
      createElementSpy!.mockReturnValue(stubCanvas(columns.map((a) => (a <= 0.2 ? 0 : a))))
      return readRingAlphaProfile(fakeTexture({ width: 16, height: 2 }), 100, 260, { blurRadius: 10 })
    })()
    expect(blurred!.weightForBand(100, 260)).toBeCloseTo(clean!.weightForBand(100, 260), 6)
  })

  it('без опций поведение прежнее (нулевой порог, без размытия)', () => {
    createElementSpy = vi.spyOn(document, 'createElement').mockReturnValue(stubCanvas([1, 0, 0, 0.5]))
    const plain = readRingAlphaProfile(fakeTexture({ width: 4, height: 2 }), 100, 200)

    createElementSpy.mockReturnValue(stubCanvas([1, 0, 0, 0.5]))
    const explicit = readRingAlphaProfile(fakeTexture({ width: 4, height: 2 }), 100, 200, {
      alphaTest: 0,
      blurRadius: 0
    })
    expect(plain!.weightForBand(100, 200)).toBeCloseTo(explicit!.weightForBand(100, 200), 10)
  })

  it('исключение чтения (CORS-tainted canvas) → null, не исключение', () => {
    const canvas = {
      width: 0,
      height: 0,
      getContext: () => ({
        clearRect: () => undefined,
        drawImage: () => undefined,
        getImageData: (): never => {
          throw new DOMException('tainted', 'SecurityError')
        }
      })
    } as unknown as HTMLCanvasElement
    createElementSpy = vi.spyOn(document, 'createElement').mockReturnValue(canvas)

    expect(readRingAlphaProfile(fakeTexture({ width: 4, height: 4 }), 100, 200)).toBeNull()
  })
})
