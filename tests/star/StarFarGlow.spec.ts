import { describe, it, expect } from 'vitest'
import { PerspectiveCamera, ShaderMaterial, Sprite, Uniform, WebGLRenderer } from 'three'
import { starFarGlowGain } from '@/core/renderables/utils/starFarGlow'
import { StarLod } from '@/core/renderables/utils/StarLod'
import { Star } from '@/core/renderables/Star'
import { FakeStar } from '@/core/renderables/utils/FakeStar'
import { StarShaderTemplate } from '@/core/materials/shaders/lib/StarShaderTemplate'
import { FakeStarShaderTemplate } from '@/core/materials/shaders/lib/FakeStarShaderTemplate'
import { RenderableFactory } from '@/core/renderables/RenderableFactory'
import { AtmosphereRegistry } from '@/core/services/AtmosphereRegistry'
import { DepthVolumeRegistry } from '@/core/services/DepthVolumeRegistry'
import { ResourceObserver } from '@/core/services/ResourceObserver'
import { STAR_IMPOSTOR_PIXELS } from '@/core/helpers/apparentSize'
import { config } from '@/core/framework/config'
import { Actor } from '@/core/models/Actor'
import { UpdateContext } from '@/core/UpdateContext'

const RADIUS_KM = 696000
const FOV = 50

/** Стаб актора звезды: всё, что читают узел, LOD, диск, билборд и слои */
function starActor(): Actor {
  const row = (r: Record<string, number>) => ({ getAttribute: (k: string, f: unknown = 0): unknown => r[k] ?? f })
  return {
    placement: null,
    orbit: null,
    parent: null,
    rotation: null,
    physicalObject: row({ radius: RADIUS_KM, temperature: 5778 }),
    renderingObject: null,
    resources: { first: () => null },
    getAttribute: (k: string, f: unknown = ''): unknown => (k === 'categoryId' ? 3 : k === 'name' ? 'Sun' : f)
  } as unknown as Actor
}

// LOD, диск и билборд читают у рендерера только domElement.height
const fakeRenderer = { domElement: { height: 1080 } } as unknown as WebGLRenderer

function contextAt(distance: number): UpdateContext {
  const camera = new PerspectiveCamera(FOV)
  camera.position.set(distance, 0, 0)
  return { camera, delta: 0, epoch: 0, elapsed: 0 }
}

function glowOf(object: unknown): Uniform<number> {
  return (object as { material: ShaderMaterial }).material.uniforms.uGlowGain as Uniform<number>
}

describe('starFarGlowGain: усиление свечения по видимому размеру', () => {
  it('во всём дальнем режиме — полное усиление', () => {
    expect(starFarGlowGain(STAR_IMPOSTOR_PIXELS, 3, 48)).toBe(3)
    expect(starFarGlowGain(1, 3, 48)).toBe(3)
  })

  it('диск крупнее порога затухания не трогается', () => {
    expect(starFarGlowGain(48, 3, 48)).toBe(1)
    expect(starFarGlowGain(500, 3, 48)).toBe(1)
    expect(starFarGlowGain(Infinity, 3, 48)).toBe(1)
  })

  it('между порогами — монотонный спад без скачков', () => {
    let prev = starFarGlowGain(STAR_IMPOSTOR_PIXELS, 3, 48)
    for (let px = STAR_IMPOSTOR_PIXELS; px <= 48; px += 0.5) {
      const g = starFarGlowGain(px, 3, 48)
      expect(g).toBeLessThanOrEqual(prev)
      expect(prev - g).toBeLessThan(0.1)
      prev = g
    }
  })

  it('усиление 1 — тождество', () => {
    for (const px of [1, 12, 30, 48, 100]) expect(starFarGlowGain(px, 1, 48)).toBe(1)
  })
})

