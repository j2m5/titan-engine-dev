import { describe, expect, it } from 'vitest'
import {
  CLOUD_SLANT_MIN_MU,
  cloudDip,
  cloudLayerPoint,
  cloudShadowUvOffset,
  cloudSlantAlpha,
  cloudSunLight,
  type Vec3
} from '@/core/materials/shaders/lib/chunks/cloudLayerMath'
import { cloudShadowUvOffset as legacyOffset } from '@/core/materials/shaders/lib/chunks/terrainLightMath'
import { cloudLayerFunctions, cloudLayerUniforms } from '@/core/materials/shaders/lib/chunks/CloudLayer'
import { AppShaderChunk } from '@/core/materials/shaders/lib/chunks'

const angle = (a: Vec3, b: Vec3): number => Math.acos(Math.min(1, Math.max(-1, a[0] * b[0] + a[1] * b[1] + a[2] * b[2])))

describe('cloudLayerPoint — точка слоя на луче взгляда', () => {
  it('в надир точка слоя совпадает с точкой поверхности', () => {
    const d: Vec3 = [0, 1, 0]
    const p = cloudLayerPoint(d, [0, -1, 0], 3, 0.003)
    for (const c of [0, 1, 2]) expect(p[c]).toBeCloseTo(d[c], 12)
  })

  it('h ≤ 0 — параллакса нет', () => {
    const d: Vec3 = [1, 0, 0]
    expect(cloudLayerPoint(d, [0, 0, 1], 3, 0)).toEqual(d)
    expect(cloudLayerPoint(d, [0, 0, 1], 3, -1)).toEqual(d)
  })

  it('касательный взгляд: сдвиг на угол atan(√(h(2R+h))/R), к камере', () => {
    const R = 3
    const h = 0.003
    const d: Vec3 = [1, 0, 0]
    const v: Vec3 = [0, 0, 1] // камера в −z, луч идёт в +z, касательно к поверхности в d
    const p = cloudLayerPoint(d, v, R, h)
    expect(angle(p, d)).toBeCloseTo(Math.atan(Math.sqrt(h * (2 * R + h)) / R), 10)
    expect(p[2]).toBeLessThan(0) // точка слоя ближе к камере
  })
})

describe('cloudSlantAlpha — утолщение у края', () => {
  it('краевые значения: 0 → 0, 1 → 1, в надир — без изменений', () => {
    for (const mu of [1, 0.5, 0.1, 0.01, 0]) {
      expect(cloudSlantAlpha(0, mu)).toBe(0)
      expect(cloudSlantAlpha(1, mu)).toBe(1)
    }
    expect(cloudSlantAlpha(0.4, 1)).toBeCloseTo(0.4, 12)
  })

  it('растёт к краю и упирается в кламп μ', () => {
    expect(cloudSlantAlpha(0.3, 0.5)).toBeGreaterThan(cloudSlantAlpha(0.3, 1))
    expect(cloudSlantAlpha(0.3, 0.2)).toBeGreaterThan(cloudSlantAlpha(0.3, 0.5))
    expect(cloudSlantAlpha(0.3, 0.0)).toBe(cloudSlantAlpha(0.3, CLOUD_SLANT_MIN_MU))
    expect(Number.isFinite(cloudSlantAlpha(0.3, 0))).toBe(true)
  })
})

describe('cloudSunLight — свет в точке слоя', () => {
  it('h = 0 и мягкость 0 — ламберт max(μs, 0)', () => {
    const c: Vec3 = [0, 1, 0]
    for (const s of [[0, 1, 0], [0.6, 0.8, 0], [1, 0, 0], [0.6, -0.8, 0]] as Vec3[]) {
      expect(cloudSunLight(c, s, 3, 0, 0)).toBeCloseTo(Math.max(s[1], 0), 12)
    }
  })

  it('облако на высоте освещено за терминатором поверхности', () => {
    const R = 3
    const h = 0.03
    const dip = cloudDip(R, h)
    expect(dip).toBeCloseTo(Math.sqrt(h * (2 * R + h)) / (R + h), 12)
    const mu = -dip / 2
    const sun: Vec3 = [Math.sqrt(1 - mu * mu), mu, 0]
    expect(cloudSunLight([0, 1, 0], sun, R, h, 0)).toBeGreaterThan(0)
  })

  it('монотонно по μs и не выше 1', () => {
    let prev = -1
    for (let mu = -1; mu <= 1; mu += 0.1) {
      const l = cloudSunLight([0, 1, 0], [Math.sqrt(Math.max(1 - mu * mu, 0)), mu, 0], 3, 0.003, 0.1)
      expect(l).toBeGreaterThanOrEqual(prev)
      expect(l).toBeLessThanOrEqual(1)
      prev = l
    }
  })
})

describe('cloudShadowUvOffset переехал в cloudLayerMath', () => {
  it('terrainLightMath реэкспортирует ту же функцию', () => {
    expect(legacyOffset).toBe(cloudShadowUvOffset)
  })
})

describe('чанк CloudLayer', () => {
  it('зарегистрирован в AppShaderChunk', () => {
    expect(AppShaderChunk.cloudLayerUniforms).toBe(cloudLayerUniforms)
    expect(AppShaderChunk.cloudLayerFunctions).toBe(cloudLayerFunctions)
  })

  it('юниформы слоя', () => {
    for (const u of ['uCloudHeightUnits', 'uCloudHeightKm', 'uCloudLightSoftness', 'uCloudShadowStrength']) {
      expect(cloudLayerUniforms).toContain(`uniform float ${u};`)
    }
  })

  it('формулы — как в CPU-зеркале; разность квадратов радиусов без вычитания', () => {
    const f = cloudLayerFunctions
    expect(f).toContain('float t = b + sqrt(max(b * b + h * (2.0 * R + h), 0.0));')
    expect(f).toContain('return 1.0 - pow(max(1.0 - alpha, 0.0), 1.0 / max(muV, CLOUD_SLANT_MIN_MU));')
    expect(f).toContain('float dip = sqrt(h * (2.0 * R + h)) / (R + h);')
    expect(f).toContain('return clamp((dot(cloudDir, sunLocal) + k) / (1.0 + k), 0.0, 1.0);')
    expect(f).not.toMatch(/\(R \+ h\) \* \(R \+ h\) - R \* R/)
    expect(f).not.toContain('0.5 * cloudLight + 0.1')
  })

  it('свет облака: тинт и цвет звезды только под своими гейтами', () => {
    const body = cloudLayerFunctions.slice(cloudLayerFunctions.indexOf('vec3 cloudLitRadiance('))
    expect(body).toMatch(/#ifdef USE_SUN_TINT\s+radiance \*= mix\(vec3\(1\.0\), sunTintAt\(uAtmoDatumRadius \+ uCloudHeightKm, dot\(cloudDir, sunLocal\)\), uSunTintStrength\);\s+#endif/)
    expect(body).toMatch(/#ifdef USE_LIGHT_TINT\s+radiance \*= uLightColor;\s+#endif/)
  })

  it('тень облаков — прежний закон (сдвиг h·tan θ, кап cos, гашение к терминатору, полюсный гард)', () => {
    const f = cloudLayerFunctions
    expect(f).toContain('float cosZ = max(muS, CLOUD_SHADOW_MIN_COS);')
    expect(f).toContain('vec3 offsetUnits = sunTangent / cosZ * uCloudHeightUnits;')
    expect(f).toContain('return 1.0 - uCloudShadowStrength * alphaShadow * smoothstep(0.0, 0.2, muS) * step(1e-4, length(eastLocal));')
  })
})
