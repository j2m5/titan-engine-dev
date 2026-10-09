import { describe, expect, it } from 'vitest'
import {
  FLARE_GHOSTS,
  GHOST_COPIES_FADE,
  GHOST_CUTOFF,
  GHOST_FLUX_GAMMA,
  GHOST_FLUX_KNEE_PIXELS,
  GHOST_REFERENCE,
  GHOST_SQUEEZE,
  effectiveCopies,
  fluxResponse,
  ghostChannelCenters,
  ghostCopiesFade,
  ghostEnergy,
  ghostPeakOnScreen,
  ghostProfile,
  ghostVignette,
  lumaNormalized,
  profileIntegral,
  sourceGain,
  type GhostProfile
} from '@/core/graphic/effects/lensflare/flareGhosts'
import {
  FLUX_REFERENCE_HEIGHT,
  flareGridSize,
  gatherGrid,
  localContrast,
  selectMaxima,
  sourceWindows,
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

/** Конвейер блика на CPU без предразмытия: локальный контраст → сетка → отбор */
function diskSources(width: number, height: number, u: number, v: number, diameterPixels: number): FlareSource[] {
  const raw = diskTexels(width, height, u * width, v * height, (diameterPixels * height) / FLUX_REFERENCE_HEIGHT)
  return selectMaxima(gatherGrid(localContrast(raw, width, height), width, height))
}

/** Буферы блика (половина кадра) на экранах 1080p и 4K */
const BUFFERS = [
  [960, 540],
  [1920, 1080]
] as const

/**
 * Замер GPU 2026-10-08: штатный конвейер (порог 1, Kawase SMALL, контраст)
 * на диске яркости 10 с потемнением 0.6, два положения. Эффективное число
 * копий в окне источников [min, max] по высоте буфера; ключ — диаметр, px 1080p
 */
const GPU_COPIES: Record<number, Record<number, readonly [number, number]>> = {
  540: { 142: [3, 4], 200: [5, 7], 280: [6.9, 8.9], 400: [9.9, 11.9], 550: [13.9, 15.8], 700: [14, 19.8], 900: [12.4, 25.6] },
  1080: { 142: [4, 4], 200: [5, 6], 280: [6, 8.9], 400: [9.8, 10.9], 550: [16.8, 16.8], 700: [14.9, 20.9], 900: [11.7, 26.4] }
}

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
  const halo = FLARE_GHOSTS.find((g) => g.profile.kind === 'halo')!

  it('калибровка — облик, принятый владельцем: Солнце диском 25–30 px (поток 1800) даёт ореол 0.0265', () => {
    const peaks = FLARE_GHOSTS.map((g) =>
      ghostPeakOnScreen(g, frameFlux(GHOST_REFERENCE.fluxPixels), 1, 1, GHOST_REFERENCE.intensity)
    )

    expect(GHOST_REFERENCE).toEqual({ fluxPixels: 1800, peak: 0.0265, intensity: 0.1 })
    expect(Math.max(...peaks)).toBeCloseTo(GHOST_REFERENCE.peak, 10)
  })

  it('импостор (поток 500) — около 0.77 принятого облика, а не 0.28', () => {
    const ratio = ghostPeakOnScreen(halo, frameFlux(500), 1, 1, 0.1) / ghostPeakOnScreen(halo, frameFlux(1800), 1, 1, 0.1)

    expect(ratio).toBeCloseTo((500 / 1800) ** GHOST_FLUX_GAMMA, 10)
    expect(ratio).toBeGreaterThan(0.75)
  })

  it('пики соотносятся как в референсе', () => {
    const [first] = FLARE_GHOSTS
    for (const g of FLARE_GHOSTS) expect(ghostEnergy(g) / ghostEnergy(first)).toBeCloseTo(g.peak / first.peak, 12)
  })

  it('фоновая звезда (поток 3) не рисует ни одного призрака', () => {
    for (const g of FLARE_GHOSTS) expect(ghostPeakOnScreen(g, frameFlux(3), 1, 1, 0.1)).toBeLessThan(GHOST_CUTOFF)
  })

  it('импостор рисует все призраки над отсечкой', () => {
    for (const g of FLARE_GHOSTS) expect(ghostPeakOnScreen(g, frameFlux(500), 1, 1, 0.1)).toBeGreaterThan(GHOST_CUTOFF)
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

describe('призраки: сжатие потока', () => {
  const knee = frameFlux(GHOST_FLUX_KNEE_PIXELS)

  it('колено — поток импостора звезды (замер на Солнце 2026-10-08: ~500)', () => {
    expect(GHOST_FLUX_KNEE_PIXELS).toBe(500)
  })

  it('ниже колена — линейно, выше — степень, на колене непрерывно', () => {
    expect(fluxResponse(knee / 4)).toBeCloseTo(knee / 4, 15)
    expect(fluxResponse(knee)).toBeCloseTo(knee, 15)
    expect(fluxResponse(knee * 32)).toBeCloseTo(knee * 32 ** GHOST_FLUX_GAMMA, 15)
    let previous = 0
    for (let k = 0.01; k < 100; k *= 1.3) {
      const value = fluxResponse(knee * k)
      expect(value).toBeGreaterThan(previous)
      previous = value
    }
  })

  it('поток кольца вдвое меньше на 4K, чем на 1080p: после сжатия разница ~15 %', () => {
    expect(fluxResponse(knee * 8) / fluxResponse(knee * 4)).toBeCloseTo(2 ** GHOST_FLUX_GAMMA, 12)
    expect(2 ** GHOST_FLUX_GAMMA).toBeLessThan(1.16)
  })
})

describe('призраки: копии раздробленного диска', () => {
  it('копии делят сжатый общий поток окна: вместе — как один источник', () => {
    const copies = [700, 900, 800, 600].map(frameFlux)
    const total = copies.reduce((a, b) => a + b, 0)
    const together = copies.reduce((sum, flux) => sum + flux * sourceGain(total), 0)

    expect(together).toBeCloseTo(fluxResponse(total), 15)
  })

  it('одиночный источник: коэффициент — сжатие его собственного потока', () => {
    for (const pixels of [3, 500, 1800, 20000]) {
      const flux = frameFlux(pixels)
      expect(flux * sourceGain(flux)).toBeCloseTo(fluxResponse(flux), 15)
    }
  })

  it('эффективное число копий: N равных — N, тусклые фоновые звёзды почти не весят', () => {
    expect(effectiveCopies(4, 4)).toBe(4)
    const fluxes = [1000, 1000, 1000, 2, 1, 3]
    const sum = fluxes.reduce((a, b) => a + b, 0)
    const squares = fluxes.reduce((a, b) => a + b * b, 0)
    expect(effectiveCopies(sum, squares)).toBeCloseTo(3, 1)
  })

  it('гашение по копиям: до start — 1, от end — 0, монотонно', () => {
    const { start, end } = GHOST_COPIES_FADE
    expect(ghostCopiesFade(1)).toBe(1)
    expect(ghostCopiesFade(start)).toBe(1)
    expect(ghostCopiesFade(end)).toBe(0)
    let previous = 1
    for (let n = start; n <= end; n += 0.25) {
      expect(ghostCopiesFade(n)).toBeLessThanOrEqual(previous)
      previous = ghostCopiesFade(n)
    }
  })

  it('замер GPU: диски до 200 px — призраки полные, от 550 px — погашены у всех копий', () => {
    for (const table of Object.values(GPU_COPIES)) {
      for (const diameter of [142, 200]) expect(ghostCopiesFade(table[diameter][1])).toBe(1)
      for (const diameter of [550, 700, 900]) expect(ghostCopiesFade(table[diameter][0])).toBe(0)
    }
  })

  it('кадр владельца 2026-10-08 (диск 142 px): призраки есть и вместе не ярче одного источника', () => {
    const sources = diskSources(2100, 1080, 0.26, 0.582, 142)
    const windows = sourceWindows(sources, flareGridSize(2100, 1080))
    const total = sources.reduce((sum, s) => sum + s.flux, 0)
    const together = sources.reduce((sum, s, k) => sum + s.flux * sourceGain(windows[k].flux), 0)

    expect(sources.length).toBeGreaterThanOrEqual(2)
    for (const w of windows) expect(ghostCopiesFade(effectiveCopies(w.flux, w.fluxSquared))).toBe(1)
    expect(together).toBeCloseTo(fluxResponse(total), 12)
  })

  it('компактная звезда: один источник, окно — он сам', () => {
    for (const [width, height] of BUFFERS) {
      const sources = diskSources(width, height, 0.4, 0.55, 12)
      const [w] = sourceWindows(sources, flareGridSize(width, height))

      expect(sources).toHaveLength(1)
      expect(effectiveCopies(w.flux, w.fluxSquared)).toBeCloseTo(1, 12)
    }
  })

  it('CPU-конвейер: диск 700 px погашен у всех копий на обоих экранах', () => {
    for (const [width, height] of BUFFERS) {
      const sources = diskSources(width, height, 0.45, 0.52, 700)
      const windows = sourceWindows(sources, flareGridSize(width, height))

      expect(sources.length).toBeGreaterThan(10)
      for (const w of windows) expect(ghostCopiesFade(effectiveCopies(w.flux, w.fluxSquared)), `${height} строк`).toBe(0)
    }
  })
})
