import { describe, expect, it } from 'vitest'
import { distFade, fbmTail, giantDomain, polarWeight } from '@/core/materials/shaders/lib/chunks/giantDetailMath'
import { giantDetailFunctions, giantDetailUniforms } from '@/core/materials/shaders/lib/chunks/GiantDetail'
import { AppShaderChunk } from '@/core/materials/shaders/lib/chunks'

function dirOf(latDeg: number, lonDeg: number): [number, number, number] {
  const lat = (latDeg * Math.PI) / 180
  const lon = (lonDeg * Math.PI) / 180
  return [Math.cos(lat) * Math.cos(lon), Math.sin(lat), Math.cos(lat) * Math.sin(lon)]
}

describe('giantDomain — домен без шва, вытянутый вдоль полос', () => {
  const R = 69911, stretch = 6, scale = 400

  it('периодичен по долготе: lon и lon + 360° дают одну точку', () => {
    const a = giantDomain(dirOf(10, 179.9), R, stretch, scale)
    const b = giantDomain(dirOf(10, -180.1), R, stretch, scale)
    for (let i = 0; i < 3; i++) expect(a[i]).toBeCloseTo(b[i], 6)
  })

  it('шаг по широте сдвигает домен в stretch раз сильнее шага по долготе', () => {
    const base = giantDomain(dirOf(0, 0), R, stretch, scale)
    const dLon = giantDomain(dirOf(0, 1), R, stretch, scale)
    const dLat = giantDomain(dirOf(1, 0), R, stretch, scale)
    const dist = (p: number[], q: number[]): number => Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2])
    expect(dist(dLat, base) / dist(dLon, base)).toBeCloseTo(stretch, 2)
  })

  it('масштаб: один градус широты на экваторе = R·π/180 / scale клеток (× stretch/stretch)', () => {
    const base = giantDomain(dirOf(0, 0), R, stretch, scale)
    const dLat = giantDomain(dirOf(1, 0), R, stretch, scale)
    expect(Math.abs(dLat[2] - base[2])).toBeCloseTo(((R * Math.PI) / 180) / scale, 3)
  })
})

describe('polarWeight / distFade', () => {
  it('полюса гаснут, экватор — единица', () => {
    expect(polarWeight(0)).toBe(1)
    expect(polarWeight(0.85)).toBe(1)
    expect(polarWeight(0.98)).toBe(0)
    expect(polarWeight(-0.99)).toBe(0)
  })
  it('fade: 1 внутри 0.4·F, 0 за F', () => {
    expect(distFade(0.3, 1)).toBe(1)
    expect(distFade(0.4, 1)).toBe(1)
    expect(distFade(1, 1)).toBe(0)
    expect(distFade(0.7, 1)).toBeGreaterThan(0)
    expect(distFade(0.7, 1)).toBeLessThan(1)
  })
})

describe('fbmTail — хвост giantFbm гаснет по норме, без обрыва', () => {
  it('полный размах при norm ≥ 0.25, нейтраль при norm = 0', () => {
    expect(fbmTail(1, 0.25)).toBe(1)
    expect(fbmTail(1, 0)).toBe(0.5)
  })

  it('монотонно растёт по norm на (0, 0.25) — без скачка', () => {
    const samples = [0.01, 0.05, 0.1, 0.15, 0.2, 0.24]
    let prev = fbmTail(1, 0)
    for (const norm of samples) {
      const value = fbmTail(1, norm)
      expect(value).toBeGreaterThan(prev)
      prev = value
    }
    expect(fbmTail(1, 0.25)).toBeGreaterThan(prev)
  })
})

describe('чанк GiantDetail — контракт', () => {
  it('зарегистрирован и объявляет юниформы', () => {
    expect(AppShaderChunk.giantDetailUniforms).toBe(giantDetailUniforms)
    expect(AppShaderChunk.giantDetailFunctions).toBe(giantDetailFunctions)
    for (const u of ['uGiantRadiusKm', 'uGiantDetailScaleKm', 'uGiantDetailStretch', 'uGiantDetailWarp', 'uGiantDetailTextureWarp', 'uGiantDetailStrength', 'uGiantDetailFadeUnits']) {
      expect(giantDetailUniforms).toContain(`uniform float ${u};`)
    }
  })

  it('домен и веса совпадают с зеркалом по форме', () => {
    expect(giantDetailFunctions).toContain('vec3(cos(lon), sin(lon), lat * uGiantDetailStretch) * uGiantRadiusKm / (uGiantDetailStretch * uGiantDetailScaleKm)')
    expect(giantDetailFunctions).toContain('1.0 - smoothstep(0.85, 0.98, abs(dir.y))')
    expect(giantDetailFunctions).toContain('1.0 - smoothstep(0.4 * uGiantDetailFadeUnits, uGiantDetailFadeUnits, viewDistance)')
  })

  it('fwidth только для следа октав, производных нормали нет', () => {
    expect(giantDetailFunctions.match(/fwidth\(/g)).toHaveLength(1)
    expect(giantDetailFunctions).toContain('float footprint = length(fwidth(q));')
    expect(giantDetailFunctions).not.toMatch(/dFd[xy]\(/)
  })

  it('гашение октав, варп по шуму и по яркости текстуры, вклад по яркости', () => {
    expect(giantDetailFunctions).toContain('1.0 - smoothstep(0.5, 1.0, footprint * frequency)')
    expect(giantDetailFunctions).toContain('q += uGiantDetailWarp * (vec3(snoise(q * 0.25), snoise(q * 0.25 + 17.0), snoise(q * 0.25 + 31.0)))')
    expect(giantDetailFunctions).toContain('q.z += uGiantDetailTextureWarp * dLum;')
    expect(giantDetailFunctions).toContain('smoothstep(0.05, 0.35, lumTex)')
    expect(giantDetailFunctions).toContain('albedoMul *= clamp(1.0 + contrast * (n - 0.5) * 2.0, 0.0, 2.0);')
  })

  it('хвост fbm гаснет по норме, а не обрывается (I-1) — без старого тернарного обрыва', () => {
    expect(giantDetailFunctions).toContain(
      'return 0.5 + 0.5 * (sum / max(norm, 1e-4)) * smoothstep(0.0, 0.25, norm);'
    )
    expect(giantDetailFunctions).not.toMatch(/norm > 1e-4 \? 0\.5 \+ 0\.5 \* sum \/ norm : 0\.5;/)
  })

  it('local distFade не затеняет vec3 fade(vec3) из noiseFunctions', () => {
    expect(giantDetailFunctions).toContain('float distFade = 1.0 - smoothstep(0.4 * uGiantDetailFadeUnits')
    expect(giantDetailFunctions).not.toMatch(/float fade =/)
  })
})
