import { describe, it, expect } from 'vitest'
import { Object3D, PerspectiveCamera, Vector3, WebGLRenderer, WebGLRenderTarget } from 'three'
import { EffectAttribute, EffectPass } from 'postprocessing'
import { GravitationalLensEffect, createGravitationalLensPass } from '@/core/graphic/effects/lens/GravitationalLensEffect'
import { LENS_SLOTS } from '@/core/graphic/effects/lens/gravitationalLensShader'
import { LensRegistry, LensEntry } from '@/core/services/LensRegistry'
import { farFieldDeflection } from '@/core/renderables/BlackHole/deflectionLut'

const noRenderer = null as unknown as WebGLRenderer
const noBuffer = null as unknown as WebGLRenderTarget

function lensAt(position: Vector3, over: Partial<LensEntry> = {}): LensEntry {
  const object = new Object3D()
  object.position.copy(position)
  object.updateMatrixWorld(true)
  return { object, rsUnits: 1, simulationRadiusUnits: 27, background: () => null, ...over }
}

function cameraAtOrigin(): PerspectiveCamera {
  const camera = new PerspectiveCamera(50, 16 / 9, 1e-6, 1e8)
  camera.position.set(0, 0, 0)
  camera.updateMatrixWorld(true)
  camera.updateProjectionMatrix()
  return camera
}

describe('GravitationalLensEffect: экранный проход дальнего поля', () => {
  it('читает соседей и глубину: CONVOLUTION | DEPTH; свой пасс', () => {
    const effect = new GravitationalLensEffect(cameraAtOrigin(), new LensRegistry())

    expect(effect.getAttributes() & EffectAttribute.CONVOLUTION).toBeTruthy()
    expect(effect.getAttributes() & EffectAttribute.DEPTH).toBeTruthy()
    expect(createGravitationalLensPass(cameraAtOrigin(), new LensRegistry())).toBeInstanceOf(EffectPass)
  })

  it('update: центр линзы в пространстве вида относительно камеры, rs и радиус зоны в слоте 0, uCount = 1', () => {
    const registry = new LensRegistry()
    registry.register(lensAt(new Vector3(0, 0, -1000), { rsUnits: 2, simulationRadiusUnits: 54 }))
    const effect = new GravitationalLensEffect(cameraAtOrigin(), registry)

    effect.update(noRenderer, noBuffer)

    expect(effect.uniforms.get('uCount')!.value).toBe(1)
    const center = (effect.uniforms.get('uCenterView')!.value as Vector3[])[0]
    expect(center.x).toBeCloseTo(0, 9)
    expect(center.z).toBeCloseTo(-1000, 6)
    expect((effect.uniforms.get('uRs')!.value as number[])[0]).toBe(2)
    expect((effect.uniforms.get('uSimRadius')!.value as number[])[0]).toBe(54)
    expect(effect.lensCount).toBe(1)
  })

  it('невидимый L0 (импостор) и камера внутри сферы линзу выключают', () => {
    const hidden = lensAt(new Vector3(0, 0, -1000))
    hidden.object.visible = false
    const inside = lensAt(new Vector3(0, 0, -10), { simulationRadiusUnits: 27 })
    const registry = new LensRegistry()
    registry.register(hidden)
    registry.register(inside)
    const effect = new GravitationalLensEffect(cameraAtOrigin(), registry)

    effect.update(noRenderer, noBuffer)

    expect(effect.uniforms.get('uCount')!.value).toBe(0)
  })

  it('не больше LENS_SLOTS линз; кубмапа берётся у первой', () => {
    const registry = new LensRegistry()
    const marker = { name: 'bg' } as never
    for (let i = 0; i < LENS_SLOTS + 1; i++) {
      registry.register(lensAt(new Vector3(i * 100, 0, -1000), { background: () => (i === 0 ? marker : null) }))
    }
    const effect = new GravitationalLensEffect(cameraAtOrigin(), registry)

    effect.update(noRenderer, noBuffer)

    expect(effect.uniforms.get('uCount')!.value).toBe(LENS_SLOTS)
    expect(effect.uniforms.get('skybox')!.value).toBe(marker)
  })

  it('GLSL: ряд дальнего поля — зеркало farFieldDeflection; пропуски b ≤ R и объекта перед линзой; подстраховка кубмапой', () => {
    const frag = new GravitationalLensEffect(cameraAtOrigin(), new LensRegistry()).getFragmentShader()!

    expect(frag).toContain('2.0 / b + 2.9452431 / b2 + 5.3333333 / (b2 * b)')
    expect(frag).toContain('if (b <= R) continue;')
    expect(frag).toContain('if (sceneT < tMid) continue;')
    expect(frag).toContain('texture2D(inputBuffer, uv2)')
    expect(frag).toContain('sampleSkyboxHdr(skybox, world, uSkyFlipX)')
    expect(frag).toContain('exp2(z * uLogFarFactor) - 1.0')
    // Коэффициенты ряда в GLSL совпадают с CPU-зеркалом с точностью литералов
    const glslAt = (b: number) => 2 / b + 2.9452431 / (b * b) + 5.3333333 / (b * b * b)
    for (const b of [8, 27, 100]) expect(Math.abs(glslAt(b) - farFieldDeflection(b))).toBeLessThan(1e-7)
  })
})
