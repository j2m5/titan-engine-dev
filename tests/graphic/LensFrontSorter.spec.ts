import { describe, expect, it } from 'vitest'
import { Group, Mesh, MeshBasicMaterial, Object3D, PerspectiveCamera, Scene, Vector3 } from 'three'
import { LensFrontSorter, isInFrontOfLens } from '@/core/graphic/passes/LensFrontSorter'
import { LENS_FRONT_DEPTH_LAYER, LENS_FRONT_LAYER, type DepthVolume } from '@/core/graphic/passes/DepthVolume'
import { LensRegistry } from '@/core/services/LensRegistry'
import { DepthVolumeRegistry } from '@/core/services/DepthVolumeRegistry'

const FRONT_MASK = 1 << LENS_FRONT_LAYER
/** Перенесённый объект, пишущий глубину: ещё и слой глубины */
const WRITES_MASK = FRONT_MASK | (1 << LENS_FRONT_DEPTH_LAYER)

/** Тело в тестах — группа с флагом: настоящий DynamicNode требует орбитальных моделей актора */
const isBody = (object: Object3D): boolean => object.userData.body === true

function body(x: number, y: number, z: number): Group {
  const group = new Group()
  group.userData.body = true
  group.position.set(x, y, z)
  return group
}

function mesh(params: ConstructorParameters<typeof MeshBasicMaterial>[0] = {}): Mesh {
  return new Mesh(undefined, new MeshBasicMaterial(params))
}

function volume(registry: DepthVolumeRegistry, parent: Object3D, z: number): DepthVolume {
  const v = Object.assign(new Object3D(), { bindSceneDepth: () => {}, unbindSceneDepth: () => {} }) as DepthVolume
  v.position.set(0, 0, z)
  parent.add(v)
  registry.register(v)
  return v
}

/** Камера на +z в 10, дыра в нуле внутри своего тела */
function setup() {
  const scene = new Scene()
  const camera = new PerspectiveCamera()
  camera.position.set(0, 0, 10)
  scene.add(camera)
  const hole = body(0, 0, 0)
  const lensMesh = Object.assign(new Object3D(), { bindSceneFrame: () => {}, unbindSceneFrame: () => {} })
  hole.add(lensMesh)
  scene.add(hole)
  const lenses = new LensRegistry()
  lenses.register({ object: lensMesh, rsUnits: 1, simulationRadiusUnits: 3, background: () => null })
  const volumes = new DepthVolumeRegistry()
  const sorter = new LensFrontSorter(scene, camera, lenses, volumes, isBody)
  return { scene, camera, hole, lensMesh, lenses, volumes, sorter }
}

describe('isInFrontOfLens: ближе точки наибольшего сближения луча с линзой', () => {
  const camera = new Vector3(0, 0, 10)
  const lens = new Vector3(0, 0, 0)

  it('между камерой и дырой — перед', () => {
    expect(isInFrontOfLens(new Vector3(0, 0, 5), camera, lens)).toBe(true)
  })

  it('за дырой — нет', () => {
    expect(isInFrontOfLens(new Vector3(0, 0, -5), camera, lens)).toBe(false)
  })

  it('сбоку под большим углом — нет: сближение луча с дырой у самой камеры', () => {
    expect(isInFrontOfLens(new Vector3(8, 0, 9), camera, lens)).toBe(false)
  })

  it('камера внутри сферы: перед дырой — перед, за ней и в обратную сторону — нет', () => {
    const inside = new Vector3(0, 0, 1)
    expect(isInFrontOfLens(new Vector3(0, 0, 0.5), inside, lens)).toBe(true)
    expect(isInFrontOfLens(new Vector3(0, 0, -1), inside, lens)).toBe(false)
    expect(isInFrontOfLens(new Vector3(0, 0, 3), inside, lens)).toBe(false)
  })

  it('объект в самой камере — перед', () => {
    expect(isInFrontOfLens(camera.clone(), camera, lens)).toBe(true)
  })
})

