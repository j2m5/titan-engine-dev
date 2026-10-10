import { Group, Mesh, PerspectiveCamera, Scene, ShaderMaterial, WebGLRenderer } from 'three'
import type { Actor } from '@/core/models/Actor'
import type { ResourceObserver } from '@/core/services/ResourceObserver'
import { BlackHole } from '@/core/renderables/BlackHole/BlackHole'
import { BlackHoleImpostor } from '@/core/renderables/BlackHole/BlackHoleImpostor'
import { ApparentSizeLod } from '@/core/renderables/utils/ApparentSizeLod'
import { toThreeJSUnits } from '@/core/helpers/scaling'
import { config } from '@/core/framework/config'

const cleanup: Array<() => void> = []
afterEach(() => cleanup.splice(0).forEach((dispose) => dispose()))

function setup(data: Record<string, number> = {}) {
  const actor = {
    physicalObject: {
      getAttribute: (key: string, fallback?: unknown): unknown => {
        if (key === 'mass') return 7.9564e36
        if (key === 'temperature') return 6500
        return fallback
      }
    },
    renderingObject: { getAttribute: (): Record<string, number> => data },
    getAttribute: (_key: string, fallback?: unknown): unknown => fallback
  } as unknown as Actor
  const renderer = { domElement: { height: 1080 } } as WebGLRenderer
  const hole = new BlackHole(actor, { sceneBackground: null } as ResourceObserver)
  const impostor = new BlackHoleImpostor(actor, hole.parameters, renderer)
  const ring = impostor.children.find((child) => child.name.endsWith('Ring')) as Mesh<never, ShaderMaterial>
  const scene = new Scene()
  scene.add(hole, impostor)
  const camera = new PerspectiveCamera(50)
  const radius = toThreeJSUnits(hole.parameters.diskOuterRadius)

  cleanup.push(() => {
    hole.material.dispose()
    hole.geometry.dispose()
    for (const child of impostor.children as Mesh[]) {
      child.geometry.dispose()
      if (!Array.isArray(child.material)) child.material.dispose()
    }
  })

  function render(renderCamera: PerspectiveCamera = camera): readonly [number, number] {
    scene.updateMatrixWorld(true)
    renderCamera.updateMatrixWorld(true)
    hole.onBeforeRender(renderer, scene, renderCamera, hole.geometry, hole.material, {} as Group)
    ring.onBeforeRender(renderer, scene, renderCamera, ring.geometry, ring.material, {} as Group)
    return [hole.material.uniforms.uDiskIntensity.value, ring.material.uniforms.uDiskIntensity.value]
  }

  function atRadius(distance: number): readonly [number, number] {
    camera.position.set(0, 0, radius * distance)
    return render()
  }

  return { hole, impostor, renderer, camera, radius, render, atRadius }
}

describe('эмиссия диска: крупный ближний план и свечение вдали', () => {
  it('внутри внешнего радиуса и до запаса в четверть радиуса эмиссия остаётся базовой', () => {
    const s = setup()
    expect(s.atRadius(0)).toEqual([6, 6])
    expect(s.atRadius(1)).toEqual([6, 6])
    expect(s.atRadius(1.25)).toEqual([6, 6])
  })

  it('сразу за запасом начинается плавное усиление, заметное уже на двух радиусах', () => {
    const s = setup()
    for (const value of s.atRadius(1.3)) {
      expect(value).toBeGreaterThan(6)
      expect(value).toBeLessThan(6.1)
    }
    for (const value of s.atRadius(2)) expect(value).toBeGreaterThan(7)
  })

  it('усиление маленького диска ограничено даже при дальнейшем отлёте', () => {
    const s = setup()
    expect(s.atRadius(128)).toEqual([288, 288])
    expect(s.atRadius(1e9)).toEqual([288, 288])
  })

  it('направление взгляда, FOV и zoom не сдвигают границу усиления', () => {
    const s = setup()
    const before = s.atRadius(12)
    s.camera.rotation.y = 0.6
    s.camera.aspect = 16 / 9
    s.camera.fov = 80
    s.camera.zoom = 2
    s.camera.updateProjectionMatrix()
    for (const value of s.render()) expect(value).toBeCloseTo(before[0], 10)
  })

  it('яркость плавно растёт при отлёте и совпадает у обоих LOD', () => {
    const s = setup()
    for (const value of s.atRadius(Math.sqrt(160))) expect(value).toBeCloseTo(147, 10)
    let previous = 6
    for (let distance = 1.25; distance <= 128; distance *= 1.01) {
      const [near, far] = s.atRadius(distance)
      expect(near).toBeCloseTo(far, 10)
      expect(near).toBeGreaterThanOrEqual(previous)
      expect(near).toBeLessThanOrEqual(288)
      expect(near - previous).toBeLessThan(1)
      previous = near
    }
  })

  it('использует расстояние до камеры текущего рендера, а не прошлого update', () => {
    const s = setup()
    const before = s.atRadius(Math.sqrt(160))
    s.impostor.updateObject({ camera: s.camera, epoch: 0, delta: 0, elapsed: 0 })
    const fartherCamera = s.camera.clone()
    fartherCamera.position.multiplyScalar(2)
    for (const value of s.render(fartherCamera)) expect(value).toBeGreaterThan(before[0])
  })

  it('яркость не зависит от разрешения рендера и размера пола импостора', () => {
    const s = setup()
    s.atRadius(1e4)
    for (const height of [540, 1080, 2160]) {
      s.renderer.domElement.height = height
      s.impostor.updateObject({ camera: s.camera, epoch: 0, delta: 0, elapsed: 0 })
      expect(s.impostor.scale.x).toBeGreaterThan(1)
      expect(s.render()).toEqual([288, 288])
    }
  })

  it('по обе стороны переключения LOD и его гистерезиса усиление одинаково', () => {
    const s = setup()
    const lod = new ApparentSizeLod(s.hole.parameters.simulationRadius, s.renderer, config('blackHole.lodPixels'))
    const distance = lod.switchDistance(s.camera.fov)
    for (const scale of [0.69, 0.71, 0.99, 1.01]) {
      s.camera.position.set(0, 0, distance * scale)
      const [near, far] = s.render()
      expect(near).toBeCloseTo(far, 10)
      expect(near).toBeGreaterThan(6)
    }
  })

  it('учитывает мировое положение объекта и камеры', () => {
    const s = setup()
    const before = s.atRadius(2)
    const objectParent = new Group()
    const cameraParent = new Group()
    objectParent.position.set(1e6, 2e6, -3e6)
    cameraParent.position.set(-4e6, 5e6, 6e6)
    objectParent.add(s.hole, s.impostor)
    cameraParent.add(s.camera)
    s.camera.position.add(objectParent.position).sub(cameraParent.position)
    objectParent.updateMatrixWorld(true)
    cameraParent.updateMatrixWorld(true)
    for (const value of s.render()) expect(value).toBeCloseTo(before[0], 8)
  })

  it('базовая интенсивность и дальний множитель управляются независимо', () => {
    const s = setup({ diskIntensity: 3, diskFarGain: 3 })
    expect(s.atRadius(1)).toEqual([3, 3])
    expect(s.atRadius(128)).toEqual([9, 9])
  })

  it('множитель 1 отключает усиление, нулевая эмиссия не разгорается вдали', () => {
    const constant = setup({ diskIntensity: 4, diskFarGain: 1 })
    expect(constant.atRadius(1)).toEqual([4, 4])
    expect(constant.atRadius(16)).toEqual([4, 4])
    expect(setup({ diskIntensity: 0 }).atRadius(16)).toEqual([0, 0])
  })
})
