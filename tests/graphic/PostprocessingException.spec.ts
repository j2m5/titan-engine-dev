import { describe, expect, it, vi } from 'vitest'
import { Mesh, MeshBasicMaterial, Object3D, PerspectiveCamera, Scene, Vector2, type WebGLRenderer } from 'three'
import { Postprocessing } from '@/core/graphic/Postprocessing'
import { DynamicNode } from '@/core/renderables/utils/DynamicNode'
import type { Actor } from '@/core/models/Actor'
import { LensRegistry } from '@/core/services/LensRegistry'
import { DepthVolumeRegistry } from '@/core/services/DepthVolumeRegistry'
import { AtmosphereRegistry } from '@/core/services/AtmosphereRegistry'
import { EffectComposer, type Pass } from 'postprocessing'
import type { LensFrontSorter } from '@/core/graphic/passes/LensFrontSorter'

function rendererFixture(): WebGLRenderer {
  return {
    domElement: document.createElement('canvas'),
    getContext: () => ({ getContextAttributes: () => ({ alpha: true }), isContextLost: () => false }),
    getSize: (size: Vector2) => size.set(4, 4),
    getDrawingBufferSize: (size: Vector2) => size.set(4, 4)
  } as unknown as WebGLRenderer
}

function setup() {
  const scene = new Scene()
  const camera = new PerspectiveCamera()
  camera.position.z = 10
  const actor = {
    orbit: null,
    rotation: null,
    physicalObject: null,
    getAttribute: (_key: string, fallback: unknown) => fallback
  } as unknown as Actor
  const body = new DynamicNode(actor)
  body.position.z = 5
  const object = new Mesh(undefined, new MeshBasicMaterial({ transparent: true }))
  body.add(object)
  const holeBody = new DynamicNode(actor)
  const hole = Object.assign(new Object3D(), { bindSceneFrame: () => {}, unbindSceneFrame: () => {} })
  holeBody.add(hole)
  scene.add(body, holeBody)
  const lenses = new LensRegistry()
  lenses.register({ object: hole, rsUnits: 1, simulationRadiusUnits: 3, background: () => null })
  const pp = new Postprocessing(rendererFixture(), scene, camera, new AtmosphereRegistry(), new DepthVolumeRegistry(), lenses)
  return { pp, object, holeBody }
}

describe('Postprocessing exception cleanup', () => {
  it.each([false, true])('releases populated sorter on dispose and initializes again (composer throws=%s)', (throws) => {
    // Keep the actual composer lifecycle and passes; skip only WebGL initialization.
    const addPass = vi.spyOn(EffectComposer.prototype, 'addPass').mockImplementation(function (this: EffectComposer, pass: Pass) {
      this.passes.push(pass)
    })
    const { pp, object, holeBody } = setup()
    const ownedSorter = () => (pp as unknown as { lensFront: LensFrontSorter | null }).lensFront
    try {
      pp.initialize()
      const oldSorter = ownedSorter()!
      oldSorter.split()
      expect(object.layers.mask).not.toBe(1)
      expect((oldSorter as unknown as { lensBodies: Set<Object3D> }).lensBodies.has(holeBody)).toBe(true)
      const error = new Error('composer dispose')
      const oldComposer = pp.composer!
      if (throws) vi.spyOn(pp.composer!, 'dispose').mockImplementationOnce(() => { throw error })

      if (throws) expect(() => pp.dispose()).toThrow(error)
      else pp.dispose()
      expect(object.layers.mask).toBe(1)
      expect(ownedSorter()).toBeNull()
      // If disposal threw before the composer released its passes, finish that fixture's cleanup.
      if (throws) oldComposer.dispose()
      expect(pp.composer).toBeNull()

      pp.initialize()
      expect(ownedSorter()).not.toBe(oldSorter)
      expect(pp.composer!.passes).toHaveLength(10)
      const nextSorter = ownedSorter()!
      vi.spyOn(pp.composer!, 'render').mockImplementation(() => {
        nextSorter.split()
        expect(object.layers.mask).not.toBe(1)
      })
      pp.render()
      expect(object.layers.mask).toBe(1)
      pp.dispose()
      expect(ownedSorter()).toBeNull()
    } finally {
      addPass.mockRestore()
    }
  })
  it('restores split object layers when composer fails before LensFrontPass and renders the next frame', () => {
    const scene = new Scene()
    const camera = new PerspectiveCamera()
    camera.position.z = 10
    const body = new DynamicNode({
      orbit: null,
      rotation: null,
      physicalObject: null,
      getAttribute: (_key: string, fallback: unknown) => fallback
    } as unknown as Actor)
    body.position.z = 5
    const object = new Mesh(undefined, new MeshBasicMaterial({ transparent: true }))
    body.add(object)
    const hole = Object.assign(new Object3D(), { bindSceneFrame: () => {}, unbindSceneFrame: () => {} })
    scene.add(body, hole)
    const lenses = new LensRegistry()
    lenses.register({ object: hole, rsUnits: 1, simulationRadiusUnits: 3, background: () => null })
    const pp = new Postprocessing(rendererFixture(), scene, camera, new AtmosphereRegistry(), new DepthVolumeRegistry(), lenses)
    const passes = pp.buildPasses()
    const error = new Error('earlier composer pass')
    let fail = true
    let frames = 0
    pp.composer = {
      render: vi.fn(() => {
        passes[0].render(null as never, null, null)
        expect(object.layers.mask).not.toBe(1)
        if (fail) throw error
        ++frames
      })
    } as never

    expect(() => pp.render()).toThrow(error)
    expect(object.layers.mask).toBe(1)
    fail = false
    pp.render()
    expect(frames).toBe(1)
    expect(object.layers.mask).toBe(1)
    for (const pass of passes) pass.dispose()
    object.geometry.dispose()
    object.material.dispose()
    body.orbit.geometry.dispose()
    body.orbit.material.dispose()
  })
})
