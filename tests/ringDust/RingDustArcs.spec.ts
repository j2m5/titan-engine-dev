import { describe, it, expect, vi } from 'vitest'
import { ClampToEdgeWrapping, Color, DataTexture, LinearFilter, RepeatWrapping } from 'three'

vi.mock('@/core/services/ResourceStorage', () => ({
  resourceStorage: { getTexture: () => ({ name: 'ring.png' }), getTextureOrMake: () => ({ name: 'ring.png' }) }
}))
vi.mock('@/core/renderables/DetailedRingStreamingSystem/RingAlphaReadback', () => ({
  readRingAlphaProfile: vi.fn(() => null),
  readRingAlphaBins: vi.fn(() => null),
  readRingBandBins: vi.fn(() => null)
}))

import { RingDustRaymarchMaterial } from '@/core/renderables/DetailedRingStreamingSystem/dust/RingDustRaymarchMaterial'
import { RingDustVolume } from '@/core/renderables/DetailedRingStreamingSystem/dust/RingDustVolume'
import { createDustAngularTexture } from '@/core/renderables/DetailedRingStreamingSystem/dust/DustRadialProfile'
import { buildBeltAngularProfile } from '@/core/renderables/DetailedRingStreamingSystem/beltDensityProfile'
import { AsteroidRingSystem } from '@/core/renderables/DetailedRingStreamingSystem'
import type { Actor } from '@/core/models/Actor'
import { internalsOf } from '../helpers/ringSystemInternals'

const flat = { edgeSoftness: 0, gaps: [], clumps: [] }
const ARC_PROFILE = buildBeltAngularProfile({ ...flat, arcs: [{ at: 0.25, width: 0.05, gain: 2 }] })!

const makeVolume = (extra: Partial<{ angularProfile: Float32Array }> = {}) =>
  new RingDustVolume({
    innerRadius: 70,
    outerRadius: 140,
    dustScaleHeight: 0.5,
    dustDensity: 0.01,
    dustColor: new Color(0x9b968c),
    anglePower: 2,
    nearFade: 20,
    maxSteps: 16,
    planetRadius: 0,
    ...extra
  })

describe('RingDustRaymarchMaterial: дуги (DUST_ARCS)', () => {
  it('без arcs дефайна нет, в тексте нет ни выборки угла, ни юниформа карты', () => {
    const m = new RingDustRaymarchMaterial()
    expect(m.defines.DUST_ARCS).toBeUndefined()
    expect(m.fragmentShader).not.toContain('uDustAngularMap')
    expect(m.fragmentShader).not.toContain('atan(p.z, p.x)')
  })

  it('arcs: true — дефайн стоит, выборка atan(p.z, p.x)/PI2 в марше после клочьев и до накопления tau', () => {
    const m = new RingDustRaymarchMaterial(undefined, { clumps: true, arcs: true })
    expect(m.defines.DUST_ARCS).toBe('1')
    const fs = m.fragmentShader
    const sample = 'texture2D(uDustAngularMap, vec2(atan(p.z, p.x) / PI2, 0.5)).r * uDustAngularMapScale'
    expect(fs).toContain(sample)
    const arcsIdx = fs.indexOf(sample)
    expect(arcsIdx).toBeGreaterThan(fs.indexOf('mix(1.0 - clumpGain, 1.0 + clumpGain,'))
    expect(arcsIdx).toBeLessThan(fs.indexOf('tau += contrib;'))
    expect(fs).toContain('uniform sampler2D uDustAngularMap;')
  })

  it('юниформы дуг присутствуют всегда и нейтральны по умолчанию', () => {
    const u = new RingDustRaymarchMaterial().uniforms
    expect(u.uDustAngularMap.value).toBeNull()
    expect(u.uDustAngularMapScale.value).toBe(0)
  })
})

describe('createDustAngularTexture', () => {
  it('R-канал, линейный фильтр, Repeat по u — оборот замкнут без шва, среднее модуляции ≈ 1', () => {
    const angular = createDustAngularTexture(ARC_PROFILE)!
    expect(angular.texture.wrapS).toBe(RepeatWrapping)
    expect(angular.texture.wrapT).toBe(ClampToEdgeWrapping)
    expect(angular.texture.magFilter).toBe(LinearFilter)
    expect(angular.texture.image.width).toBe(ARC_PROFILE.length)

    const bytes = angular.texture.image.data as Uint8Array
    const mean = (Array.from(bytes).reduce((s, b) => s + b / 255, 0) / bytes.length) * angular.scale
    expect(mean).toBeCloseTo(1, 2)
  })

  it('вырожденный профиль — null', () => {
    expect(createDustAngularTexture(new Float32Array([0, 0, 0]))).toBeNull()
  })
})

describe('RingDustVolume: дуги из конфига', () => {
  it('с angularProfile — дефайн, текстура и множитель в юниформах', () => {
    const volume = makeVolume({ angularProfile: ARC_PROFILE })
    const u = volume.dustMaterial.uniforms
    expect(volume.dustMaterial.defines.DUST_ARCS).toBe('1')
    expect(u.uDustAngularMap.value).toBeInstanceOf(DataTexture)
    expect(u.uDustAngularMapScale.value).toBeGreaterThan(1)
  })

  it('без angularProfile — дефайна нет, юниформы нейтральны', () => {
    const volume = makeVolume()
    expect(volume.dustMaterial.defines.DUST_ARCS).toBeUndefined()
    expect(volume.dustMaterial.uniforms.uDustAngularMap.value).toBeNull()
  })

  it('вырожденный профиль (нули) — дефайн не ставится', () => {
    const volume = makeVolume({ angularProfile: new Float32Array(16) })
    expect(volume.dustMaterial.defines.DUST_ARCS).toBeUndefined()
  })
})

describe('AsteroidRingSystem: дуги доходят до объёма пыли стримера', () => {
  const beltActor = (): Actor =>
    ({
      getAttribute: () => 1,
      renderingObject: { getAttribute: () => ({ innerRadius: 70000, outerRadius: 140000, alphaTest: 0.1 }) },
      resources: { first: () => ({ getAttribute: () => 'ring.png' }) }
    }) as unknown as Actor

  it('angularProfileSource ставит DUST_ARCS объёму стримера; без него — нет', () => {
    const withArcs = new AsteroidRingSystem(beltActor(), { angularProfileSource: ARC_PROFILE })
    expect(internalsOf(withArcs).dustVolume!.dustMaterial.defines.DUST_ARCS).toBe('1')

    const plain = new AsteroidRingSystem(beltActor(), {})
    expect(internalsOf(plain).dustVolume!.dustMaterial.defines.DUST_ARCS).toBeUndefined()
  })
})
