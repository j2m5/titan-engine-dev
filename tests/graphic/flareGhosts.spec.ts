import { describe, expect, it } from 'vitest'
import {
  FLARE_GHOSTS,
  GHOST_CUTOFF,
  GHOST_FADE_PIXELS,
  GHOST_REFERENCE,
  GHOST_SQUEEZE,
  SOURCE_DIAMETER_GAIN,
  ghostChannelCenters,
  ghostEnergy,
  ghostPeakOnScreen,
  ghostProfile,
  ghostSizeFade,
  ghostVignette,
  lumaNormalized,
  profileIntegral,
  sourceDiameterPixels,
  type GhostProfile
} from '@/core/graphic/effects/lensflare/flareGhosts'
import {
  FLUX_REFERENCE_HEIGHT,
  contrastRadiusPixels,
  gatherGrid,
  localContrast,
  selectMaxima,
  type FlareSource
} from '@/core/graphic/effects/lensflare/flareGrid'

const frameFlux = (pixels: number): number => pixels / FLUX_REFERENCE_HEIGHT ** 2
const luma = (c: readonly number[]): number => 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]

/** Диск звезды с потемнением к краю 0.6; диаметр в текселях буфера */
function diskTexels(width: number, height: number, cx: number, cy: number, diameter: number): Float64Array {
  const texels = new Float64Array(width * height)
  const radius = diameter / 2
  for (let y = Math.max(0, Math.floor(cy - radius)); y < Math.min(height, Math.ceil(cy + radius)); y++) {
    for (let x = Math.max(0, Math.floor(cx - radius)); x < Math.min(width, Math.ceil(cx + radius)); x++) {
      const r = Math.hypot(x + 0.5 - cx, y + 0.5 - cy) / radius
      if (r < 1) texels[y * width + x] = 10 * (1 - 0.6 * (1 - Math.sqrt(1 - r * r)))
    }
  }
  return texels
}

/** Конвейер блика на CPU: локальный контраст → сетка с сырым потоком → отбор */
function diskSources(width: number, height: number, u: number, v: number, diameterPixels: number): FlareSource[] {
  const raw = diskTexels(width, height, u * width, v * height, (diameterPixels * height) / FLUX_REFERENCE_HEIGHT)
  return selectMaxima(gatherGrid(localContrast(raw, width, height), width, height, raw))
}

const fadeOf = (source: FlareSource, height: number): number =>
  ghostSizeFade(sourceDiameterPixels(source.flux, source.rawFlux, contrastRadiusPixels(height)))

/** Буферы блика (половина кадра) на экранах 1080p и 4K */
const BUFFERS = [
  [960, 540],
  [1920, 1080]
] as const

/**
 * Замер GPU 2026-10-08: штатный конвейер (порог 1, Kawase SMALL, контраст)
 * на диске яркости 10 с потемнением 0.6, вход в полном разрешении кадра.
 * Оценка диаметра БЕЗ поправки, пиксели 1080p, по высоте буфера; ключ — диаметр
 */
const GPU_ESTIMATES: Record<number, Record<number, number>> = {
  540: { 12: 25, 20: 30, 30: 40, 35: 46, 40: 52, 45: 58, 50: 65, 55: 71, 60: 78 },
  1080: { 12: 17, 20: 26, 30: 39, 35: 47, 40: 54, 45: 62, 50: 70, 55: 78, 60: 86 }
}
/** Тот же замер: наименьшая оценка источника раздробленного диска */
const GPU_SPLIT_MIN_ESTIMATE = 129

describe('призраки: таблица', () => {
  it('четыре семейства референса: острое пятно, купол, большой плоский диск, ореол', () => {
    expect(FLARE_GHOSTS).toHaveLength(4)
    expect(FLARE_GHOSTS.map((g) => (g.profile.kind === 'dome' ? g.profile.power : 'halo'))).toEqual([1.6, 2.4, 5.5, 'halo'])
    for (const g of FLARE_GHOSTS) {
      expect(Number.isFinite(g.m)).toBe(true)
      expect(Math.abs(g.m)).toBeGreaterThan(0.1)
      expect(g.spread).toBeGreaterThan(0)
    }
  })

  it('ореол — самый яркий по пику и самый далёкий за центром кадра', () => {
    const halo = FLARE_GHOSTS.find((g) => g.profile.kind === 'halo')!

    expect(halo.peak).toBe(Math.max(...FLARE_GHOSTS.map((g) => g.peak)))
    expect(halo.m).toBe(Math.min(...FLARE_GHOSTS.map((g) => g.m)))
  })

  it('овалы вертикальные — анаморфная подпись', () => {
    expect(GHOST_SQUEEZE).toBeLessThan(1)
  })

  it('оттенок нормирован по яркости', () => {
    for (const g of FLARE_GHOSTS) expect(luma(lumaNormalized(g.tint))).toBeCloseTo(1, 12)
  })
})

