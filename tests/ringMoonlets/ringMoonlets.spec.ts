import { existsSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { RenderingObjects } from '@storage/database'
import {
  applyRingGapsToBins,
  RING_GAP_EDGE_FRACTION,
  RING_MOONLET_MODELS,
  RING_MOONLETS_MAX,
  resolveRingMoonlets,
  resolveRingshineStrength,
  ringGapMask,
  ringGapsOf,
  ringMoonletProblems,
  type RingGap
} from '@/core/renderables/DetailedRingStreamingSystem/ringMoonlets'
import { RadialDensityProfile } from '@/core/renderables/DetailedRingStreamingSystem/RadialDensityProfile'

const ring = { innerRadius: 75000, outerRadius: 126000, alphaTest: 0.01, asteroidDensityScale: 1 }
const moonlet = { radiusKm: 106620, azimuthDeg: 40, sizeKm: 30, gapKm: 360, model: 'pandora' }
const km = (v: number): number => v

describe('ringGapMask', () => {
  const gap: RingGap = ringGapsOf([moonlet], km)[0]

  it('щель из лунки: радиус орбиты, полуширина gapKm/2, край 0.15 полуширины', () => {
    expect(gap).toEqual({ radius: 106620, halfWidth: 180, edge: 180 * RING_GAP_EDGE_FRACTION })
  })

  it('0 в середине, 1 снаружи, переход только на краю шириной e', () => {
    expect(ringGapMask(106620, [gap])).toBe(0)
    expect(ringGapMask(106620 + 180 - 27 - 1, [gap])).toBe(0)
    expect(ringGapMask(106620 + 180, [gap])).toBe(1)
    expect(ringGapMask(106620 - 1000, [gap])).toBe(1)
    const mid = ringGapMask(106620 + 180 - 13.5, [gap])
    expect(mid).toBeGreaterThan(0.4)
    expect(mid).toBeLessThan(0.6)
  })

  it('пустой список щелей — 1 везде', () => {
    expect(ringGapMask(100000, [])).toBe(1)
  })

  it('две перекрывающиеся щели — произведение, без разрывов (Review Focus 4)', () => {
    const gaps = ringGapsOf([moonlet, { ...moonlet, radiusKm: 106620 + 200 }], km)
    let prev = ringGapMask(106000, gaps)
    for (let r = 106000; r <= 107300; r += 1) {
      const m = ringGapMask(r, gaps)
      expect(m).toBeCloseTo(ringGapMask(r, [gaps[0]]) * ringGapMask(r, [gaps[1]]), 12)
      expect(Math.abs(m - prev)).toBeLessThan(0.1)
      prev = m
    }
  })
})

describe('applyRingGapsToBins', () => {
  it('бины в щели гаснут по маске центра бина, вне — прежние', () => {
    const n = 510
    const bins = new Float32Array(n).fill(0.8)
    const gaps = ringGapsOf([moonlet], km)
    applyRingGapsToBins(bins, 75000, 126000, gaps)
    for (let i = 0; i < n; i++) {
      const r = 75000 + ((i + 0.5) / n) * 51000
      expect(bins[i]).toBeCloseTo(0.8 * ringGapMask(r, gaps), 6)
    }
  })

  it('профиль плотности по маскированным бинам не кладёт камни в щель', () => {
    const n = 1024
    const bins = applyRingGapsToBins(new Float32Array(n).fill(1), 75000, 126000, ringGapsOf([moonlet], km))
    const profile = new RadialDensityProfile(bins, 75000, 126000)
    const half = 180 - 27
    for (let k = 0; k < 20000; k++) {
      const r = profile.sampleRadius(75000, 126000, (k + 0.5) / 20000)
      expect(Math.abs(r - 106620) >= half - 51000 / n).toBe(true)
    }
  })
})

describe('резолверы и проблемы данных лунок', () => {
  it('без поля — нет лунок и подсветка 1', () => {
    expect(resolveRingMoonlets(ring, 'Thalorn')).toEqual([])
    expect(resolveRingshineStrength(ring, 'Thalorn')).toBe(1)
    expect(resolveRingMoonlets(undefined, 'x')).toEqual([])
  })

  it('годные данные проходят как есть', () => {
    expect(resolveRingMoonlets({ ...ring, moonlets: [moonlet] }, 'Thalorn')).toEqual([moonlet])
    expect(resolveRingshineStrength({ ...ring, ringshineStrength: 0 }, 'Thalorn')).toBe(0)
  })

  it.each([
    ['радиус вне кольца', { ...moonlet, radiusKm: 130000 }, /radiusKm/],
    ['ширина щели ≤ 0', { ...moonlet, gapKm: 0 }, /gapKm/],
    ['размер ≤ 0', { ...moonlet, sizeKm: -1 }, /sizeKm/],
    ['неизвестная модель', { ...moonlet, model: 'pan' }, /model/],
    ['азимут не число', { ...moonlet, azimuthDeg: 'a' }, /azimuthDeg/]
  ])('%s — громкая ошибка с именем кольца', (_name, bad, pattern) => {
    expect(() => resolveRingMoonlets({ ...ring, moonlets: [bad as never] }, 'Thalorn')).toThrow(/Thalorn/)
    expect(ringMoonletProblems({ ...ring, moonlets: [bad] }).join(' ')).toMatch(pattern)
  })

  it('больше RING_MOONLETS_MAX лунок — ошибка', () => {
    const many = Array.from({ length: RING_MOONLETS_MAX + 1 }, () => moonlet)
    expect(ringMoonletProblems({ ...ring, moonlets: many }).join(' ')).toMatch(/at most 4/)
  })

  it('ringshineStrength < 0 или не число — ошибка', () => {
    expect(() => resolveRingshineStrength({ ...ring, ringshineStrength: -1 }, 'Thalorn')).toThrow(/ringshineStrength/)
    expect(ringMoonletProblems({ ...ring, ringshineStrength: 'x' }).join(' ')).toMatch(/ringshineStrength/)
  })

  it('каждая модель из списка лежит в репозитории (оба яруса)', () => {
    for (const name of RING_MOONLET_MODELS) {
      expect(existsSync(`storage/images/textures/asteroids/shapes/${name}_l0.bin`), name).toBe(true)
      expect(existsSync(`storage/images/textures/asteroids/shapes/${name}_near.bin`), name).toBe(true)
    }
  })
})

describe('стартовые лунки в данных', () => {
  type Row = { actorId: number; data: Record<string, unknown> }
  const rowOf = (actorId: number) => (RenderingObjects as unknown as Row[]).find((r) => r.actorId === actorId)!

  it.each([
    [132, 'pandora', 106620],
    [125, 'ida', 138730],
    [79, 'ida', 102846],
    [92, 'ida', 82200],
    [45, 'ida', 115246]
  ])('кольцо actor %i: одна лунка %s на %i км, данные годны', (actorId, model, radiusKm) => {
    const data = rowOf(actorId).data
    expect(data.moonlets).toEqual([{ radiusKm, azimuthDeg: 40, sizeKm: 30, gapKm: 360, model }])
    expect(ringMoonletProblems(data)).toEqual([])
  })

  it('у Сатурна, Урана и Нептуна лунок нет', () => {
    for (const actorId of [39, 40, 41]) expect(rowOf(actorId).data.moonlets).toBeUndefined()
  })
})
