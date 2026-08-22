import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { Texture } from 'three'
import { transmittanceUv } from '@/core/materials/shaders/lib/chunks/sunTransmittanceMath'
import { TRANSMITTANCE_H, TRANSMITTANCE_W } from '@/core/renderables/Atmosphere/AtmosphereLUTGenerator'
import { sunTransmittanceFunctions, sunTransmittanceUniforms } from '@/core/materials/shaders/lib/chunks/SunTransmittance'
import { atmosphereShader } from '@/core/renderables/Atmosphere/atmosphere'
import { PlanetShaderTemplate } from '@/core/materials/shaders/lib/PlanetShaderTemplate'
import { PlanetShader } from '@/core/materials/shaders/PlanetShader'
import { Actor } from '@/core/models/Actor'
import { resourceStorage } from '@/core/services/ResourceStorage'

/** Зеркало GetTextureCoordFromUnitRange: 0.5/n + x·(1 − 1/n). */
function unitToTexCoord(x: number, n: number): number {
  return 0.5 / n + x * (1 - 1 / n)
}

const BOTTOM = 6360
const TOP = 6420

describe('transmittanceUv — зеркало GetTransmittanceTextureUvFromRMu', () => {
  it('на датуме (rho = 0) v — нижний тексель, u — по x_mu', () => {
    const H = Math.sqrt(TOP * TOP - BOTTOM * BOTTOM)
    // mu = 1: d = top − r = d_min → x_mu = 0
    const zenith = transmittanceUv(BOTTOM, 1, BOTTOM, TOP, TRANSMITTANCE_W, TRANSMITTANCE_H)
    expect(zenith.v).toBeCloseTo(unitToTexCoord(0, TRANSMITTANCE_H), 12)
    expect(zenith.u).toBeCloseTo(unitToTexCoord(0, TRANSMITTANCE_W), 12)
    // mu = 0 (горизонт): d = sqrt(top² − r²) = H; x_mu = (H − d_min)/(d_max − d_min), d_max = rho + H = H
    const dMin = TOP - BOTTOM
    const horizon = transmittanceUv(BOTTOM, 0, BOTTOM, TOP, TRANSMITTANCE_W, TRANSMITTANCE_H)
    expect(horizon.u).toBeCloseTo(unitToTexCoord((H - dMin) / (H - dMin), TRANSMITTANCE_W), 12) // = 1
  })

  it('u монотонно растёт при убывании mu (длиннее путь — правее в текстуре)', () => {
    const us = [1, 0.75, 0.5, 0.25, 0].map((mu) => transmittanceUv(BOTTOM, mu, BOTTOM, TOP, TRANSMITTANCE_W, TRANSMITTANCE_H).u)
    for (let i = 1; i < us.length; i++) expect(us[i]).toBeGreaterThan(us[i - 1])
  })

  it('над датумом (r = 6380) v растёт: rho/H', () => {
    const r = 6380
    const H = Math.sqrt(TOP * TOP - BOTTOM * BOTTOM)
    const rho = Math.sqrt(r * r - BOTTOM * BOTTOM)
    const uv = transmittanceUv(r, 1, BOTTOM, TOP, TRANSMITTANCE_W, TRANSMITTANCE_H)
    expect(uv.v).toBeCloseTo(unitToTexCoord(rho / H, TRANSMITTANCE_H), 12)
  })

  it('mu ниже горизонта клампится дискриминантом: u не выходит за 1-й тексель', () => {
    const uv = transmittanceUv(BOTTOM, -0.5, BOTTOM, TOP, TRANSMITTANCE_W, TRANSMITTANCE_H)
    expect(uv.u).toBeLessThanOrEqual(unitToTexCoord(1, TRANSMITTANCE_W) + 1e-12)
    expect(uv.u).toBeGreaterThanOrEqual(unitToTexCoord(0, TRANSMITTANCE_W) - 1e-12)
  })
})

/** Ключевые строки ядра — берутся из источника, чтобы порт не разъехался. */
function coreLine(regex: RegExp): string {
  const m = atmosphereShader.match(regex)
  expect(m, `в atmosphere.ts не найдено: ${regex}`).not.toBeNull()
  return m![0]
}