describe('призраки: профили', () => {
  const dome = (power: number): GhostProfile => ({ kind: 'dome', power })
  const halo: GhostProfile = { kind: 'halo', core: 0.26 }

  it('без обода: максимум 1 в центре, к краю монотонно до нуля, за краем ноль', () => {
    for (const profile of [dome(1.6), dome(2.4), dome(5.5), halo]) {
      expect(ghostProfile(0, profile)).toBe(1)
      let previous = 1
      for (let rho = 0.01; rho <= 1; rho += 0.01) {
        const value = ghostProfile(rho, profile)
        expect(value).toBeLessThanOrEqual(previous)
        previous = value
      }
      expect(ghostProfile(1, profile)).toBeCloseTo(0, 12)
      expect(ghostProfile(1.2, profile)).toBe(0)
    }
  })

  it('чем больше показатель купола, тем площе вершина', () => {
    expect(ghostProfile(0.5, dome(5.5))).toBeGreaterThan(ghostProfile(0.5, dome(2.4)))
    expect(ghostProfile(0.5, dome(2.4))).toBeGreaterThan(ghostProfile(0.5, dome(1.6)))
  })

  it('ореол: узкое ядро и длинный хвост', () => {
    expect(ghostProfile(0.26, halo)).toBeLessThan(0.55)
    expect(ghostProfile(0.6, halo)).toBeGreaterThan(0.05)
  })

  it('интегралы — замкнутые формы: купол π·p/(p+2), ореол 2π/(1−L)·(c²/2·ln(1+1/c²) − L/2)', () => {
    for (const power of [1.6, 2.4, 5.5]) expect(profileIntegral(dome(power))).toBeCloseTo((Math.PI * power) / (power + 2), 5)
    const c = 0.26
    const edge = 1 / (1 + 1 / (c * c))
    const expected = ((2 * Math.PI) / (1 - edge)) * ((c * c * Math.log(1 + 1 / (c * c))) / 2 - edge / 2)
    expect(profileIntegral(halo)).toBeCloseTo(expected, 5)
  })
})

describe('призраки: хроматика сдвигом по оси', () => {
  const source: [number, number] = [0.5, -0.2]

  it('зелёный — в m·s, красный ближе к центру кадра, синий дальше', () => {
    for (const g of FLARE_GHOSTS) {
      const [red, green, blue] = ghostChannelCenters(g, source, 1)

      expect(green[0]).toBeCloseTo(g.m * source[0], 12)
      expect(green[1]).toBeCloseTo(g.m * source[1], 12)
      expect(Math.hypot(...red)).toBeLessThan(Math.hypot(...green))
      expect(Math.hypot(...blue)).toBeGreaterThan(Math.hypot(...green))
      expect(Math.hypot(blue[0] - red[0], blue[1] - red[1])).toBeCloseTo(2 * Math.abs(g.m * g.spread) * Math.hypot(...source), 12)
    }
  })

  it('множитель 0 — каналы совпадают, 2 — разнос вдвое', () => {
    const g = FLARE_GHOSTS[2]
    const [red0, , blue0] = ghostChannelCenters(g, source, 0)
    const [red1, , blue1] = ghostChannelCenters(g, source, 1)
    const [red2, , blue2] = ghostChannelCenters(g, source, 2)

    expect(red0).toEqual(blue0)
    expect(Math.hypot(blue2[0] - red2[0], blue2[1] - red2[1])).toBeCloseTo(2 * Math.hypot(blue1[0] - red1[0], blue1[1] - red1[1]), 12)
  })
})

describe('призраки: энергия', () => {
  it('калибровка: звезда 12 px в центре даёт самый яркий призрак 0.05', () => {
    const peaks = FLARE_GHOSTS.map((g) =>
      ghostPeakOnScreen(g, frameFlux(GHOST_REFERENCE.fluxPixels), 1, 1, GHOST_REFERENCE.intensity)
    )

    expect(Math.max(...peaks)).toBeCloseTo(0.05, 10)
  })

  it('пики соотносятся как в референсе', () => {
    const [first] = FLARE_GHOSTS
    for (const g of FLARE_GHOSTS) expect(ghostEnergy(g) / ghostEnergy(first)).toBeCloseTo(g.peak / first.peak, 12)
  })

  it('фоновая звезда (поток 3) не рисует ни одного призрака', () => {
    for (const g of FLARE_GHOSTS) expect(ghostPeakOnScreen(g, frameFlux(3), 1, 1, 0.1)).toBeLessThan(GHOST_CUTOFF)
  })

  it('звезда сцены рисует призраков', () => {
    expect(FLARE_GHOSTS.some((g) => ghostPeakOnScreen(g, frameFlux(3400), 1, 1, 0.1) > GHOST_CUTOFF)).toBe(true)
  })
})