describe('StarLod: усиление свечения пишется в общий юниформ', () => {
  it('издалека — полное усиление из конфига', () => {
    const lod = new StarLod(RADIUS_KM, fakeRenderer)

    lod.updateObject(contextAt(lod.switchDistance(FOV) * 10))

    expect(lod.glowGain.value).toBe(config('star.farGlowGain'))
  })

  it('вблизи — единица: диск крупнее порога затухания', () => {
    const lod = new StarLod(RADIUS_KM, fakeRenderer)

    lod.updateObject(contextAt(lod.switchDistance(FOV) / 10))

    expect(lod.glowGain.value).toBe(1)
  })

  it('на дистанции переключения — значение для 12 px', () => {
    const lod = new StarLod(RADIUS_KM, fakeRenderer, { gain: 2.5, fadePixels: 40 })

    lod.updateObject(contextAt(lod.switchDistance(FOV)))

    expect(lod.glowGain.value).toBeCloseTo(starFarGlowGain(STAR_IMPOSTOR_PIXELS, 2.5, 40), 6)
  })

  it('размер меряется по мировой позиции LOD, а не по локальной', () => {
    // LOD висит в нуле DynamicNode: по локальной позиции дистанция мерилась бы
    // до начала сцены
    const lod = new StarLod(RADIUS_KM, fakeRenderer)
    const far = lod.switchDistance(FOV) * 10

    lod.position.set(far, 0, 0)
    lod.updateObject(contextAt(far + lod.switchDistance(FOV) / 10))

    expect(lod.glowGain.value).toBe(1)
  })
})

describe('диск и билборд держат ОДИН юниформ усиления', () => {
  it('Star и FakeStar принимают юниформ LOD объектом, а не значением', () => {
    // Снапшот числа разъехался бы между уровнями — на переключении вернулся бы шов
    const lod = new StarLod(RADIUS_KM, fakeRenderer)

    expect(lod.glowGain).toBeInstanceOf(Uniform)
    expect(glowOf(new Star(starActor(), lod.glowGain))).toBe(lod.glowGain)
    expect(glowOf(new FakeStar(starActor(), fakeRenderer, lod.glowGain))).toBe(lod.glowGain)
  })

  it('без юниформа LOD — свой, нейтральный', () => {
    expect(glowOf(new Star(starActor())).value).toBe(1)
    expect(glowOf(new FakeStar(starActor(), fakeRenderer)).value).toBe(1)
  })

  it('шаблоны умножают энергию на усиление ДО потолка HDR', () => {
    for (const template of [StarShaderTemplate, FakeStarShaderTemplate]) {
      expect(template.fragmentShader).toContain('uniform float uGlowGain;')
      expect(template.fragmentShader).toContain('min(granule * energy * limb * uGlowGain, vec3(64.0))')
      expect((template.uniforms.uGlowGain as Uniform<number>).value).toBe(1)
    }
  })
})

describe('RenderableFactory: звезда', () => {
  const makeFactory = (): RenderableFactory =>
    new RenderableFactory(fakeRenderer, {} as unknown as ResourceObserver, new AtmosphereRegistry(), new DepthVolumeRegistry())

  const lodOf = (node: { children: unknown[] }): StarLod => node.children.find((c) => c instanceof StarLod) as StarLod

  it('оба уровня LOD держат юниформ усиления самого LOD', () => {
    const lod = lodOf(makeFactory().make(starActor()))

    expect(lod.glowGain).toBeInstanceOf(Uniform)
    expect(glowOf(lod.levels[0].object)).toBe(lod.glowGain)
    expect(glowOf(lod.levels[1].object)).toBe(lod.glowGain)
  })

  it('спрайта-ореола нет: свечение звезды даёт блум', () => {
    const lod = lodOf(makeFactory().make(starActor()))
    let sprites = 0

    lod.traverse((child) => {
      if (child instanceof Sprite) sprites++
    })

    expect(sprites).toBe(0)
  })
})

describe('star config: свечение издалека', () => {
  it('стартовые значения', () => {
    expect(config('star.farGlowGain')).toBe(3)
    expect(config('star.farGlowFadePixels')).toBe(48)
  })

  it('порог затухания крупнее импостора: иначе спада нет, только ступенька', () => {
    expect(config('star.farGlowFadePixels')).toBeGreaterThan(STAR_IMPOSTOR_PIXELS)
  })
})
