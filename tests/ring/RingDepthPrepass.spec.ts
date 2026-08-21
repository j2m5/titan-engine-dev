import { describe, expect, it, beforeEach, afterEach } from 'vitest'
import { DoubleSide, Mesh, Texture } from 'three'
import { Ring } from '@/core/renderables/Ring'
import { RingDepthMaterial, RING_DEPTH_ALPHA_TEST_DEFAULT } from '@/core/materials/RingDepthMaterial'
import { RingShaderTemplate } from '@/core/materials/shaders/lib/RingShaderTemplate'
import { syncSubscriberMaterials } from '@/core/materials/materialSync'
import { Actor } from '@/core/models/Actor'
import { resourceStorage } from '@/core/services/ResourceStorage'
import { IRingRenderingObject } from '@/core/models/types'

// Кольцо Сатурна (actorId 39, renderingObject id 9)
const SATURN_RING_ID = 39

/** Формула радиальной uv — одна на цветовой проход и на пре-пасс */
const UV_FORMULA = 'uv.x = (length(vPosition) - innerRadius) / (outerRadius - innerRadius);'

function ringActor(): Actor {
  return Actor.find(SATURN_RING_ID)!
}

function ringData(): IRingRenderingObject {
  return ringActor().renderingObject!.getAttribute('data') as unknown as IRingRenderingObject
}

/** Текстура кольца резидентна: сеем её в реестр, чтобы шейдер не ушёл на заглушку (canvas в jsdom) */
function seedRingTexture(): void {
  const texture = new Texture()
  texture.name = ringActor().resources.first()?.getAttribute('path') ?? ''
  texture.image = { width: 4, height: 2 }
  resourceStorage.addTexture(texture)
}

function prepassOf(ring: Ring): Mesh {
  return ring.children.find((child: { name: string }): boolean => child.name.endsWith('DepthPrepass')) as Mesh
}

describe('Депт-пре-пасс кольца', () => {
  beforeEach(() => seedRingTexture())
  afterEach(() => {
    resourceStorage.deleteAllTextures()
    delete ringData().depthAlphaTest
  })

  it('у кольца ровно один ребёнок-пре-пасс, и геометрия у них общая по ссылке', () => {
    const ring = new Ring(ringActor())
    const children = ring.children.filter((child: { name: string }): boolean => child.name.endsWith('DepthPrepass'))

    expect(children).toHaveLength(1)
    expect(children[0].name).toBe(ring.name + 'DepthPrepass')
    expect((children[0] as Mesh).geometry).toBe(ring.geometry)
  })

  it('пре-пасс пишет глубину, не пишет цвет и живёт в непрозрачной очереди', () => {
    const material = prepassOf(new Ring(ringActor())).material as RingDepthMaterial

    expect(material.colorWrite).toBe(false)
    expect(material.depthWrite).toBe(true)
    expect(material.depthTest).toBe(true)
    expect(material.transparent).toBe(false)
    expect(material.side).toBe(DoubleSide)
  })

  it('цветовой проход кольца остаётся на LessEqualDepth — иначе он не нарисуется поверх своей же глубины', () => {
    const ring = new Ring(ringActor())

    expect(ring.material.depthFunc).toBe(3) // LessEqualDepth
    expect(ring.material.depthWrite).toBe(false)
  })

  it('пре-пасс берёт ту же радиальную uv, что и цветовой проход, и режет по uDepthAlphaTest', () => {
    const material = prepassOf(new Ring(ringActor())).material as RingDepthMaterial

    expect(RingShaderTemplate.fragmentShader).toContain(UV_FORMULA)
    expect(material.fragmentShader).toContain(UV_FORMULA)
    expect(material.fragmentShader).toContain('if (color.a <= uDepthAlphaTest) discard;')
  })

  it('логарифмическая глубина подключена в обоих шейдерах пре-пасса', () => {
    // Без чанков logdepthbuf записанная глубина не совпадёт с глубиной сцены
    const material = prepassOf(new Ring(ringActor())).material as RingDepthMaterial

    expect(material.fragmentShader).toContain('gl_FragDepth')
    expect(material.fragmentShader).toContain('vFragDepth')
    expect(material.vertexShader).toContain('vFragDepth')
  })

  it('порог берётся из данных, при отсутствии — дефолт 0.5', () => {
    expect(RING_DEPTH_ALPHA_TEST_DEFAULT).toBe(0.5)

    const byDefault = prepassOf(new Ring(ringActor())).material as RingDepthMaterial
    expect(byDefault.uniforms.uDepthAlphaTest.value).toBe(RING_DEPTH_ALPHA_TEST_DEFAULT)

    ringData().depthAlphaTest = 0.3

    const fromData = prepassOf(new Ring(ringActor())).material as RingDepthMaterial
    expect(fromData.uniforms.uDepthAlphaTest.value).toBe(0.3)
  })

  it('текстура и радиусы разделяются с цветовым материалом кольца по ссылке', () => {
    const ring = new Ring(ringActor())
    const material = prepassOf(ring).material as RingDepthMaterial

    expect(material.uniforms.diffuseMap.value).toBe(ring.material.uniforms.diffuseMap.value)
    expect(material.uniforms.innerRadius.value).toBe(ring.material.uniforms.innerRadius.value)
    expect(material.uniforms.outerRadius.value).toBe(ring.material.uniforms.outerRadius.value)
  })

  it('после обновления карты у материала кольца пре-пасс смотрит на ту же текстуру', () => {
    const ring = new Ring(ringActor())
    const material = prepassOf(ring).material as RingDepthMaterial
    const streamed = new Texture()

    ring.material.uniforms.diffuseMap.value = streamed
    syncSubscriberMaterials(ring, ring.material)

    expect(material.uniforms.diffuseMap.value).toBe(streamed)
  })

  it('пре-пасс не перехватывает выбор актора', () => {
    expect(prepassOf(new Ring(ringActor())).userData.clickable).toBe(false)
  })
})
