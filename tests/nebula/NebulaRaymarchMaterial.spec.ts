import { Vector3 } from 'three'
import { NebulaRaymarchMaterial } from '@/core/renderables/Nebula/material/NebulaRaymarchMaterial'
import { mergeNebulaParams } from '@/core/renderables/Nebula/NebulaParams'
import { sceneDepthFunctions, sceneDepthUniforms } from '@/core/materials/shaders/lib/chunks/SceneDepth'

describe('NebulaRaymarchMaterial: перекрытие по глубине сцены', () => {
  const make = () => new NebulaRaymarchMaterial(mergeNebulaParams())

  it('depthTest и depthWrite выключены: перекрытие считает марш, а не аппаратный тест', () => {
    // Бинарный тест глубины давал либо жёсткие вырезы (глубина дальней стенки
    // прокси), либо туман поверх всего. Объём рисует DepthVolumePass после сцены
    // и режет луч на глубине сцены
    const m = make()
    expect(m.depthTest).toBe(false)
    expect(m.depthWrite).toBe(false)
  })

  it('несёт юниформы глубины сцены, обрезка по умолчанию выключена (запекание импостора идёт без неё)', () => {
    const u = make().uniforms
    expect(u.uSceneDepth.value).toBeNull()
    expect(u.uResolution.value.x).toBe(1)
    expect(u.uLogFarFactor.value).toBe(1)
    expect(u.uSceneDepthEnabled.value).toBe(0)
    // Своей записи глубины больше нет — её фактор не нужен
    expect(u.uLogDepthBufFC).toBeUndefined()
  })

  it('режет дальнюю границу луча по глубине сцены общим чанком и не пишет глубину', () => {
    const fs = make().fragmentShader
    expect(fs).toContain(sceneDepthUniforms)
    expect(fs).toContain(sceneDepthFunctions)
    // Направление луча в proxy-local переводится во view без нормировки:
    // масштаб прокси-куба (size) учитывается сам
    expect(fs).toContain('tf = min(tf, sceneDepthRayT(mat3(modelViewMatrix) * rdLocal))')
    // Обрезка стоит ДО проверки пустого интервала: луч, упёршийся в поверхность
    // раньше входа в куб, уходит в discard
    expect(fs.indexOf('sceneDepthRayT(')).toBeLessThan(fs.indexOf('if (tf <= tn) discard'))
    expect(fs).not.toContain('gl_FragDepth')
    expect(fs).not.toContain('vFragDepth')
    expect(make().vertexShader).not.toContain('vFragDepth')
  })
})

describe('NebulaRaymarchMaterial', () => {
  it('constructs with uniforms derived from params', () => {
    const mat = new NebulaRaymarchMaterial(mergeNebulaParams({ quality: { maxSteps: 64 } }))
    expect(mat.uniforms.uMaxSteps.value).toBe(64)
    expect(mat.transparent).toBe(true)
    expect(mat.depthWrite).toBe(false)
    expect(typeof mat.vertexShader).toBe('string')
    expect(mat.fragmentShader.length).toBeGreaterThan(0)
  })

  it('updateMaterial writes the given elapsed time into uTime', () => {
    const mat = new NebulaRaymarchMaterial(mergeNebulaParams())
    mat.updateMaterial(5)
    expect(mat.uniforms.uTime.value).toBe(5)
  })

  it('builds independent uniform instances per material (no shared state)', () => {
    const a = new NebulaRaymarchMaterial(mergeNebulaParams({ quality: { maxSteps: 32 } }))
    const b = new NebulaRaymarchMaterial(mergeNebulaParams({ quality: { maxSteps: 128 } }))
    expect(a.uniforms.uMaxSteps).not.toBe(b.uniforms.uMaxSteps)
    expect(a.uniforms.uMaxSteps.value).toBe(32)
    expect(b.uniforms.uMaxSteps.value).toBe(128)
  })

  it('uploads the density (absorption) knob from params', () => {
    const mat = new NebulaRaymarchMaterial(mergeNebulaParams({ density: 1.5 }))
    expect(mat.uniforms.uDensityScale.value).toBe(1.5)
  })

  it('uploads palette + dust + light uniforms from params', () => {
    const mat = new NebulaRaymarchMaterial(
      mergeNebulaParams({ dust: { strength: 0.7 }, lighting: { scatterStrength: 0.9 } })
    )
    expect(mat.uniforms.uDustStrength.value).toBe(0.7)
    expect(mat.uniforms.uScatterStrength.value).toBe(0.9)
    expect(mat.uniforms.uPalette0).toBeDefined()
    expect(mat.uniforms.uPaletteT.value.x).toBe(0)
    expect(mat.uniforms.uHasStar.value).toBe(0)
  })

  it('flags uHasStar when a star position is supplied', () => {
    const mat = new NebulaRaymarchMaterial(
      mergeNebulaParams({ lighting: { starPosition: new Vector3(1, 2, 3) } })
    )
    expect(mat.uniforms.uHasStar.value).toBe(1)
  })

  it('packs lobes into the fixed-size uniform arrays', () => {
    const mat = new NebulaRaymarchMaterial(
      mergeNebulaParams({
        lobes: [
          { center: new Vector3(0.5, 0, 0), radius: 0.3, weight: 1.5, seed: 1 },
          { center: new Vector3(-0.4, 0.2, 0), radius: 0.25, weight: 1, seed: 2 }
        ],
        noise: { worleyStrength: 0.7 }
      })
    )
    expect(mat.uniforms.uLobeCount.value).toBe(2)
    expect(mat.uniforms.uLobeData.value[0].w).toBe(0.3)
    expect(mat.uniforms.uLobeWeight.value[0]).toBe(1.5)
    expect(mat.uniforms.uLobeData.value).toHaveLength(8)
    expect(mat.uniforms.uWorleyStrength.value).toBe(0.7)
  })
})
