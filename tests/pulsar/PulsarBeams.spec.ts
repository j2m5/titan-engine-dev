import { describe, it, expect } from 'vitest'
import { AdditiveBlending, Color, PerspectiveCamera, Vector2, Vector3 } from 'three'
import { PulsarBeams } from '@/core/renderables/Pulsar/PulsarBeams'
import { DepthVolumeRegistry } from '@/core/services/DepthVolumeRegistry'
import { DEPTH_VOLUME_LAYER } from '@/core/graphic/passes/DepthVolume'
import type { PulsarParameters } from '@/core/renderables/Pulsar/PulsarParameters'
import type { UpdateContext } from '@/core/UpdateContext'
import { J2000 } from '@/core/constants'

const params = (over: Partial<PulsarParameters> = {}): PulsarParameters => ({
  exposureBias: 1,
  beamPeriodSeconds: 4,
  beamTiltRad: Math.PI / 6,
  beamHalfAngleRad: (6 * Math.PI) / 180,
  beamLengthUnits: 1000,
  beamColor: new Color(0xbcd4ff),
  beamIntensity: 6,
  beamPhaseRad: 0,
  ...over
})

const ctxAt = (epoch: number) =>
  ({ epoch, delta: 0.016, elapsed: 0, camera: new PerspectiveCamera() }) as unknown as UpdateContext

describe('PulsarBeams: объём в проходе глубины', () => {
  it('регистрируется в реестре, живёт на слое объёмов, прокси — сфера 1.05·L, аддитивен без записи глубины', () => {
    const registry = new DepthVolumeRegistry()
    const beams = new PulsarBeams(params(), registry)

    expect([...registry.volumes()]).toContain(beams)
    expect(beams.layers.mask).toBe(1 << DEPTH_VOLUME_LAYER)
    expect(beams.boundingRadius).toBeCloseTo(1050, 6)
    expect(beams.material.blending).toBe(AdditiveBlending)
    expect(beams.material.depthWrite).toBe(false)
    expect(beams.material.depthTest).toBe(false)
    expect(beams.frustumCulled).toBe(false)
  })

  it('юниформы из параметров: полуугол, длина, цвет, яркость', () => {
    const u = new PulsarBeams(params(), null).material.uniforms

    expect(u.uHalfAngle.value).toBeCloseTo((6 * Math.PI) / 180, 9)
    expect(u.uLength.value).toBe(1000)
    expect((u.uColor.value as Color).getHex()).toBe(0xbcd4ff)
    expect(u.uIntensity.value).toBe(6)
  })

  it('updateObject ставит магнитную ось по фазе: на J2000 фаза 0 — ось в плоскости XY под 30° к Y', () => {
    const beams = new PulsarBeams(params(), null)
    beams.updateObject(ctxAt(J2000))
    const axis = beams.material.uniforms.uAxis.value as Vector3

    expect(axis.length()).toBeCloseTo(1, 9)
    expect(axis.angleTo(new Vector3(0, 1, 0))).toBeCloseTo(Math.PI / 6, 9)
    expect(Math.abs(axis.z)).toBeCloseTo(0, 9)
  })

  it('tilt 0 — ось +Y на любой эпохе', () => {
    const beams = new PulsarBeams(params({ beamTiltRad: 0 }), null)
    for (const epoch of [J2000, J2000 + 0.5, J2000 + 1234]) {
      beams.updateObject(ctxAt(epoch))
      expect((beams.material.uniforms.uAxis.value as Vector3).distanceTo(new Vector3(0, 1, 0))).toBeCloseTo(0, 9)
    }
  })

  it('контракт DepthVolume: bind пишет глубину, unbind гасит, dispose снимает с реестра', () => {
    const registry = new DepthVolumeRegistry()
    const beams = new PulsarBeams(params(), registry)
    const u = beams.material.uniforms

    beams.bindSceneDepth({ name: 'depth' } as never, new Vector2(1920, 1080), 27.5)
    expect(u.uSceneDepthEnabled.value).toBe(1)
    expect(u.uLogFarFactor.value).toBe(27.5)
    expect((u.uResolution.value as Vector2).x).toBe(1920)
    beams.unbindSceneDepth()
    expect(u.uSceneDepthEnabled.value).toBe(0)

    beams.dispose()
    expect([...registry.volumes()]).not.toContain(beams)
  })

  it('GLSL: текст несёт тот же профиль, что CPU-зеркало, обрезку по глубине сцены и старт марша внутри сферы', () => {
    const frag = new PulsarBeams(params(), null).material.fragmentShader

    expect(frag).toContain('exp(-(angle / uHalfAngle) * (angle / uHalfAngle))')
    expect(frag).toContain('(1.0 - d / uLength) * (1.0 - d / uLength)')
    expect(frag).toContain('sceneDepthRayT(')
    expect(frag).toContain('abs(dot(p, uAxis))')
    expect(frag).toContain('max(-b - s, 0.0)')
  })

  it('GLSL: фрагментник сам объявляет modelViewMatrix — во фрагментном префиксе three его нет', () => {
    const frag = new PulsarBeams(params(), null).material.fragmentShader

    expect(frag).toMatch(/uniform mat4 modelViewMatrix;/)
  })

  it('GLSL: старт марша джиттерится по gl_FragCoord (не по varying) — у основания конус уже шага', () => {
    const frag = new PulsarBeams(params(), null).material.fragmentShader

    expect(frag).toContain('gl_FragCoord')
    expect(frag).toContain('52.9829189')
    expect(frag).toMatch(/\(float\(i\) \+ jitter\) \* dt/)
  })
})
