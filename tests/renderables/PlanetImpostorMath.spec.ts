import { describe, expect, it } from 'vitest'
import { Color, Vector3 } from 'three'
import {
  IMPOSTOR_MAX_CHANNEL,
  IMPOSTOR_REFERENCE_HEX,
  impostorColorFromActor,
  impostorPhaseAngle,
  lambertPhase,
  lommelSeeligerPhase,
  regolithPhase
} from '@/core/renderables/utils/planetImpostorMath'
import { config } from '@/core/framework/config'

const luma = (c: Color): number => 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b
const reference = new Color(IMPOSTOR_REFERENCE_HEX)

describe('lambertPhase — фазовый интеграл ламбертовой сферы', () => {
  it('полная фаза 1, новолуние 0, квадратура 1/π, монотонно убывает', () => {
    expect(lambertPhase(0)).toBeCloseTo(1, 12)
    expect(lambertPhase(Math.PI)).toBeCloseTo(0, 12)
    expect(lambertPhase(Math.PI / 2)).toBeCloseTo(1 / Math.PI, 12)
    let prev = Infinity
    for (let a = 0; a <= Math.PI; a += Math.PI / 32) {
      const p = lambertPhase(a)
      expect(p).toBeLessThanOrEqual(prev)
      prev = p
    }
  })

  it('угол вне [0, π] клампится', () => {
    expect(lambertPhase(-0.5)).toBeCloseTo(1, 12)
    expect(lambertPhase(4)).toBeCloseTo(0, 12)
  })
})

describe('impostorPhaseAngle — звезда в нуле сцены', () => {
  it('камера между звездой и телом — 0, камера за телом — π, сбоку — π/2', () => {
    const body = new Vector3(10, 0, 0)
    expect(impostorPhaseAngle(body, new Vector3(5, 0, 0))).toBeCloseTo(0, 9)
    expect(impostorPhaseAngle(body, new Vector3(20, 0, 0))).toBeCloseTo(Math.PI, 9)
    expect(impostorPhaseAngle(body, new Vector3(10, 7, 0))).toBeCloseTo(Math.PI / 2, 9)
  })

  it('вырожденные векторы — 0, не NaN', () => {
    expect(impostorPhaseAngle(new Vector3(10, 0, 0), new Vector3(10, 0, 0))).toBe(0)
    expect(impostorPhaseAngle(new Vector3(0, 0, 0), new Vector3(3, 0, 0))).toBe(0)
  })
})

describe('impostorColorFromActor', () => {
  it('серый вход → серый выход с люмой опорного', () => {
    const c = impostorColorFromActor('#808080', 0.4)
    expect(c.r).toBeCloseTo(c.g, 12)
    expect(c.g).toBeCloseTo(c.b, 12)
    expect(luma(c)).toBeCloseTo(luma(reference), 9)
  })

  it('люма равна опорной для не упёршихся в потолок цветов (Земля, Нептун, Сатурн)', () => {
    for (const hex of ['#6495ed', '#0f7eb9', '#cc9e26', '#c9cfd2']) {
      const c = impostorColorFromActor(hex, 0.4)
      expect(Math.max(c.r, c.g, c.b), hex).toBeLessThan(IMPOSTOR_MAX_CHANNEL)
      expect(luma(c), hex).toBeCloseTo(luma(reference), 9)
    }
  })

  it('saturation 1 сохраняет отношения каналов, 0 — даёт серый', () => {
    const src = new Color('#6495ed')
    const full = impostorColorFromActor('#6495ed', 1)
    expect(full.r / full.b).toBeCloseTo(src.r / src.b, 9)
    expect(full.g / full.b).toBeCloseTo(src.g / src.b, 9)
    const grey = impostorColorFromActor('#6495ed', 0)
    expect(grey.r).toBeCloseTo(grey.b, 12)
  })

  it('тёмный насыщенный цвет (Марс) не блумит: ни один канал не выше 0.99', () => {
    const c = impostorColorFromActor('#b22222', 0.4)
    expect(Math.max(c.r, c.g, c.b)).toBeLessThanOrEqual(IMPOSTOR_MAX_CHANNEL + 1e-12)
    expect(c.r).toBeGreaterThan(c.g) // оттенок сохранён
  })

  it('пустой, невалидный и чёрный цвет — опорный серый', () => {
    for (const hex of ['', 'red', '#12345', '#000000']) {
      const c = impostorColorFromActor(hex, 0.4)
      expect(c.equals(reference), hex).toBe(true)
    }
  })
})

describe('config planetImpostor', () => {
  it('дефолты спеки', () => {
    expect(config('planetImpostor.saturation')).toBe(0.4)
    expect(config('planetImpostor.phaseFloor')).toBe(0.05)
  })
})

describe('lommelSeeligerPhase — фаза сферы Ломмеля–Зелигера', () => {
  it('края конечны: Φ(0) = 1, Φ(π) = 0, клампы', () => {
    expect(lommelSeeligerPhase(0)).toBe(1)
    expect(lommelSeeligerPhase(Math.PI)).toBe(0)
    expect(lommelSeeligerPhase(1e-9)).toBe(1)
    expect(lommelSeeligerPhase(-1)).toBe(1)
    expect(lommelSeeligerPhase(5)).toBe(0)
    expect(Number.isFinite(lommelSeeligerPhase(Math.PI - 1e-5))).toBe(true)
  })

  it('опорные значения и сравнение с ламбертом', () => {
    expect(lommelSeeligerPhase(Math.PI / 2)).toBeCloseTo(0.3768, 4)
    expect(lommelSeeligerPhase(0.5)).toBeCloseTo(0.869, 3)
    expect(lommelSeeligerPhase(0.5)).toBeLessThan(lambertPhase(0.5))
    expect(lommelSeeligerPhase(2.5)).toBeCloseTo(0.0677, 4)
    expect(lommelSeeligerPhase(2.5)).toBeGreaterThan(lambertPhase(2.5))
  })

  it('монотонно убывает', () => {
    let prev = Infinity
    for (let a = 0; a <= Math.PI; a += Math.PI / 64) {
      const p = lommelSeeligerPhase(a)
      expect(p).toBeLessThanOrEqual(prev)
      prev = p
    }
  })
})

describe('regolithPhase — фаза точки безатмосферного тела', () => {
  it('доля 0 и всплеск 0 — ровно ламберт', () => {
    for (const a of [0, 0.3, 1, 2, Math.PI]) expect(regolithPhase(a, 0, 0)).toBe(lambertPhase(a))
  })

  it('в противостоянии 1 + surge, вдали от него всплеск гаснет', () => {
    expect(regolithPhase(0, 1, 0.3)).toBeCloseTo(1.3, 12)
    expect(regolithPhase(1, 1, 0.3)).toBeCloseTo(lommelSeeligerPhase(1) * (1 + 0.3 * Math.exp(-10)), 12)
  })
})
