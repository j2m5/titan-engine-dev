import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { Texture } from 'three'
import { PlanetShaderTemplate } from '@/core/materials/shaders/lib/PlanetShaderTemplate'
import { PlanetShader } from '@/core/materials/shaders/PlanetShader'
import { Actor } from '@/core/models/Actor'
import { resourceStorage } from '@/core/services/ResourceStorage'

/**
 * Конструктор PlanetShader читает 'default.png'/'night.jpg' (diffuse/night
 * заглушки) и '' (ringMap-заглушка) через getTextureOrMake — промах строит
 * PlaceholderTexture (canvas 2d, недоступен в jsdom). Тот же приём, что
 * seedPlaceholderKeys в PlanetCloudOpacity.spec.ts.
 */
function seedPlaceholderKeys(): void {
  for (const name of ['', 'default.png', 'night.jpg']) {
    const texture = new Texture()
    texture.name = name
    texture.image = { width: 4, height: 2 }
    resourceStorage.addTexture(texture)
  }
}

/** CPU-зеркало множителя суши: mix(1, mix(ambient, 1, max(NdotL,0)), lambert). */
function terrainShade(ndotl: number, lambert: number, ambient: number): number {
  const lit = ambient + (1 - ambient) * Math.max(ndotl, 0)
  return 1 + (lit - 1) * lambert
}

describe('PlanetShaderTemplate: ламберт суши (спайк, USE_TERRAIN_UV)', () => {
  const frag: string = PlanetShaderTemplate.fragmentShader

  it('юниформы объявлены, множитель стоит на dayColor — ДО состава с облаками', () => {
    expect(frag).toContain('uniform float uTerrainLambert;')
    expect(frag).toContain('uniform float uTerrainAmbient;')
    const albedoIdx = frag.indexOf('dayColor *= albedoMul;')
    const lambertIdx = frag.indexOf('dayColor *= mix(1.0, mix(uTerrainAmbient, 1.0, max(NdotLraw, 0.0)), uTerrainLambert);')
    const dayIdx = frag.indexOf('vec3 day = cloudColor + dayColor * (1.0 - cloudAlpha);')
    expect(albedoIdx).toBeGreaterThan(-1)
    expect(lambertIdx).toBeGreaterThan(albedoIdx)
    expect(dayIdx).toBeGreaterThan(lambertIdx)
  })

  it('облака ламбертом суши не затеняются: множителя на составленном day нет', () => {
    // Облака живут по своему закону (pow(0.5·lightIntensity + 0.1, 0.5)):
    // затенять их нормалью РЕЛЬЕФА — двойной учёт и наклон не по их высоте.
    expect(frag).not.toContain('day *= mix(1.0, mix(uTerrainAmbient')
  })

  it('множитель под гейтом USE_TERRAIN_UV — легаси-путь гигантов не тронут', () => {
    const lambertIdx = frag.indexOf('dayColor *= mix(1.0, mix(uTerrainAmbient')
    const guardIdx = frag.lastIndexOf('#ifdef USE_TERRAIN_UV', lambertIdx)
    const endifIdx = frag.indexOf('#endif', lambertIdx)
    expect(guardIdx).toBeGreaterThan(-1)
    expect(endifIdx).toBeGreaterThan(lambertIdx)
    // между гардом и множителем нет другого #endif — множитель внутри этого блока
    expect(frag.slice(guardIdx, lambertIdx)).not.toContain('#endif')
  })
})

describe('CPU-зеркало множителя суши', () => {
  it('lambert = 0 — множитель ровно 1 при любом NdotL (бит-в-бит прежний шейдер)', () => {
    for (const n of [-1, -0.3, 0, 0.25, 0.7, 1]) expect(terrainShade(n, 0, 0.04)).toBe(1)
  })

  it('lambert = 1 — монотонно растёт по NdotL на освещённом диске и упирается в ambient в тени', () => {
    expect(terrainShade(0.9, 1, 0.04)).toBeGreaterThan(terrainShade(0.7, 1, 0.04))
    expect(terrainShade(0.7, 1, 0.04)).toBeGreaterThan(terrainShade(0.3, 1, 0.04))
    expect(terrainShade(-0.5, 1, 0.04)).toBeCloseTo(0.04, 12) // 1 + (0.04 - 1)*1: округление float, не 0.04 бит-в-бит
    expect(terrainShade(1, 1, 0.04)).toBe(1)
  })

  it('контраст нормали виден на лите: прежний dayFactor на NdotL 0.7 и 0.9 одинаков, ламберт — нет', () => {
    const smoothstep = (a: number, b: number, x: number): number => {
      const t = Math.min(Math.max((x - a) / (b - a), 0), 1)
      return t * t * (3 - 2 * t)
    }
    expect(smoothstep(-0.08, 0.25, 0.7)).toBe(smoothstep(-0.08, 0.25, 0.9)) // старое поведение: нормаль невидима
    expect(terrainShade(0.7, 1, 0.04)).not.toBe(terrainShade(0.9, 1, 0.04))
  })
})

describe('PlanetShader: ручки terrainLambert/terrainAmbient', () => {
  function stubActor(data: Record<string, unknown>): Actor {
    return {
      renderingObject: { getAttribute: () => ({ emission: 1, bumpScale: 1, ...data }) },
      children: { where: () => ({ first: () => undefined, isNotEmpty: () => false }) },
      resources: { where: () => ({ first: () => undefined }) }
    } as unknown as Actor
  }

  beforeEach(() => seedPlaceholderKeys())
  afterEach(() => resourceStorage.deleteAllTextures())

  it('дефолты: lambert 0 (выключено), ambient 0.04', () => {
    const shader = new PlanetShader(stubActor({}))
    expect(shader.uniforms.uTerrainLambert.value).toBe(0)
    expect(shader.uniforms.uTerrainAmbient.value).toBe(0.04)
  })

  it('ручки из данных тела доезжают в юниформы', () => {
    const shader = new PlanetShader(stubActor({ terrainLambert: 1, terrainAmbient: 0.06 }))
    expect(shader.uniforms.uTerrainLambert.value).toBe(1)
    expect(shader.uniforms.uTerrainAmbient.value).toBe(0.06)
  })
})
