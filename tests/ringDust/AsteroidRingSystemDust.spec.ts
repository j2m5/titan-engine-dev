import { vi } from 'vitest'
import { Group, Matrix4, PerspectiveCamera, Vector3 } from 'three'
import '@/core/framework/TitanThree'
import type { UpdateContext } from '@/core/UpdateContext'

// resourceStorage тянет текстуры при создании L0-материала — в jsdom их нет
vi.mock('@/core/services/ResourceStorage', () => ({
  resourceStorage: { getTexture: () => null }
}))

import { AsteroidRingSystem } from '@/core/renderables/DetailedRingStreamingSystem'
import { Actor } from '@/core/models/Actor'
import { internalsOf, poolOf } from '../helpers/ringSystemInternals'
import { DepthVolumeRegistry } from '@/core/services/DepthVolumeRegistry'

const makeFakeActor = (): Actor =>
  ({
    getAttribute: () => 42,
    renderingObject: {
      getAttribute: () => ({ innerRadius: 70000, outerRadius: 140000 })
    }
  }) as unknown as Actor

describe('AsteroidRingSystem dust integration', () => {
  it.each([10, 17])('uses final camera after parent motion and camera correction by %s', (cameraShift) => {
    const system = new AsteroidRingSystem(makeFakeActor())
    const parent = new Group()
    parent.add(system)
    const camera = new PerspectiveCamera(50, 1, 0.1, 10000)
    camera.position.set(100, 20, 30)
    camera.updateMatrixWorld(true)
    parent.updateMatrixWorld(true)
    const sectors = vi.spyOn(internalsOf(system).cascades, 'update')
    try {
      parent.position.x = 10
      system.updateObject({ delta: 0.025, epoch: 2451545, elapsed: 0, camera } as UpdateContext)
      expect(sectors).not.toHaveBeenCalled()
      camera.position.x += cameraShift
      camera.lookAt(parent.position)
      camera.updateMatrixWorld(true)
      system.updateView?.(camera)

      const expected = system.worldToLocal(camera.getWorldPosition(new Vector3()))
      expect(expected.x).toBeCloseTo(100 + cameraShift - 10, 12)
      const pool = poolOf(system)
      for (const uniforms of [pool.geometryMaterial.uniforms, pool.billboardMaterial.uniforms,
        internalsOf(system).dustVolume!.dustMaterial.uniforms]) {
        expect(uniforms.uDustCamRingPos.value.distanceTo(expected)).toBeLessThan(1e-10)
      }
      expect(sectors).toHaveBeenCalledTimes(1)
      const [angle, radius, height, viewProjection, localToWorld, delta] = sectors.mock.calls[0]
      expect(angle).toBeCloseTo(Math.atan2(expected.z, expected.x), 12)
      expect(radius).toBeCloseTo(Math.hypot(expected.x, expected.z), 12)
      expect(height).toBeCloseTo(expected.y, 12)
      expect(viewProjection.elements).toEqual(new Matrix4().multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse).elements)
      expect(localToWorld.elements[12]).toBe(10)
      expect(delta).toBe(0.025)
    } finally {
      system.dispose()
    }
  })

  it('adds a RingDustVolume child by default', () => {
    const system = new AsteroidRingSystem(makeFakeActor())
    const dust = system.children.find((c) => c.name === 'RingDustVolume')
    expect(dust).toBeDefined()
  })

  it('калибрует плотность через целевой tau грейзинг-луча (dustTauGrazing / ширину кольца)', () => {
    // Явный override: тест проверяет формулу калибровки, а не дефолт
    const system = new AsteroidRingSystem(makeFakeActor(), { dustTauGrazing: 0.3 })
    const u = poolOf(system).billboardMaterial.uniforms
    const width = u.uDustRingOuter.value - u.uDustRingInner.value
    expect(u.uDustDensity.value).toBeCloseTo(0.3 / width, 10)
  })

  it('передаёт гейт и рамп в материалы камней', () => {
    const system = new AsteroidRingSystem(makeFakeActor())
    const u = poolOf(system).billboardMaterial.uniforms
    expect(u.uDustAnglePower.value).toBe(2)
    expect(u.uDustNearFade.value).toBeGreaterThan(0)
  })

  it('регистрирует объём пыли в реестре пасса, когда реестр передан', () => {
    const registry = new DepthVolumeRegistry()
    const system = new AsteroidRingSystem(makeFakeActor(), {}, registry)
    const dust = system.children.find((c) => c.name === 'RingDustVolume')
    expect(registry.volumes()).toEqual([dust])
  })

  it('respects dustEnabled: false override', () => {
    const system = new AsteroidRingSystem(makeFakeActor(), { dustEnabled: false })
    const dust = system.children.find((c) => c.name === 'RingDustVolume')
    expect(dust).toBeUndefined()
    const uniforms = poolOf(system).billboardMaterial.uniforms
    expect(uniforms.uDustDensity.value).toBe(0)
  })
})
