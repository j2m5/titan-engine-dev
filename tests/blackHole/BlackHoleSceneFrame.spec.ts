import { describe, it, expect } from 'vitest'
import { Texture } from 'three'
import { BlackHoleShaderTemplate } from '@/core/renderables/BlackHole/BlackHoleShaderTemplate'
import { BlackHoleMaterial } from '@/core/renderables/BlackHole/BlackHoleMaterial'
import { BlackHoleParameters } from '@/core/renderables/BlackHole/BlackHoleParameters'
import { Actor } from '@/core/models/Actor'

function stubActor(): Actor {
  return {
    physicalObject: {
      getAttribute: (key: string, def?: unknown): unknown => (key === 'mass' ? 8.54e36 : def)
    },
    renderingObject: null,
    getAttribute: (key: string, def?: unknown): unknown => (key === 'name' ? 'Sagittarius A*' : def)
  } as unknown as Actor
}

describe('шейдер ЧД: фон побега — копия кадра, кубмапа как подстраховка', () => {
  const frag: string = BlackHoleShaderTemplate.fragmentShader

  it('объявляет копию кадра, слой неба и sampleBackground; все чтения неба — sampleSkyLensed', () => {
    expect(frag).toContain('uniform sampler2D uSceneColor;')
    expect(frag).toContain('uniform sampler2D uSceneDepth;')
    expect(frag).toContain('uniform sampler2D uSkyLayer;')
    expect(frag).toContain('uniform float uSceneEnabled;')
    expect(frag).toContain('vec3 sampleBackground(vec3 direction, vec3 dDx, vec3 dDy, vec3 dPixDx, vec3 dPixDy)')
    // Три подстраховки + небо по лучу в ветке кадра
    expect((frag.match(/sampleSkyLensed\(/g) ?? []).length).toBe(4)
    expect(frag).not.toMatch(/sampleSky\(/)
    // Определение + единственный вызов после веток
    expect((frag.match(/sampleBackground\(/g) ?? []).length).toBe(2)
  })

  it('ветка кадра: max(копия − слой, 0) + слой.a · небо по лучу', () => {
    expect(frag).toContain('vec4 layer = texture(uSkyLayer, uv);')
    expect(frag).toContain(
      'return max(texture(uSceneColor, uv).rgb - layer.rgb, vec3(0.0)) + layer.a * sampleSkyLensed(direction, dDx, dDy, dPixDx, dPixDy);'
    )
  })

  it('производные пикселя — до ветвлений; производные побега — после веток; discard — после них', () => {
    const main = frag.slice(frag.indexOf('void main()'))
    const tracer = frag.slice(frag.indexOf('vec3 traceGeodesic('), frag.indexOf('void main()'))

    expect(tracer).not.toContain('sampleBackground(')
    expect(main.indexOf('vec3 rayDx = dFdx(rayDir);')).toBeGreaterThan(-1)
    expect(main.indexOf('vec3 rayDx = dFdx(rayDir);')).toBeLessThan(main.indexOf('if (uLensing < 0.5)'))
    expect(main.indexOf('traceGeodesic(')).toBeLessThan(main.indexOf('vec3 escapeDx = dFdx(escape);'))
    expect(main.indexOf('vec3 escapeDx = dFdx(escape);')).toBeLessThan(
      main.indexOf('if (!cameraInside && b > simulationRs) discard;')
    )
    expect(main.indexOf('discard;')).toBeLessThan(main.indexOf('sampleBackground(escape, escapeDx, escapeDy, rayDx, rayDy)'))
  })

  it('проекция побега: направление → вид (crModelViewMatrix), → клип (crProjectionMatrix); за экраном и перед плоскостью сближения — кубмапа', () => {
    expect(frag).toContain('mat3(crModelViewMatrix) * direction')
    expect(frag).toContain('crProjectionMatrix * vec4(dirView, 0.0)')
    expect(frag).toContain('texture(uSceneDepth, uv).r')
    expect(frag).toContain('texture(uSceneColor, uv).rgb')
    expect(frag).toMatch(/sceneT < tMid/)
  })
})

describe('BlackHoleMaterial: привязка копии кадра', () => {
  it('bind включает кадр и заполняет юниформы, unbind отвязывает текстуры и выключает', () => {
    const material = new BlackHoleMaterial(new BlackHoleParameters(stubActor()))
    const color = new Texture()
    const depth = new Texture()
    const layer = new Texture()

    material.bindSceneFrame(color, depth, layer, 27.5)
    expect(material.uniforms.uSceneColor.value).toBe(color)
    expect(material.uniforms.uSceneDepth.value).toBe(depth)
    expect(material.uniforms.uSkyLayer.value).toBe(layer)
    expect(material.uniforms.uSceneResolution).toBeUndefined()
    expect(material.uniforms.uSceneLogFarFactor.value).toBe(27.5)
    expect(material.uniforms.uSceneEnabled.value).toBe(1)

    material.unbindSceneFrame()
    expect(material.uniforms.uSceneColor.value).toBeNull()
    expect(material.uniforms.uSceneDepth.value).toBeNull()
    expect(material.uniforms.uSkyLayer.value).toBeNull()
    expect(material.uniforms.uSceneEnabled.value).toBe(0)
    material.dispose()
  })
})