describe('призраки: виньетирование', () => {
  it('в центре 1, к углу монотонно падает почти до нуля', () => {
    const aspect = 16 / 9
    const corner = 0.5 * Math.hypot(aspect, 1)
    let previous = ghostVignette([0, 0], aspect, 2)
    expect(previous).toBe(1)
    for (let t = 0.1; t <= 1.0001; t += 0.1) {
      const v = ghostVignette([t * corner * 0.8, t * corner * 0.6], aspect, 2)
      expect(v).toBeLessThan(previous)
      previous = v
    }
    expect(previous).toBeLessThan(1e-6)
  })

  it('показатель 0 — виньетирования нет', () => {
    expect(ghostVignette([0.8, 0.4], 16 / 9, 0)).toBe(1)
  })
})

describe('призраки: крупный источник гаснет', () => {
  it('множитель: 1 до start, 0 от end, монотонный спад между', () => {
    const { start, end } = GHOST_FADE_PIXELS
    expect(ghostSizeFade(0)).toBe(1)
    expect(ghostSizeFade(start)).toBe(1)
    expect(ghostSizeFade(end)).toBe(0)
    expect(ghostSizeFade(1000)).toBe(0)
    let previous = 1
    for (let d = start; d <= end; d += 0.5) {
      const fade = ghostSizeFade(d)
      expect(fade).toBeLessThanOrEqual(previous)
      previous = fade
    }
  })

  it('поправка на предразмытие: замер GPU в зоне гашения ложится в ±10 % диаметра', () => {
    for (const [height, estimates] of Object.entries(GPU_ESTIMATES)) {
      for (const diameter of [30, 35, 40, 45, 50, 55]) {
        const ratio = (SOURCE_DIAMETER_GAIN * estimates[diameter]) / diameter

        expect(ratio, `${height} строк, ${diameter} px`).toBeGreaterThan(0.9)
        expect(ratio, `${height} строк, ${diameter} px`).toBeLessThan(1.1)
      }
    }
  })

  it('замер GPU: звезда 12–30 px — призраки полные, диск от 55 px — погашены', () => {
    for (const estimates of Object.values(GPU_ESTIMATES)) {
      for (const diameter of [12, 20, 30]) expect(ghostSizeFade(SOURCE_DIAMETER_GAIN * estimates[diameter])).toBe(1)
      for (const diameter of [55, 60]) expect(ghostSizeFade(SOURCE_DIAMETER_GAIN * estimates[diameter])).toBe(0)
    }
  })

  it('замер GPU: раздробленный диск оценивается вдвое дальше конца гашения', () => {
    // Наименьшая оценка источника раздробленного диска (80–200 px, 4 положения)
    expect(SOURCE_DIAMETER_GAIN * GPU_SPLIT_MIN_ESTIMATE).toBeGreaterThan(1.9 * GHOST_FADE_PIXELS.end)
  })

  // CPU-зеркало без предразмытия занижает оценку относительно GPU: проверки
  // копий ниже строже реального конвейера
  it('компактная звезда и диск 30 px — призраки полные на обоих экранах', () => {
    for (const [width, height] of BUFFERS) {
      for (const diameter of [6, 12, 30]) {
        const sources = diskSources(width, height, 0.4, 0.55, diameter)

        expect(sources, `${height} строк, ${diameter} px`).toHaveLength(1)
        expect(fadeOf(sources[0], height), `${height} строк, ${diameter} px`).toBeGreaterThan(0.99)
      }
    }
  })

  it('кадр владельца 2026-10-08: диск 142 px дробился на копии — погашены все', () => {
    const sources = diskSources(2100, 1080, 0.26, 0.582, 142)

    expect(sources.length).toBeGreaterThanOrEqual(2)
    for (const source of sources) expect(fadeOf(source, 1080)).toBe(0)
  })

  it('копий не видно: если отбор дробит диск, гаснут все его источники', () => {
    for (const [width, height] of BUFFERS) {
      for (const diameter of [40, 50, 60, 70, 80, 100, 140, 200, 300]) {
        for (const [u, v] of [
          [0.4, 0.55],
          [0.413, 0.571],
          [0.427, 0.538]
        ]) {
          const sources = diskSources(width, height, u, v, diameter)
          if (sources.length < 2) continue
          for (const source of sources) expect(fadeOf(source, height), `${height} строк, ${diameter} px, (${u}, ${v})`).toBe(0)
        }
      }
    }
  })
})
