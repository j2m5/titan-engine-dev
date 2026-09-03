import { vi, type Mock } from 'vitest'
import { Vector3 } from 'three'

const fakeTexture = { name: 'ring.png' }

vi.mock('@/core/services/ResourceStorage', () => ({
  resourceStorage: {
    getTexture: () => fakeTexture,
    getTextureOrMake: () => fakeTexture
  }
}))

vi.mock('@/core/renderables/DetailedRingStreamingSystem/RingAlphaReadback', () => ({
  readRingAlphaProfile: vi.fn(() => null),
  readRingAlphaBins: vi.fn(() => null),
  readRingBandBins: vi.fn(() => null)
}))

import { bandTint, columnFraction, layerShadow, layerTau } from './tauMirror'
import { ringDustRaymarchFunctions, ringDustUniforms } from '@/core/materials/shaders/lib/chunks/RingDust'
import { InstancedAsteroidShaderTemplate } from '@/core/materials/shaders/lib/InstancedAsteroidShaderTemplate'
import { BillboardAsteroidMaterial } from '@/core/renderables/DetailedRingStreamingSystem/BillboardAsteroidMaterial'
import { RingDustRaymarchMaterial } from '@/core/renderables/DetailedRingStreamingSystem/dust/RingDustRaymarchMaterial'
import { AsteroidRingSystem } from '@/core/renderables/DetailedRingStreamingSystem'
import { readRingBandBins } from '@/core/renderables/DetailedRingStreamingSystem/RingAlphaReadback'
import { toThreeJSUnits } from '@/core/helpers/scaling'
import { Actor } from '@/core/models/Actor'
import { internalsOf, poolOf } from '../helpers/ringSystemInternals'

describe('Самозатенение слоя кольца (зеркало ringLayerShadow)', () => {
  it('толща слоя: прозрачная полоса — 0, α = 0.9 — ln(10), α = 1 зажата', () => {
    expect(layerTau(0, 1)).toBeCloseTo(0, 12)
    expect(layerTau(0.9, 1)).toBeCloseTo(Math.log(10), 9)
    expect(Number.isFinite(layerTau(1, 1))).toBe(true)
    expect(layerTau(0.9, 0.5)).toBeCloseTo(Math.log(10) / 2, 9)
  })

  it('доля столба над точкой: верх слоя 0, средняя плоскость ½, низ 1, за слоем зажато', () => {
    const h = 10
    expect(columnFraction(h, h)).toBe(0)
    expect(columnFraction(0, h)).toBeCloseTo(0.5, 12)
    expect(columnFraction(-h, h)).toBe(1)
    expect(columnFraction(2 * h, h)).toBe(0)
    expect(columnFraction(-3 * h, h)).toBe(1)
    // монотонно убывает с высотой
    let prev = 1
    for (let y = -h; y <= h; y += h / 20) {
      const f = columnFraction(y, h)
      expect(f).toBeLessThanOrEqual(prev + 1e-12)
      prev = f
    }
  })

  it('камень на верхней кромке к солнцу не затенён, в средней плоскости — на половину толщи', () => {
    const up = new Vector3(0, 1, 0)
    expect(layerShadow(new Vector3(50, 10, 0), up, 0.9, 10, 1)).toBeCloseTo(1, 12)
    expect(layerShadow(new Vector3(50, 0, 0), up, 0.9, 10, 1)).toBeCloseTo(Math.exp(-Math.log(10) / 2), 9)
  })

  it('сторона солнца: при звезде снизу верхний камень в тени, нижний освещён', () => {
    const down = new Vector3(0, -1, 0)
    expect(layerShadow(new Vector3(50, 10, 0), down, 0.9, 10, 1)).toBeCloseTo(Math.exp(-Math.log(10)), 9)
    expect(layerShadow(new Vector3(50, -10, 0), down, 0.9, 10, 1)).toBeCloseTo(1, 12)
  })

  it('низкое солнце удлиняет путь: тень глубже, пол синуса 0.05 держит конечной', () => {
    const p = new Vector3(50, 0, 0)
    const high = layerShadow(p, new Vector3(0, 1, 0), 0.5, 10, 1)
    const low = layerShadow(p, new Vector3(1, 0.2, 0).normalize(), 0.5, 10, 1)
    const grazing = layerShadow(p, new Vector3(1, 0, 0), 0.5, 10, 1)
    expect(low).toBeLessThan(high)
    expect(grazing).toBeLessThan(low)
    expect(grazing).toBeGreaterThan(0)
    expect(grazing).toBeCloseTo(Math.exp((-layerTau(0.5, 1) * 0.5) / 0.05), 9)
  })

  it('сила 0 выключает самозатенение', () => {
    expect(layerShadow(new Vector3(50, -10, 0), new Vector3(0, 1, 0), 0.99, 10, 0)).toBe(1)
  })
})

