import { AdditiveBlending, Color, ShaderChunk, Texture } from 'three'
import type { WebGLRenderer } from 'three'
import { FakeStar } from '@/core/renderables/utils/FakeStar'
import { buildStarPalette, DEFAULT_STAR_TEMPERATURE_K } from '@/core/materials/shaders/lib/helpers'
import { config } from '@/core/framework/config'
import { resourceStorage } from '@/core/services/ResourceStorage'
import { Actor } from '@/core/models/Actor'

const TEMPERATURE_K = 9500

// getAttribute — единственное, что FakeStar читает у Actor; тот же приём,
// что в tests/renderables/ApparentSize.spec.ts
function stubActor(temperature?: number): Actor {
  return {
    getAttribute: (key: string, def?: unknown): unknown => def,
    physicalObject: {
      getAttribute: (key: string, def?: unknown): unknown =>
        key === 'temperature' && temperature !== undefined ? temperature : def
    }
  } as unknown as Actor
}

// FakeStar читает у рендерера только domElement.height
function stubRenderer(): WebGLRenderer {
  return { domElement: { height: 1080 } } as unknown as WebGLRenderer
}

describe('FakeStar: контракт материала', () => {
  let map: Texture

  beforeEach(() => {
    map = new Texture()
    map.name = 'round.png'
    resourceStorage.addTexture(map)
  })

  afterEach(() => {
    resourceStorage.deleteTexture('round.png')
  })

  it('билборд не пишет глубину и уходит в transparent-проход', () => {
    // Прежний MeshStandardMaterial писал глубину всем квадом, включая
    // прозрачные углы: объекты позади билборда получали квадратную дырку
    const star = new FakeStar(stubActor(TEMPERATURE_K), stubRenderer())

    expect(star.material.transparent).toBe(true)
    expect(star.material.depthWrite).toBe(false)
    expect(star.material.depthTest).toBe(true)
    expect(star.material.blending).toBe(AdditiveBlending)
  })

  it('шейдер несёт logdepthbuf-чанки: рендерер живёт с логарифмической глубиной', () => {
    // three.renderer.logarithmicDepthBuffer = true (src/config/three.ts):
    // без чанков depthTest билборда разъезжается с глубиной сцены.
    // Standard-материал нёс чанки сам — их потеря при замене была бы регрессом
    const star = new FakeStar(stubActor(TEMPERATURE_K), stubRenderer())

    expect(star.material.vertexShader).toContain(ShaderChunk['logdepthbuf_pars_vertex'])
    expect(star.material.vertexShader).toContain(ShaderChunk['logdepthbuf_vertex'])
    expect(star.material.fragmentShader).toContain(ShaderChunk['logdepthbuf_pars_fragment'])
    expect(star.material.fragmentShader).toContain(ShaderChunk['logdepthbuf_fragment'])
  })

  it('цвет — палитра диска × impostorIntensity, поправки +1300 больше нет', () => {
    const star = new FakeStar(stubActor(TEMPERATURE_K), stubRenderer())

    const base = buildStarPalette(TEMPERATURE_K).base
    const expected = new Color().setRGB(base.r, base.g, base.b).multiplyScalar(config('star.impostorIntensity'))

    expect(star.material.uniforms.uColor.value).toEqual(expected)
  })

  it('без атрибута температуры палитра строится от общего с диском дефолта', () => {
    const star = new FakeStar(stubActor(), stubRenderer())

    const base = buildStarPalette(DEFAULT_STAR_TEMPERATURE_K).base
    const expected = new Color().setRGB(base.r, base.g, base.b).multiplyScalar(config('star.impostorIntensity'))

    expect(star.material.uniforms.uColor.value).toEqual(expected)
  })

  it('форму даёт альфа-канал текстуры, тинта по RGB текстуры нет', () => {
    // Ровно так вёл себя и MeshStandardMaterial без источников света: диффуз
    // чёрный, map в emissive не входит — работала одна альфа через блендинг
    const star = new FakeStar(stubActor(TEMPERATURE_K), stubRenderer())

    expect(star.material.fragmentShader).toContain('texture2D(map, vUv).a')
    expect(star.material.fragmentShader).not.toContain('texture2D(map, vUv).rgb')
    expect(star.material.uniforms.map.value).toBe(map)
  })
})

describe('FakeStar: отсутствие текстуры формы', () => {
  // Текстура не регистрируется намеренно: ресурс может не доехать, и прежний
  // getTexture(...)! молча отдавал undefined в map
  it('предупреждает с именем ресурса и последствием, но не падает', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})

    const star = new FakeStar(stubActor(TEMPERATURE_K), stubRenderer())

    expect(warnSpy).toHaveBeenCalledWith(expect.stringMatching(/^\[FakeStar\]/))
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('round.png'))
    expect(star.material.uniforms.map.value).toBeNull()

    warnSpy.mockRestore()
  })
})
