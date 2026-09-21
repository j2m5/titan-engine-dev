import { afterEach, beforeEach, describe, it, expect } from 'vitest'
import { Color, Texture } from 'three'
import type { Actor } from '@/core/models/Actor'
import { lightColorOf, lightTintOf, resolveLightTint } from '@/core/helpers/lightSource'
import { buildStarPalette } from '@/core/materials/shaders/lib/helpers'
import { PlanetShaderTemplate } from '@/core/materials/shaders/lib/PlanetShaderTemplate'
import { WaterShaderTemplate } from '@/core/materials/shaders/lib/WaterShaderTemplate'
import { RingShaderTemplate } from '@/core/materials/shaders/lib/RingShaderTemplate'
import { InstancedAsteroidShaderTemplate } from '@/core/materials/shaders/lib/InstancedAsteroidShaderTemplate'
import { PlanetMaterial } from '@/core/materials/PlanetMaterial'
import { WaterMaterial } from '@/core/renderables/Water/WaterMaterial'
import { RingMaterial } from '@/core/materials/RingMaterial'
import { InstancedAsteroidMaterial } from '@/core/materials/InstancedAsteroidMaterial'
import { BillboardAsteroidMaterial } from '@/core/renderables/DetailedRingStreamingSystem/BillboardAsteroidMaterial'
import { RingDustRaymarchMaterial } from '@/core/renderables/DetailedRingStreamingSystem/dust/RingDustRaymarchMaterial'
import {
  ringDustUniforms,
  ringDustFunctions,
  ringDustRaymarchFunctions
} from '@/core/materials/shaders/lib/chunks/RingDust'
import { resourceStorage } from '@/core/services/ResourceStorage'
import { withoutComments } from '../helpers/glsl'

function star(temperature: number, data: object | null): Actor {
  return {
    parent: null,
    getAttribute: (key: string): unknown => (key === 'categoryId' ? 10 : undefined),
    renderingObject: data === null ? null : { getAttribute: () => data },
    physicalObject: {
      getAttribute: (key: string, def?: unknown): unknown => (key === 'temperature' ? temperature : def)
    }
  } as unknown as Actor
}