describe('Тинт по полосам (зеркало ringBandTint)', () => {
  it('цвет полосы делится на средний, зажат в [0.5, 1.5]', () => {
    expect(bandTint([0.6, 0.6, 0.6], [0.6, 0.6, 0.6], 1)).toEqual([1, 1, 1])
    expect(bandTint([0.9, 0.3, 0.6], [0.6, 0.6, 0.6], 1)).toEqual([1.5, 0.5, 1])
    expect(bandTint([0.1, 0.1, 0.1], [0.6, 0.6, 0.6], 1)).toEqual([0.5, 0.5, 0.5])
  })

  it('сила смешивает с единицей, чёрный средний не делит на ноль', () => {
    expect(bandTint([0.9, 0.3, 0.6], [0.6, 0.6, 0.6], 0.5)).toEqual([1.25, 0.75, 1])
    expect(bandTint([0.9, 0.3, 0.6], [0.6, 0.6, 0.6], 0)).toEqual([1, 1, 1])
    expect(Number.isFinite(bandTint([0.5, 0.5, 0.5], [0, 0, 0], 1)[0])).toBe(true)
  })
})

describe('RingDust GLSL: слой кольца и полосы', () => {
  it('чанк объявляет текстуру полос, толщину слоя и ручки', () => {
    for (const name of [
      'uniform sampler2D uRingBandMap;',
      'uniform float uRingBandEnabled;',
      'uniform vec3 uBandMeanColor;',
      'uniform float uBandTintStrength;',
      'uniform float uLayerHalfThickness;',
      'uniform float uLayerShadowStrength;'
    ]) {
      expect(ringDustUniforms).toContain(name)
    }
  })

  it('ядро (общее для камней и марша) содержит толщу, долю столба, тень слоя и тинт — зеркала формул', () => {
    const core = ringDustRaymarchFunctions
    expect(core).toContain('float ringLayerTau(float r)')
    expect(core).toContain('-log(1.0 - min(a, 0.98)) * uLayerShadowStrength')
    expect(core).toContain('float ringLayerColumnFraction(float ySun)')
    expect(core).toContain('u >= 0.0 ? (1.0 - u) * (1.0 - u) * 0.5 : 1.0 - (1.0 + u) * (1.0 + u) * 0.5')
    expect(core).toContain('float ringLayerShadow(vec3 p)')
    expect(core).toContain('max(abs(uDustLightDirRing.y), 0.05)')
    expect(core).toContain('vec3 ringBandTint(float r)')
    expect(core).toContain('clamp(band / max(uBandMeanColor, vec3(0.05)), 0.5, 1.5)')
  })

  it('L0: тень слоя гасит прямой свет (диффуз и блик), тинт ложится на альбедо до микрослоя', () => {
    const fs = InstancedAsteroidShaderTemplate.fragmentShader
    expect(fs).toContain('float direct = planetShadow * ringLayerShadow(vRingPos);')
    expect(fs).toContain('lightIntensity * surfAO * direct')
    expect(fs).toContain('max(NdotL, 0.0) * direct')
    expect(fs).toContain('albedo *= ringBandTint(length(vRingPos.xz));')
    expect(fs.indexOf('ringBandTint(')).toBeLessThan(fs.indexOf('uDetailMapsEnabled > 0.5'))
  })

  it('L1: та же тень слоя и тинт', () => {
    const fs = new BillboardAsteroidMaterial().fragmentShader
    expect(fs).toContain('float direct = planetShadow * ringLayerShadow(vRingPos);')
    expect(fs).toContain('ringBandTint(length(vRingPos.xz))')
  })

  it('марш пыли: тень слоя на каждом шаге рядом с тенью планеты', () => {
    const fs = new RingDustRaymarchMaterial().fragmentShader
    expect(fs).toContain('litTau += contrib * ringDustPlanetShadow(p) * ringLayerShadow(p);')
  })
})

