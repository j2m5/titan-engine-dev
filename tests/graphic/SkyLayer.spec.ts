import { describe, it, expect, vi } from 'vitest'
import { CubeTexture, HalfFloatType, LinearFilter, PerspectiveCamera, Texture, WebGLRenderTarget } from 'three'
import { SkyLayer, type SkyLayerRenderer } from '@/core/graphic/passes/SkyLayer'
import { SKY_VERTEX_SHADER, buildSkyFragmentShader } from '@/core/renderables/skyShader'
import { gaiaSkyUniforms } from '@/core/sky/gaiaSkyUniforms'

function fakeRenderer(previous: WebGLRenderTarget | null) {
  const log: Array<[string, unknown]> = []
  let current: WebGLRenderTarget | null = previous
  const renderer = {
    getRenderTarget: () => current,
    setRenderTarget: vi.fn((target: WebGLRenderTarget | null) => {
      current = target
      log.push(['target', target])
    }),
    render: vi.fn((object: unknown) => log.push(['render', object]))
  }
  return { renderer: renderer as unknown as SkyLayerRenderer, log }
}

describe('skyShader: фон и слой — один источник', () => {
  const background = buildSkyFragmentShader(false)
  const layer = buildSkyFragmentShader(true)

  it('небо считается одинаково и безусловно; фон пишет его как есть', () => {
    for (const source of [background, layer]) {
      expect(source).toContain('vec3 sky = sampleSky(dir, dFdx(dir), dFdy(dir));')
    }
    expect(background).toContain('fragColor = vec4(sky, 1.0);')
    expect(background).not.toContain('uSceneDepth')
  })

  it('слой: видимость из глубины после неба, запись неба × видимость и альфы', () => {
    expect(layer).toContain('uniform highp sampler2D uSceneDepth;')
    expect(layer).toContain('texelFetch(uSceneDepth, ivec2(gl_FragCoord.xy), 0).r >= 1.0 - 1e-6')
    expect(layer).toContain('fragColor = vec4(sky * visible, visible);')
    expect(layer.indexOf('vec3 sky = sampleSky(')).toBeLessThan(layer.indexOf('texelFetch('))
  })
})

describe('SkyLayer', () => {
  const camera = new PerspectiveCamera(50, 1, 0.1, 10)

  it('цель — half-float, линейная фильтрация, без глубины; материал из общего шейдера', () => {
    const layer = new SkyLayer()

    expect(layer.target.texture.type).toBe(HalfFloatType)
    expect(layer.target.texture.minFilter).toBe(LinearFilter)
    expect(layer.target.texture.magFilter).toBe(LinearFilter)
    expect(layer.target.depthBuffer).toBe(false)
    expect(layer.material.vertexShader).toBe(SKY_VERTEX_SHADER)
    expect(layer.material.fragmentShader).toBe(buildSkyFragmentShader(true))
    expect(layer.material.uniforms.uGaiaMinLod).toBe(gaiaSkyUniforms.uGaiaMinLod)
  })

  it('setSize — размер цели', () => {
    const layer = new SkyLayer()
    layer.setSize(640, 360)
    expect([layer.target.width, layer.target.height]).toEqual([640, 360])
  })

  it('render: глубина и кубмапа привязаны, меш нарисован в свою цель камерой сцены, прежняя цель восстановлена', () => {
    const layer = new SkyLayer()
    const previous = new WebGLRenderTarget(4, 4)
    const depth = new Texture()
    const background = new CubeTexture()
    const { renderer, log } = fakeRenderer(previous)

    layer.render(renderer, camera, depth, background)

    expect(layer.material.uniforms.uSceneDepth.value).toBe(depth)
    expect(layer.material.uniforms.skybox.value).toBe(background)
    expect(log).toEqual([
      ['target', layer.target],
      ['render', layer.mesh],
      ['target', previous]
    ])
    expect((renderer.render as ReturnType<typeof vi.fn>).mock.calls[0][1]).toBe(camera)
  })

  it('texture — только после render в этом кадре; reset гасит', () => {
    const layer = new SkyLayer()
    expect(layer.texture).toBeNull()

    layer.render(fakeRenderer(null).renderer, camera, new Texture(), null)
    expect(layer.texture).toBe(layer.target.texture)

    layer.reset()
    expect(layer.texture).toBeNull()
  })

  it('меш виден камере с любой маской слоёв и не отсекается фрустумом', () => {
    const layer = new SkyLayer()
    expect(layer.mesh.layers.mask).toBe(0xffffffff | 0)
    expect(layer.mesh.frustumCulled).toBe(false)
  })

  it('dispose освобождает цель, материал и геометрию', () => {
    const layer = new SkyLayer()
    const target = vi.spyOn(layer.target, 'dispose')
    const material = vi.spyOn(layer.material, 'dispose')
    const geometry = vi.spyOn(layer.mesh.geometry, 'dispose')

    layer.dispose()

    expect(target).toHaveBeenCalledOnce()
    expect(material).toHaveBeenCalledOnce()
    expect(geometry).toHaveBeenCalledOnce()
  })
})
