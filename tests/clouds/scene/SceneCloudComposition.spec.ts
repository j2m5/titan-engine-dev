import { describe, it, expect, vi } from 'vitest'
import { Color, Mesh, MeshBasicMaterial, Object3D, Texture, Vector2, Vector4, WebGLRenderTarget } from 'three'
import {
  SceneCloudComposition,
  CloudEndpointCapturePass,
  cloudEndpointSchedule
} from '@/core/graphic/clouds/SceneCloudComposition'
import { createSceneEndpointPasses } from '@/core/graphic/sceneEndpointPasses'
import { Scene, PerspectiveCamera } from 'three'
import { AtmosphereRegistry } from '@/core/services/AtmosphereRegistry'
import { DepthVolumeRegistry } from '@/core/services/DepthVolumeRegistry'
import { LensRegistry } from '@/core/services/LensRegistry'
import { LensFrontSorter } from '@/core/graphic/passes/LensFrontSorter'
describe('cloud endpoint composition', () => {
  it('restores camera layers and renderer draw state when a near prefix throws', () => {
    const camera = new PerspectiveCamera(),
      scene = new Scene()
    camera.position.z = 10
    const body = new Object3D()
    body.position.z = 5
    const foreground = new Mesh(undefined, new MeshBasicMaterial({ transparent: true }))
    body.add(foreground)
    const hole = Object.assign(new Object3D(), { bindSceneFrame: () => {}, unbindSceneFrame: () => {} })
    scene.add(body, hole)
    const lenses = new LensRegistry()
    lenses.register({ object: hole, rsUnits: 1, simulationRadiusUnits: 3, background: () => null })
    const lensFront = new LensFrontSorter(scene, camera, lenses, new DepthVolumeRegistry(), (object) => object === body)
    const renderer = {
      debug: { checkShaderErrors: false, onShaderError: undefined },
      autoClear: true,
      shadowMap: { autoUpdate: true },
      capabilities: { maxSamples: 0 },
      extensions: { has: () => false },
      getContext: () => ({ getContextAttributes: () => ({ antialias: false }) }),
      getRenderTarget: () => null,
      getActiveCubeFace: () => 0,
      getActiveMipmapLevel: () => 0,
      getViewport: (value: Vector4) => value.set(0, 0, 4, 4),
      getScissor: (value: Vector4) => value.set(0, 0, 4, 4),
      getScissorTest: () => false,
      getClearColor: (value: Color) => value.set(0),
      getClearAlpha: () => 1,
      getSize: (value: Vector2) => value.set(4, 4),
      setClearColor: () => {},
      setRenderTarget: () => {},
      setViewport: () => {},
      setScissor: () => {},
      setScissorTest: () => {},
      clear: () => {},
      render: () => {}
    }
    const runtime = {
      preparationGeneration: 0,
      prepareVolume: () => true,
      diagnostics: { state: 'prepared' },
      getPreparationMaterialBindings: () => new Map(),
      getEndpointMaterialOwners: () => new Map(),
      recordPasses: () => {},
      useEndpoint: () => {},
      invalidate: vi.fn(),
      renderVolume: () => ({}),
      getEndpointMaterialBindings: () => new Map()
    }
    const target = new WebGLRenderTarget()
    const composition = new SceneCloudComposition(renderer as never, scene, camera, runtime as never, () => ({
      composer: {
        inputBuffer: target,
        setSize: () => {},
        dispose: () => {},
        render: () => {
          lensFront.split()
          expect(foreground.layers.mask).not.toBe(1)
          camera.layers.set(28)
          renderer.shadowMap.autoUpdate = false
          renderer.autoClear = false
          throw Error('overlay render failed')
        }
      } as never,
      atmosphere: { setFrame: () => {}, setCloudOverlay: () => {} } as never,
      lensFront,
      capture: new CloudEndpointCapturePass()
    }))
    const result = composition.prepare(
      { frame: { viewport: new Vector2(4, 4), serial: 1, sceneCamera: camera, deltaSeconds: 0 } } as never,
      {} as never
    )
    expect(result).toBeNull()
    expect(runtime.invalidate).toHaveBeenCalledWith(
      'error',
      expect.objectContaining({ message: 'overlay render failed' }),
      undefined
    )
    expect(camera.layers.mask).toBe(1)
    expect(foreground.layers.mask).toBe(1)
    expect(renderer.shadowMap.autoUpdate).toBe(true)
    expect(renderer.autoClear).toBe(true)
    composition.dispose()
    target.dispose()
    foreground.geometry.dispose()
    foreground.material.dispose()
  })
  it('creates independent mutable passes and atmosphere effects for each complete endpoint', () => {
    const context = {
      scene: new Scene(),
      camera: new PerspectiveCamera(),
      atmosphereRegistry: new AtmosphereRegistry(),
      depthVolumeRegistry: new DepthVolumeRegistry(),
      lensRegistry: new LensRegistry(),
      atmosphereDebugView: 0
    }
    const far = createSceneEndpointPasses(context),
      near = createSceneEndpointPasses(context)
    expect(far.atmosphere).not.toBe(near.atmosphere)
    expect(far.passes.map((pass) => pass.constructor)).toEqual(near.passes.map((pass) => pass.constructor))
    far.passes.forEach((pass, i) => expect(pass).not.toBe(near.passes[i]))
    far.passes.forEach((pass) => pass.dispose())
    near.passes.forEach((pass) => pass.dispose())
  })
  it.each([
    [0, true, false],
    [0.25, true, true],
    [0.5, true, true],
    [0.75, true, true],
    [1, false, true]
  ])('schedules complete endpoints at %s', (weight, far, near) => {
    expect(cloudEndpointSchedule(weight as number)).toEqual({ far, near })
  })
  it('captures the actual last input buffer without copying or swapping', () => {
    const capture = new CloudEndpointCapturePass(),
      input = new WebGLRenderTarget()
    expect(capture.texture).toBeNull()
    capture.render({} as never, input)
    expect(capture.texture).toBe(input.texture)
    expect(capture.needsSwap).toBe(false)
    expect(capture.renderToScreen).toBe(false)
    input.texture = new Texture()
    capture.render({} as never, input)
    expect(capture.texture).toBe(input.texture)
    let disposals = 0
    input.texture.addEventListener('dispose', () => disposals++)
    capture.dispose()
    expect(disposals).toBe(0)
    expect(capture.texture).toBeNull()
  })
})