describe('AsteroidRingSystem: проводка слоя и полос', () => {
  const makeFakeActor = (data: Record<string, unknown> = {}): Actor =>
    ({
      getAttribute: () => 42,
      renderingObject: {
        getAttribute: () => ({ innerRadius: 70000, outerRadius: 140000, ...data })
      },
      resources: { first: () => ({ getAttribute: () => 'ring.png' }) }
    }) as unknown as Actor

  beforeEach(() => {
    ;(readRingBandBins as Mock).mockReset()
    ;(readRingBandBins as Mock).mockReturnValue(null)
  })

  it('полутолщина слоя и дефолты ручек уходят во все три материала', () => {
    const system = new AsteroidRingSystem(makeFakeActor({ thicknessKm: 400 }))
    const sets = [
      poolOf(system).geometryMaterial.uniforms,
      poolOf(system).billboardMaterial.uniforms,
      internalsOf(system).dustVolume!.dustMaterial.uniforms
    ]
    for (const u of sets) {
      expect(u.uLayerHalfThickness.value).toBeCloseTo(toThreeJSUnits(200), 9)
      expect(u.uLayerShadowStrength.value).toBe(0.6)
      expect(u.uBandTintStrength.value).toBe(1)
      // Без прочитанной текстуры полос обе фичи выключены
      expect(u.uRingBandEnabled.value).toBe(0)
    }
  })

  it('данные кольца задают силу самозатенения и тинта', () => {
    const system = new AsteroidRingSystem(makeFakeActor({ layerShadowStrength: 0.3, bandTintStrength: 0.5 }))
    const u = poolOf(system).billboardMaterial.uniforms
    expect(u.uLayerShadowStrength.value).toBe(0.3)
    expect(u.uBandTintStrength.value).toBe(0.5)
  })

  it('прочитанные полосы: одна RGBA-текстура и средний цвет во все три материала, фичи включены', () => {
    ;(readRingBandBins as Mock).mockReturnValue({
      color: new Float32Array([1, 0, 0, 0, 0, 1]),
      alpha: new Float32Array([0.5, 1])
    })
    const system = new AsteroidRingSystem(makeFakeActor())
    internalsOf(system).__tryBuildDensityProfile()

    const l0 = poolOf(system).geometryMaterial.uniforms
    const l1 = poolOf(system).billboardMaterial.uniforms
    const dust = internalsOf(system).dustVolume!.dustMaterial.uniforms
    for (const u of [l0, l1, dust]) {
      expect(u.uRingBandEnabled.value).toBe(1)
      expect(u.uRingBandMap.value).toBe(l0.uRingBandMap.value)
      expect(u.uRingBandMap.value).not.toBeNull()
    }
    // Средний цвет взвешен по альфе: (1·0.5 + 0·1)/1.5 = 1/3 по R, 2/3 по B
    expect(l0.uBandMeanColor.value.x).toBeCloseTo(1 / 3, 6)
    expect(l0.uBandMeanColor.value.z).toBeCloseTo(2 / 3, 6)
    // Тот же размытый readback, что у пыли (без порога alphaTest)
    expect(readRingBandBins).toHaveBeenCalledWith(fakeTexture, expect.any(Number), expect.any(Number), {
      blurRadius: toThreeJSUnits(600)
    })
  })
})