describe('LensFrontSorter: разметка тел перед активной линзой', () => {
  it('у тела перед дырой переносятся прозрачное, без записи глубины и депт-препасс; непрозрачное — нет', () => {
    const { scene, sorter } = setup()
    const near = body(0, 0, 5)
    const transparent = mesh({ transparent: true })
    const noDepthWrite = mesh({ depthWrite: false })
    const prepass = mesh({ colorWrite: false })
    const opaque = mesh()
    near.add(transparent, noDepthWrite, prepass, opaque)
    scene.add(near)

    sorter.split()

    expect(transparent.layers.mask).toBe(WRITES_MASK)
    expect(noDepthWrite.layers.mask).toBe(FRONT_MASK)
    expect(prepass.layers.mask).toBe(WRITES_MASK)
    expect(opaque.layers.mask).toBe(1)
    expect(sorter.frontObjects()).toEqual([transparent, noDepthWrite, prepass])
  })

  it('массив материалов с одним прозрачным — объект переносится целиком', () => {
    const { scene, sorter } = setup()
    const near = body(0, 0, 5)
    const mixed = new Mesh(undefined, [new MeshBasicMaterial(), new MeshBasicMaterial({ transparent: true })])
    near.add(mixed)
    scene.add(near)

    sorter.split()

    expect(mixed.layers.mask).toBe(WRITES_MASK)
  })

  it('объект с нестандартной маской слоёв не трогается', () => {
    const { scene, sorter } = setup()
    const near = body(0, 0, 5)
    const special = mesh({ transparent: true })
    special.layers.set(5)
    near.add(special)
    scene.add(near)

    sorter.split()

    expect(special.layers.mask).toBe(1 << 5)
  })

  it('тело за дырой и тело самой дыры не переносятся', () => {
    const { scene, hole, sorter } = setup()
    const far = body(0, 0, -5)
    const farGlow = mesh({ transparent: true })
    far.add(farGlow)
    scene.add(far)
    const holeGlow = mesh({ transparent: true })
    hole.add(holeGlow)

    sorter.split()

    expect(farGlow.layers.mask).toBe(1)
    expect(holeGlow.layers.mask).toBe(1)
  })

  it('вложенное тело классифицируется само: луна за дырой у планеты перед дырой', () => {
    const { scene, sorter } = setup()
    const planet = body(0, 0, 5)
    const ring = mesh({ transparent: true })
    const moon = body(0, 0, -10)
    const moonHalo = mesh({ transparent: true })
    planet.add(ring, moon)
    moon.add(moonHalo)
    scene.add(planet)

    sorter.split()

    expect(ring.layers.mask).toBe(WRITES_MASK)
    expect(moonHalo.layers.mask).toBe(1)
  })

  it('две линзы: тело переносится, если оно перед любой из них', () => {
    const { scene, lenses, sorter } = setup()
    const second = body(20, 0, 10)
    const secondMesh = Object.assign(new Object3D(), { bindSceneFrame: () => {}, unbindSceneFrame: () => {} })
    second.add(secondMesh)
    scene.add(second)
    lenses.register({ object: secondMesh, rsUnits: 1, simulationRadiusUnits: 3, background: () => null })
    // Сбоку от первой дыры (сближение у самой камеры), но между камерой и второй
    const aside = body(5, 0, 10)
    const glow = mesh({ transparent: true })
    aside.add(glow)
    scene.add(aside)

    sorter.split()

    expect(glow.layers.mask).toBe(WRITES_MASK)
  })

  it('пишущие глубину отмечены слоем глубины: их глубину LensFrontPass дописывает в буфер сцены', () => {
    const { scene, sorter } = setup()
    const near = body(0, 0, 5)
    const glowOnly = mesh({ transparent: true, depthWrite: false })
    near.add(glowOnly)
    scene.add(near)

    sorter.split()
    expect(glowOnly.layers.mask).toBe(FRONT_MASK)
    expect(sorter.hasDepthWriters()).toBe(false)

    const prepass = mesh({ colorWrite: false })
    near.add(prepass)
    sorter.split()
    expect(prepass.layers.mask).toBe(WRITES_MASK)
    expect(sorter.hasDepthWriters()).toBe(true)

    sorter.restore()
    expect(prepass.layers.mask).toBe(1)
    expect(sorter.hasDepthWriters()).toBe(false)
  })

  it('объекты вне тел (фон, скайбокс) не переносятся даже перед дырой', () => {
    const { scene, sorter } = setup()
    const backdrop = mesh({ transparent: true, depthWrite: false })
    backdrop.position.set(0, 0, 5)
    scene.add(backdrop)

    sorter.split()

    expect(backdrop.layers.mask).toBe(1)
  })

  it('линза неактивна (L0 скрыт, импостор) — ничего не переносится', () => {
    const { scene, lensMesh, sorter } = setup()
    lensMesh.visible = false
    const near = body(0, 0, 5)
    const glow = mesh({ transparent: true })
    near.add(glow)
    scene.add(near)

    sorter.split()

    expect(glow.layers.mask).toBe(1)
    expect(sorter.frontObjects()).toEqual([])
  })

  it('restore возвращает слой 0; повторный split начинает с возврата', () => {
    const { scene, sorter } = setup()
    const near = body(0, 0, 5)
    const glow = mesh({ transparent: true })
    near.add(glow)
    scene.add(near)

    sorter.split()
    sorter.restore()
    expect(glow.layers.mask).toBe(1)
    expect(sorter.frontObjects()).toEqual([])

    sorter.split()
    near.position.set(0, 0, -5)
    sorter.split()
    expect(glow.layers.mask).toBe(1)
  })

  it('объёмы: передний и видимый — в множестве, задний и скрытый — нет', () => {
    const { scene, volumes, sorter } = setup()
    const front = volume(volumes, scene, 5)
    const back = volume(volumes, scene, -5)
    const hiddenParent = new Group()
    hiddenParent.visible = false
    scene.add(hiddenParent)
    const hidden = volume(volumes, hiddenParent, 5)

    sorter.split()

    expect(sorter.frontVolumes()).toEqual([front])
    expect(sorter.isFrontVolume(front)).toBe(true)
    expect(sorter.isFrontVolume(back)).toBe(false)
    expect(sorter.isFrontVolume(hidden)).toBe(false)

    sorter.restore()
    expect(sorter.frontVolumes()).toEqual([])
  })

  it('без сцены (контракт композера) split ничего не делает', () => {
    const sorter = new LensFrontSorter(null, new PerspectiveCamera(), new LensRegistry(), new DepthVolumeRegistry(), isBody)

    expect(() => sorter.split()).not.toThrow()
    expect(sorter.frontObjects()).toEqual([])
  })
})