/** Снимает из GLSL всё, что стоит под #ifdef USE_LIGHT_TINT … #endif (без вложенности) */
function withoutLightTint(source: string): string {
  return source.replace(/#ifdef USE_LIGHT_TINT[\s\S]*?#endif/g, '')
}

describe('lightTintOf — подписка светила', () => {
  it('без поля подписки нет', () => {
    expect(lightTintOf(star(5772, {}))).toBe(0)
    expect(lightTintOf(star(5772, null))).toBe(0)
  })

  it('значение клампится в [0, 1]', () => {
    expect(lightTintOf(star(3700, { lightTint: 0.8 }))).toBe(0.8)
    expect(lightTintOf(star(3700, { lightTint: 5 }))).toBe(1)
    expect(lightTintOf(star(3700, { lightTint: -1 }))).toBe(0)
  })
})

describe('lightColorOf', () => {
  it('нулевая подписка — РОВНО белый', () => {
    const c = lightColorOf(star(3700, { lightTint: 0 }))

    expect([c.r, c.g, c.b]).toEqual([1, 1, 1])
  })

  it('полная подписка — базовый цвет палитры звезды', () => {
    const c = lightColorOf(star(3700, { lightTint: 1 }))
    const base = buildStarPalette(3700).base

    expect(c.r).toBeCloseTo(base.r, 12)
    expect(c.g).toBeCloseTo(base.g, 12)
    expect(c.b).toBeCloseTo(base.b, 12)
  })

  it('каналы не превышают единицу: кламп цвета планеты остаётся в силе', () => {
    const c = lightColorOf(star(3700, { lightTint: 1 }))

    expect(Math.max(c.r, c.g, c.b)).toBeLessThanOrEqual(1)
    expect(c.r).toBeGreaterThan(c.b)
  })

  it('промежуточная подписка — линейная смесь с белым', () => {
    const full = lightColorOf(star(3700, { lightTint: 1 }))
    const half = lightColorOf(star(3700, { lightTint: 0.5 }))

    expect(half.g).toBeCloseTo((1 + full.g) / 2, 12)
  })
})

describe('resolveLightTint', () => {
  it('нет светила — гейт закрыт, цвет белый', () => {
    const tint = resolveLightTint({} as unknown as Actor)

    expect(tint.active).toBe(false)
    expect(tint.color.equals(new Color(1, 1, 1))).toBe(true)
  })

  it('светило без подписки — гейт закрыт', () => {
    expect(resolveLightTint(star(5772, {})).active).toBe(false)
  })

  it('светило с подпиской — гейт открыт', () => {
    const tint = resolveLightTint(star(3700, { lightTint: 0.8 }))

    expect(tint.active).toBe(true)
    expect(tint.color.b).toBeLessThan(1)
  })
})

describe('гейт в шейдерах', () => {
  const templates = {
    planet: PlanetShaderTemplate,
    water: WaterShaderTemplate,
    ring: RingShaderTemplate,
    asteroid: InstancedAsteroidShaderTemplate
  }

  it.each(Object.entries(templates))('%s: юниформ объявлен и по умолчанию белый', (_name, template) => {
    expect(template.uniforms.uLightColor.value.equals(new Color(1, 1, 1))).toBe(true)
  })

  it.each(Object.entries(templates))('%s: uLightColor встречается ТОЛЬКО под дефайном', (_name, template) => {
    // Без дефайна препроцессированный текст обязан совпадать с прежним
    const fragment: string = withoutComments(template.fragmentShader)

    expect(fragment).toContain('#ifdef USE_LIGHT_TINT')
    expect(withoutLightTint(fragment)).not.toContain('uLightColor')
  })

  it('планета: тинт на прямом члене, амбиент без него', () => {
    const fragment: string = withoutComments(PlanetShaderTemplate.fragmentShader)

    expect(fragment).toContain('vec3 lit = mix(ambient, vec3(directGain) * uLightColor, max(NdotLraw, 0.0));')
    expect(fragment).not.toMatch(/ambient\s*\*\s*uLightColor|uLightColor\s*\*\s*ambient/)
  })

  it('планета: тень колец остаётся бесцветным множителем', () => {
    expect(withoutComments(PlanetShaderTemplate.fragmentShader)).toContain(
      'getShadowFromRings(vec3(1.0), normalize(vLocalLightDirection))'
    )
  })

  it('камни: planetshine не тонируется цветом звезды', () => {
    const fragment: string = withoutComments(InstancedAsteroidShaderTemplate.fragmentShader)

    expect(fragment).not.toMatch(/uPlanetshineColor[^;]*uLightColor|uLightColor[^;]*uPlanetshineColor/)
  })
})

describe('гейт в чанке RingDust (пылевая дымка колец — фикс-раунд 1)', () => {
  const uniformsChunk: string = withoutComments(ringDustUniforms)
  const functionsChunk: string = withoutComments(ringDustFunctions)
  const raymarchFunctionsChunk: string = withoutComments(ringDustRaymarchFunctions)

  it('чанк НЕ объявляет uLightColor сам — потребитель обязан объявить его до include', () => {
    expect(uniformsChunk).not.toContain('uniform vec3 uLightColor')
    expect(functionsChunk).not.toContain('uniform vec3 uLightColor')
    expect(raymarchFunctionsChunk).not.toContain('uniform vec3 uLightColor')
  })

  it('uLightColor встречается ТОЛЬКО под дефайном (и в закрытой форме, и в объёмном подмножестве)', () => {
    expect(functionsChunk).toContain('#ifdef USE_LIGHT_TINT')
    expect(withoutLightTint(functionsChunk)).not.toContain('uLightColor')
    expect(raymarchFunctionsChunk).toContain('#ifdef USE_LIGHT_TINT')
    expect(withoutLightTint(raymarchFunctionsChunk)).not.toContain('uLightColor')
  })

  it('ringDustHaze — единственный прямой член света на пыль — красится целиком под дефайном', () => {
    expect(functionsChunk).toContain('return uDustColor * (0.75 + 0.45 * sun) * uLightColor;')
    expect(functionsChunk).toContain('return uDustColor * (0.75 + 0.45 * sun);')
  })
})

describe('гейт в шейдере билборда камней (BillboardAsteroidMaterial, L1)', () => {
  const fragment: string = withoutComments(new BillboardAsteroidMaterial().fragmentShader)

  it('uLightColor объявлен под дефайном, ambient им не домножается', () => {
    expect(fragment).toContain('#ifdef USE_LIGHT_TINT')
    expect(withoutLightTint(fragment)).not.toContain('uLightColor')
    expect(fragment).not.toMatch(/uAmbient\s*\*\s*uLightColor|uLightColor\s*\*\s*uAmbient/)
  })

  it('planetshine не тонируется цветом звезды (та же ловушка, что у L0)', () => {
    expect(fragment).not.toMatch(/uPlanetshineColor[^;]*uLightColor|uLightColor[^;]*uPlanetshineColor/)
  })
})

// --- Проводка материалов (Step 10) ---
// Деревья акторов — минимальные стабы (тот же приём, что tree() в
// LightSource.spec.ts): planet/water/ring под звездой-корнем с lightTint,
// либо без родителя вовсе (гейт закрыт).

function tintedStar(lightTint: number): Actor {
  return star(3700, { lightTint })
}

function planetActor(parent: Actor | null): Actor {
  return {
    parent,
    getAttribute: (): unknown => undefined,
    renderingObject: { getAttribute: () => ({ bumpScale: 0, emission: 1 }) },
    children: { where: () => ({ first: () => undefined, isNotEmpty: () => false }) },
    resources: { where: () => ({ first: () => undefined }) },
    physicalObject: { getAttribute: () => 1000 }
  } as unknown as Actor
}

function waterActor(parent: Actor | null): Actor {
  return {
    parent,
    getAttribute: (): unknown => undefined,
    renderingObject: { getAttribute: () => ({}) },
    children: { where: () => ({ first: () => undefined, isNotEmpty: () => false }) },
    resources: { where: () => ({ first: () => undefined }) }
  } as unknown as Actor
}

function ringActor(parent: Actor | null): Actor {
  return {
    parent,
    getAttribute: (): unknown => undefined,
    renderingObject: { getAttribute: () => ({ innerRadius: 1000, outerRadius: 2000, alphaTest: 0.1 }) },
    resources: { first: () => undefined }
  } as unknown as Actor
}

/** `getTextureOrMake` промахом строит PlaceholderTexture (canvas 2d, недоступен в jsdom) — сеем ключи-заглушки. */
function seedPlaceholderKeys(): void {
  for (const name of ['', 'default.png', 'night.jpg']) {
    const texture = new Texture()
    texture.name = name
    texture.image = { width: 4, height: 2 }
    resourceStorage.addTexture(texture)
  }
}

describe('проводка материалов: гейт USE_LIGHT_TINT и юниформ uLightColor', () => {
  beforeEach(seedPlaceholderKeys)
  afterEach(() => resourceStorage.deleteAllTextures())

  it('PlanetMaterial: без светила-подписчика — без дефайна, uLightColor белый', () => {
    const material = new PlanetMaterial(planetActor(null))
    material.updateMaterial() // дефайн собирается в updateMaterial (рядом с USE_SUN_TINT), не в конструкторе

    expect(material.defines.USE_LIGHT_TINT).toBeUndefined()
    expect((material.uniforms.uLightColor.value as Color).equals(new Color(1, 1, 1))).toBe(true)
  })

  it('PlanetMaterial: под звездой с lightTint 0.8 — дефайн есть, uLightColor подкрашен', () => {
    const material = new PlanetMaterial(planetActor(tintedStar(0.8)))
    material.updateMaterial()

    expect(material.defines.USE_LIGHT_TINT).toBe('1')
    expect((material.uniforms.uLightColor.value as Color).b).toBeLessThan(1)
  })

  it('PlanetMaterial: дефайн переживает повторную updateMaterial() И resetMaterial()', () => {
    const material = new PlanetMaterial(planetActor(tintedStar(0.8)))

    material.updateMaterial()
    expect(material.defines.USE_LIGHT_TINT).toBe('1')
    material.updateMaterial()
    expect(material.defines.USE_LIGHT_TINT).toBe('1')
    material.resetMaterial()
    expect(material.defines.USE_LIGHT_TINT).toBe('1')
  })

  it('WaterMaterial: без светила-подписчика — без дефайна, uLightColor белый', () => {
    const material = new WaterMaterial(waterActor(null))

    expect(material.defines.USE_LIGHT_TINT).toBeUndefined()
    expect((material.uniforms.uLightColor.value as Color).equals(new Color(1, 1, 1))).toBe(true)
  })

  it('WaterMaterial: под звездой с lightTint 0.8 — дефайн есть, uLightColor подкрашен', () => {
    const material = new WaterMaterial(waterActor(tintedStar(0.8)))

    expect(material.defines.USE_LIGHT_TINT).toBe('1')
    expect((material.uniforms.uLightColor.value as Color).b).toBeLessThan(1)
  })

  it('RingMaterial: без светила-подписчика — без дефайна, uLightColor белый', () => {
    const material = new RingMaterial(ringActor(planetActor(null)))

    expect(material.defines.USE_LIGHT_TINT).toBeUndefined()
    expect((material.uniforms.uLightColor.value as Color).equals(new Color(1, 1, 1))).toBe(true)
  })

  it('RingMaterial: актор кольца под звездой с lightTint 0.8 (резолвер поднимается к корню) — дефайн есть', () => {
    const material = new RingMaterial(ringActor(planetActor(tintedStar(0.8))))

    expect(material.defines.USE_LIGHT_TINT).toBe('1')
    expect((material.uniforms.uLightColor.value as Color).b).toBeLessThan(1)
  })

  it('InstancedAsteroidMaterial: без модели вовсе — без дефайна, uLightColor белый (легаси-конструкторы)', () => {
    const material = new InstancedAsteroidMaterial()

    expect(material.defines.USE_LIGHT_TINT).toBeUndefined()
    expect((material.uniforms.uLightColor.value as Color).equals(new Color(1, 1, 1))).toBe(true)
  })

  it('InstancedAsteroidMaterial: актор кольца без светила-подписчика — без дефайна', () => {
    const material = new InstancedAsteroidMaterial(ringActor(planetActor(null)))

    expect(material.defines.USE_LIGHT_TINT).toBeUndefined()
  })

  it('InstancedAsteroidMaterial: актор кольца под звездой с lightTint 0.8 (резолвер поднимается к корню) — дефайн есть', () => {
    const material = new InstancedAsteroidMaterial(ringActor(planetActor(tintedStar(0.8))))

    expect(material.defines.USE_LIGHT_TINT).toBe('1')
    expect((material.uniforms.uLightColor.value as Color).b).toBeLessThan(1)
  })

  it('BillboardAsteroidMaterial: без модели вовсе — без дефайна, uLightColor белый', () => {
    const material = new BillboardAsteroidMaterial()

    expect(material.defines.USE_LIGHT_TINT).toBeUndefined()
    expect((material.uniforms.uLightColor.value as Color).equals(new Color(1, 1, 1))).toBe(true)
  })

  it('BillboardAsteroidMaterial: актор кольца без светила-подписчика — без дефайна', () => {
    const material = new BillboardAsteroidMaterial(ringActor(planetActor(null)))

    expect(material.defines.USE_LIGHT_TINT).toBeUndefined()
  })

  it('BillboardAsteroidMaterial: актор кольца под звездой с lightTint 0.8 — дефайн есть, uLightColor подкрашен', () => {
    const material = new BillboardAsteroidMaterial(ringActor(planetActor(tintedStar(0.8))))

    expect(material.defines.USE_LIGHT_TINT).toBe('1')
    expect((material.uniforms.uLightColor.value as Color).b).toBeLessThan(1)
  })

  it('BillboardAsteroidMaterial: два инстанса не делят объект Uniform', () => {
    const tinted = new BillboardAsteroidMaterial(ringActor(planetActor(tintedStar(0.8))))
    const plain = new BillboardAsteroidMaterial(ringActor(planetActor(null)))

    expect(tinted.uniforms.uLightColor).not.toBe(plain.uniforms.uLightColor)
    expect((plain.uniforms.uLightColor.value as Color).equals(new Color(1, 1, 1))).toBe(true)
  })

  it('RingDustRaymarchMaterial: без модели вовсе — без дефайна, uLightColor белый', () => {
    const material = new RingDustRaymarchMaterial()

    expect(material.defines.USE_LIGHT_TINT).toBeUndefined()
    expect((material.uniforms.uLightColor.value as Color).equals(new Color(1, 1, 1))).toBe(true)
  })

  it('RingDustRaymarchMaterial: актор кольца без светила-подписчика — без дефайна', () => {
    const material = new RingDustRaymarchMaterial(ringActor(planetActor(null)))

    expect(material.defines.USE_LIGHT_TINT).toBeUndefined()
  })

  it('RingDustRaymarchMaterial: актор кольца под звездой с lightTint 0.8 — дефайн есть, uLightColor подкрашен', () => {
    const material = new RingDustRaymarchMaterial(ringActor(planetActor(tintedStar(0.8))))

    expect(material.defines.USE_LIGHT_TINT).toBe('1')
    expect((material.uniforms.uLightColor.value as Color).b).toBeLessThan(1)
  })

  it('RingDustRaymarchMaterial: два инстанса не делят объект Uniform', () => {
    const tinted = new RingDustRaymarchMaterial(ringActor(planetActor(tintedStar(0.8))))
    const plain = new RingDustRaymarchMaterial(ringActor(planetActor(null)))

    expect(tinted.uniforms.uLightColor).not.toBe(plain.uniforms.uLightColor)
    expect((plain.uniforms.uLightColor.value as Color).equals(new Color(1, 1, 1))).toBe(true)
  })

  it('консистентность: под одним и тем же кольцом L0, L1, плоское кольцо и объём пыли дают ОДИН цвет', () => {
    const model = ringActor(planetActor(tintedStar(0.8)))
    const expectedColor = resolveLightTint(model).color

    const l0 = new InstancedAsteroidMaterial(model)
    const l1 = new BillboardAsteroidMaterial(model)
    const ring = new RingMaterial(model)
    const dust = new RingDustRaymarchMaterial(model)

    for (const material of [l0, l1, ring, dust]) {
      expect(material.defines.USE_LIGHT_TINT).toBe('1')
      expect((material.uniforms.uLightColor.value as Color).equals(expectedColor)).toBe(true)
    }
  })
})
