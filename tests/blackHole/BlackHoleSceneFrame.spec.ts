import { describe, it, expect } from 'vitest'
import { Texture, Vector2 } from 'three'
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

  it('объявляет копию кадра и sampleBackground; все побеги идут через неё, кубмапа напрямую — только внутри', () => {
    expect(frag).toContain('uniform sampler2D uSceneColor;')
    expect(frag).toContain('uniform sampler2D uSceneDepth;')
    expect(frag).toContain('uniform float uSceneEnabled;')
    expect(frag).toContain('vec3 sampleBackground(vec3 direction)')
    // Определение + три подстраховки внутри sampleBackground — и ни одного прямого вызова в ветках
    expect((frag.match(/sampleSkybox\(/g) ?? []).length).toBe(4)
    expect((frag.match(/sampleBackground\(/g) ?? []).length).toBeGreaterThanOrEqual(5)
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

    material.bindSceneFrame(color, depth, new Vector2(640, 360), 27.5)
    expect(material.uniforms.uSceneColor.value).toBe(color)
    expect(material.uniforms.uSceneDepth.value).toBe(depth)
    expect((material.uniforms.uSceneResolution.value as Vector2).x).toBe(640)
    expect(material.uniforms.uSceneLogFarFactor.value).toBe(27.5)
    expect(material.uniforms.uSceneEnabled.value).toBe(1)

    material.unbindSceneFrame()
    expect(material.uniforms.uSceneColor.value).toBeNull()
    expect(material.uniforms.uSceneDepth.value).toBeNull()
    expect(material.uniforms.uSceneEnabled.value).toBe(0)
    material.dispose()
  })
})
