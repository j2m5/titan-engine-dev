import { describe, it, expect, vi } from 'vitest'
import '@/core/framework/TitanThree'

vi.mock('@/core/services/ResourceStorage', () => ({
  resourceStorage: { getTexture: () => ({ name: 'r.png' }), getTextureOrMake: () => ({ name: 'r.png' }) }
}))
vi.mock('@/core/renderables/DetailedRingStreamingSystem/RingAlphaReadback', () => ({
  readRingAlphaProfile: vi.fn(() => null),
  readRingAlphaBins: vi.fn(() => null),
  readRingBandBins: vi.fn(() => null)
}))

import { DataTexture, PerspectiveCamera } from 'three'
import { AsteroidBelt } from '@/core/renderables/AsteroidBelt'
import { fromAstronomicalUnits } from '@/core/helpers/scaling'
import type { Actor } from '@/core/models/Actor'
import type { IAsteroidBeltRenderingObject } from '@/core/models/types'
import type { UpdateContext } from '@/core/UpdateContext'
import type { RingDustVolume } from '@/core/renderables/DetailedRingStreamingSystem/dust/RingDustVolume'
import type { BeltPointLayer } from '@/core/renderables/DetailedRingStreamingSystem/BeltPointLayer'
import type { AsteroidRingSystem } from '@/core/renderables/DetailedRingStreamingSystem'
import { SectorGrid } from '@/core/renderables/DetailedRingStreamingSystem/SectorGrid'
import { AngularDensityProfile } from '@/core/renderables/DetailedRingStreamingSystem/AngularDensityProfile'
import { buildBeltAngularProfile } from '@/core/renderables/DetailedRingStreamingSystem/beltDensityProfile'
import { createDustAngularTexture } from '@/core/renderables/DetailedRingStreamingSystem/dust/DustRadialProfile'
import { angularProfileOf } from '../helpers/ringSystemInternals'

const TWO_PI = Math.PI * 2
const ARCS = [
  { at: 0.12, width: 0.08, gain: 1.6 },
  { at: 0.58, width: 0.12, gain: 1.4 }
]

const DATA: IAsteroidBeltRenderingObject = {
  innerRadiusAu: 40,
  outerRadiusAu: 60,
  thicknessAu: 0.1,
  sizeRangeKm: [0.5, 60],
  spacingKm: 54,
  dustEnabled: true,
  pointCount: 20000
}

const actorOf = (data: IAsteroidBeltRenderingObject): Actor =>
  ({
    placement: null,
    renderingObject: { getAttribute: (): unknown => data },
    getAttribute: (k: string, f: unknown = ''): unknown => (k === 'categoryId' ? 11 : f)
  }) as unknown as Actor

type BeltInternals = {
  angularProfile: Float32Array | null
  dustVolume: RingDustVolume | null
  pointLayer: BeltPointLayer
  streamer: AsteroidRingSystem | null
}
const internals = (belt: AsteroidBelt): BeltInternals => belt as unknown as BeltInternals

/** Стример рождается при первом кадре внутри тора — обход как у движка */
const streamerOf = (belt: AsteroidBelt): AsteroidRingSystem => {
  const camera = new PerspectiveCamera(50, 1, 0.1, 1e12)
  camera.position.set(fromAstronomicalUnits(50), 0, 0)
  camera.updateMatrixWorld(true)
  camera.updateProjectionMatrix()
  camera.matrixWorldInverse.copy(camera.matrixWorld).invert()
  belt.updateMatrixWorld(true)
  belt.traverse((o) => o.updateObject({ delta: 0.016, epoch: 2451545, elapsed: 0, camera } as UpdateContext))
  return internals(belt).streamer!
}

const cascadeGridsOf = (streamer: AsteroidRingSystem): SectorGrid[] =>
  (streamer as unknown as { cascadeGrids: SectorGrid[] }).cascadeGrids