describe('чанк SunTransmittance — порт ядра Брунетона', () => {
  it('юниформы объявлены', () => {
    for (const u of ['uniform sampler2D uAtmoTransmittance;', 'uniform float uAtmoBottomRadius;', 'uniform float uAtmoTopRadius;', 'uniform float uAtmoSunAngularRadius;', 'uniform float uAtmoDatumRadius;', 'uniform float uSunTintStrength;']) {
      expect(sunTransmittanceUniforms).toContain(u)
    }
  })

  it('размер LUT — из констант генератора, не литерал', () => {
    expect(sunTransmittanceFunctions).toContain(`const int ATMO_TRANSMITTANCE_W = ${TRANSMITTANCE_W};`)
    expect(sunTransmittanceFunctions).toContain(`const int ATMO_TRANSMITTANCE_H = ${TRANSMITTANCE_H};`)
  })

  it('uv-маппинг повторяет ядро: x_mu и x_r', () => {
    expect(sunTransmittanceFunctions).toContain('float x_mu = (d - d_min) / (d_max - d_min);')
    expect(sunTransmittanceFunctions).toContain('float x_r = rho / H;')
    expect(sunTransmittanceFunctions).toContain('0.5 / float(n) + x * (1.0 - 1.0 / float(n))')
    // формула ядра присутствует в источнике в той же форме
    coreLine(/Number x_mu = \(d - d_min\) \/ \(d_max - d_min\);/)
  })

  it('пропускание к солнцу повторяет smoothstep ядра по угловому радиусу', () => {
    coreLine(/smoothstep\(-sin_theta_h \* atmosphere\.sun_angular_radius \/ rad,/)
    expect(sunTransmittanceFunctions).toContain('smoothstep(-sin_theta_h * uAtmoSunAngularRadius, sin_theta_h * uAtmoSunAngularRadius, muS - cos_theta_h)')
    expect(sunTransmittanceFunctions).toContain('float sin_theta_h = uAtmoBottomRadius / r;')
  })

  it('sunTint нормирован зенитом и клампится к 1', () => {
    expect(sunTransmittanceFunctions).toContain('vec3 sunTint(float muS)')
    expect(sunTransmittanceFunctions).toContain('atmoTransmittanceToSun(uAtmoDatumRadius, muS)')
    expect(sunTransmittanceFunctions).toContain('max(atmoTransmittanceToSun(uAtmoDatumRadius, 1.0), vec3(1e-3))')
    expect(sunTransmittanceFunctions).toContain('clamp(')
  })
})

describe('PlanetShaderTemplate: тинт солнца под USE_SUN_TINT', () => {
  const frag = PlanetShaderTemplate.fragmentShader

  it('чанки включены под гейтом', () => {
    expect(frag).toContain('#include <sunTransmittanceUniforms>')
    expect(frag).toContain('#include <sunTransmittanceFunctions>')
    const gate = frag.indexOf('#ifdef USE_SUN_TINT')
    expect(gate).toBeGreaterThan(-1)
    expect(frag.indexOf('#include <sunTransmittanceFunctions>')).toBeGreaterThan(gate)
  })

  it('day умножается на тинт ПОСЛЕ облаков и ДО микса с ночью, mu_s — из vLocalDir', () => {
    const dayLine = frag.indexOf('vec3 day = cloudColor + dayColor * (1.0 - cloudAlpha);')
    const tint = frag.indexOf('day *= mix(vec3(1.0), sunTint(dot(normalize(vLocalDir), normalize(vLocalLightDirection))), uSunTintStrength);')
    const night = frag.indexOf('vec3 finalColor = mix(night, day, dayFactor);')
    expect(dayLine).toBeGreaterThan(-1)
    expect(tint).toBeGreaterThan(dayLine)
    expect(night).toBeGreaterThan(tint)
  })

  it('tint не берёт нормаль рельефа и не берёт vPosition', () => {
    // Лукахед (?!ize) отсекает ложное срабатывание на normalize(vLocalDir) —
    // мандатная строка задачи; проверяем именно голую переменную normal.
    expect(frag).not.toMatch(/sunTint\(dot\(normal(?!ize)/)
    expect(frag).not.toMatch(/sunTint\([^)]*vPosition/)
  })
})

describe('PlanetShader: ручка uSunTintStrength', () => {
  function seedPlaceholderKeys(): void {
    for (const name of ['', 'default.png', 'night.jpg']) {
      const texture = new Texture()
      texture.name = name
      texture.image = { width: 4, height: 2 }
      resourceStorage.addTexture(texture)
    }
  }

  function stubActor(data: Record<string, unknown>): Actor {
    return {
      renderingObject: { getAttribute: () => ({ emission: 1, bumpScale: 1, ...data }) },
      children: { where: () => ({ first: () => undefined, isNotEmpty: () => false }) },
      resources: { where: () => ({ first: () => undefined }) }
    } as unknown as Actor
  }

  beforeEach(() => seedPlaceholderKeys())
  afterEach(() => resourceStorage.deleteAllTextures())

  it('ручка из данных тела доезжает в юниформ', () => {
    const shader = new PlanetShader(stubActor({ sunTintStrength: 0.4 }))
    expect(shader.uniforms.uSunTintStrength.value).toBe(0.4)
  })

  it('без поля — дефолт 1', () => {
    const shader = new PlanetShader(stubActor({}))
    expect(shader.uniforms.uSunTintStrength.value).toBe(1)
  })
})