describe('AsteroidBelt: дуги из structure доходят до всех трёх слоёв', () => {
  it('с дугами: профиль построен, пыль под DUST_ARCS с текстурой, сетки стримера с профилем', () => {
    const belt = new AsteroidBelt(actorOf({ ...DATA, structure: { edgeSoftness: 0, gaps: [], clumps: [], arcs: ARCS } }))
    const b = internals(belt)

    expect(b.angularProfile).toBeInstanceOf(Float32Array)
    expect(b.dustVolume!.dustMaterial.defines.DUST_ARCS).toBe('1')
    expect(b.dustVolume!.dustMaterial.uniforms.uDustAngularMap.value).toBeInstanceOf(DataTexture)

    const grids = cascadeGridsOf(streamerOf(belt))
    expect(grids.length).toBeGreaterThan(0)
    for (const grid of grids) expect(angularProfileOf(grid)).toBeInstanceOf(AngularDensityProfile)
  })

  it('точки с дугами ложатся иначе, чем без дуг: у дуги 0.12 их больше, чем напротив', () => {
    const withArcs = new AsteroidBelt(
      actorOf({ ...DATA, structure: { edgeSoftness: 0, gaps: [], clumps: [], arcs: [ARCS[0]] } })
    )
    const positions = internals(withArcs).pointLayer.geometry.getAttribute('position').array as Float32Array
    const count = positions.length / 3
    const centre = ARCS[0].at * TWO_PI
    const half = ARCS[0].width * TWO_PI
    /** Кратчайшее расстояние по кругу между углами */
    const circDist = (a: number, b: number): number => {
      const d = Math.abs(a - b) % TWO_PI
      return Math.min(d, TWO_PI - d)
    }
    let near = 0
    let far = 0
    for (let i = 0; i < count; i++) {
      const theta = Math.atan2(positions[i * 3 + 2], positions[i * 3])
      if (circDist(theta, centre) <= half) near++
      if (circDist(theta, centre + Math.PI) <= half) far++
    }
    expect(near / far).toBeGreaterThan(1.3)
  })

  it('без дуг (structure без arcs или без structure) — null, пыль без дефайна, сетки без профиля', () => {
    for (const data of [DATA, { ...DATA, structure: { edgeSoftness: 0, gaps: [], clumps: [] } }]) {
      const belt = new AsteroidBelt(actorOf(data))
      const b = internals(belt)

      expect(b.angularProfile).toBeNull()
      expect(b.dustVolume!.dustMaterial.defines.DUST_ARCS).toBeUndefined()
      expect(b.dustVolume!.dustMaterial.uniforms.uDustAngularMap.value).toBeNull()
      for (const grid of cascadeGridsOf(streamerOf(belt))) expect(angularProfileOf(grid)).toBeNull()
    }
  })
})

describe('Дуги: один отсчёт угла у стримера, точек и шейдера пыли', () => {
  const at = 0.25
  const bins = 1024
  const profile = buildBeltAngularProfile({ edgeSoftness: 0, gaps: [], clumps: [], arcs: [{ at, width: 0.04, gain: 2 }] }, bins)!
  const expectedAngle = at * TWO_PI // π/2

  /** CPU-зеркало выборки шейдера: u = atan(p.z, p.x) / PI2, wrap Repeat = fract */
  const glslBinOf = (x: number, z: number): number => {
    const u = Math.atan2(z, x) / TWO_PI
    return Math.floor((u - Math.floor(u)) * bins)
  }

  it('пик профиля — у бина at·bins; шейдер из точки (x = 0, z = r), т.е. под углом π/2, читает те же тексели', () => {
    // at·bins = 256 — граница бинов 255 и 256: их центры равноудалены от
    // центра дуги, значения равны, пик страдлит границу
    let peak = 0
    for (let i = 1; i < bins; i++) if (profile[i] > profile[peak]) peak = i
    expect([255, 256]).toContain(peak)
    expect(profile[255]).toBeCloseTo(profile[256], 6)
    // Шейдер: u = 0.25 → бин 256; линейный фильтр в u·bins − 0.5 = 255.5 смешивает ровно 255 и 256
    expect(glslBinOf(0, 1)).toBe(256)
    const bytes = createDustAngularTexture(profile)!.texture.image.data as Uint8Array
    expect(bytes[255]).toBe(255)
    expect(bytes[256]).toBe(255)
    // Отрицательный atan (z < 0) через fract попадает на вторую половину оборота
    expect(glslBinOf(0, -1)).toBe(Math.round(0.75 * bins))
  })

  it('сектор стримера с максимальным счётом — тот, чей centerAngle ≈ π/2', () => {
    const grid = new SectorGrid({ innerRadius: 40, outerRadius: 60, cellSize: 0.5, ringId: 3, densityPerUnit: 2000 })
    grid.setAngularProfile(new AngularDensityProfile(profile))
    const layer = grid.layerAt(10)
    let best = grid.getSectorInfo(10, 0, 0)
    for (let ai = 1; ai < layer.angularSectorCount; ai++) {
      const info = grid.getSectorInfo(10, ai, 0)
      if (info.instanceCount > best.instanceCount) best = info
    }
    expect(Math.abs(best.centerAngle - expectedAngle)).toBeLessThanOrEqual(layer.angularStep)
  })

  it('пик гистограммы углов точек (atan2(z, x)) — ячейка с π/2', () => {
    const angular = new AngularDensityProfile(profile)
    const cells = 64
    const counts = new Array<number>(cells).fill(0)
    for (let i = 0; i < 50000; i++) {
      const theta = angular.sampleAngle((i + 0.5) / 50000)
      const x = Math.cos(theta)
      const z = Math.sin(theta)
      let back = Math.atan2(z, x)
      if (back < 0) back += TWO_PI
      counts[Math.floor((back / TWO_PI) * cells)]++
    }
    const peakCell = counts.indexOf(Math.max(...counts))
    expect(peakCell).toBe(Math.floor(at * cells))
  })
})
