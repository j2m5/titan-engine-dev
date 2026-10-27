import { describe, expect, it, vi } from 'vitest'
import { Material, Mesh, Object3D, PerspectiveCamera, PlaneGeometry, ShaderMaterial, Texture, Vector2, WebGLRenderTarget, type Scene, type WebGLRenderer } from 'three'
import { DEPTH_VOLUME_LAYER, type DepthVolume } from '@/core/graphic/passes/DepthVolume'
import { drawDepthVolumes } from '@/core/graphic/passes/DepthVolumePass'
import type { DepthVolumeResolutionRenderer } from '@/core/graphic/passes/DepthVolumeResolutionRenderer'

function fixture() {
  const events: string[] = []
  const bound = new Set<string>()
  const camera = new PerspectiveCamera()
  camera.layers.mask = 0x25
  const parent = new Object3D()
  parent.position.set(10, 20, 30)
  const volumes = ['a', 'b', 'c'].map(name => {
    const volume = Object.assign(new Mesh(new PlaneGeometry(), new ShaderMaterial({ transparent: true, depthTest: false, depthWrite: false })), {
      supportsDepthVolumeBatch: true,
      bindSceneDepth: vi.fn(() => { bound.add(name); events.push(`bind:${name}`) }),
      unbindSceneDepth: vi.fn(() => { bound.delete(name); events.push(`unbind:${name}`) })
    })
    volume.name = name
    volume.layers.set(DEPTH_VOLUME_LAYER)
    volume.frustumCulled = false
    volume.position.x = name.charCodeAt(0)
    volume.renderOrder = -volume.position.x
    volume.onBeforeRender = function (_renderer, scene) {
      expect(this).toBe(volume)
      expect(scene).toBe(volume)
      expect([...bound]).toEqual([name])
      events.push(`before:${name}`)
    }
    volume.onAfterRender = function (_renderer, scene) {
      expect(this).toBe(volume)
      expect(scene).toBe(volume)
      expect([...bound]).toEqual([name])
      events.push(`after:${name}`)
    }
    parent.add(volume)
    return volume
  })
  parent.updateMatrixWorld()
  const calls: string[][] = []
  const renderer = {
    autoClear: false,
    sortObjects: true,
    shadowMap: { autoUpdate: true },
    xr: { isPresenting: false },
    setRenderTarget: vi.fn(),
    render: vi.fn((root: Object3D) => {
      if (root.matrixWorldAutoUpdate) root.updateMatrixWorld()
      const meshes: typeof volumes = []
      root.traverse(object => { if (object instanceof Mesh && object.visible && object.layers.test(camera.layers)) meshes.push(object as typeof volumes[number]) })
      // Three's real transparent sorting is covered by the GPU overlap fixture.
      calls.push(meshes.map(mesh => mesh.name))
      for (const mesh of meshes) {
        mesh.onBeforeRender(renderer, root as Scene, camera, mesh.geometry, mesh.material, null as never)
        events.push(`draw:${mesh.name}`)
        onDraw(mesh)
        mesh.onAfterRender(renderer, root as Scene, camera, mesh.geometry, mesh.material, null as never)
      }
    })
  } as unknown as WebGLRenderer
  let onDraw = (_volume: DepthVolume) => {}
  const target = new WebGLRenderTarget(8, 8, { samples: 4 })
  const draw = (selected: DepthVolume[] = volumes, output: WebGLRenderTarget | null = target, scaled?: DepthVolumeResolutionRenderer) =>
    drawDepthVolumes(renderer, output, camera, selected, new Texture(), new Vector2(8, 8), scaled)
  return { volumes, parent, renderer, camera, target, draw, calls, events, bound, setOnDraw: (fn: typeof onDraw) => { onDraw = fn } }
}

describe('depth volume MSAA batches', () => {
  it.each([true, false])('draws three eligible volumes in order with one resolve boundary (sortObjects=%s)', sortObjects => {
    const f = fixture()
    f.renderer.sortObjects = sortObjects
    const matrices = f.volumes.map(v => v.matrixWorld.clone())
    const handlers = f.volumes.map(v => [v.onBeforeRender, v.onAfterRender])
    f.draw()
    expect(f.calls).toEqual([['a', 'b', 'c']])
    expect(f.events).toEqual(['a', 'b', 'c'].flatMap(name => ['bind', 'before', 'draw', 'after', 'unbind'].map(event => `${event}:${name}`)))
    expect(f.parent.children).toEqual(f.volumes)
    for (const [i, volume] of f.volumes.entries()) {
      expect(volume.parent).toBe(f.parent)
      expect(volume.matrixWorld).toEqual(matrices[i])
      expect([volume.onBeforeRender, volume.onAfterRender]).toEqual(handlers[i])
    }
    expect(f.renderer.sortObjects).toBe(sortObjects)
    expect(f.renderer.shadowMap.autoUpdate).toBe(true)
    expect(f.camera.layers.mask).toBe(0x25)
    expect(f.bound.size).toBe(0)
  })

  it.each(['bind', 'before', 'draw', 'after', 'unbind'])('restores all state after %s fails and leaves later volumes untouched', phase => {
    const f = fixture()
    const first = f.volumes[0]
    const error = new Error(`failed ${phase}`)
    const fail = () => { throw error }
    if (phase === 'bind') first.bindSceneDepth.mockImplementation(() => { f.bound.add('a'); fail() })
    if (phase === 'before') first.onBeforeRender = fail
    if (phase === 'draw') f.setOnDraw(fail)
    if (phase === 'after') first.onAfterRender = fail
    if (phase === 'unbind') first.unbindSceneDepth.mockImplementation(() => { f.bound.delete('a'); fail() })
    const descriptors = f.volumes.map(v => Object.getOwnPropertyDescriptors(v))
    expect(() => f.draw()).toThrow(error)
    expect(first.unbindSceneDepth).toHaveBeenCalledOnce()
    for (const volume of f.volumes.slice(1)) {
      expect(volume.bindSceneDepth).not.toHaveBeenCalled()
      expect(volume.unbindSceneDepth).not.toHaveBeenCalled()
    }
    for (const [i, volume] of f.volumes.entries()) {
      expect(Object.getOwnPropertyDescriptor(volume, 'onBeforeRender')).toEqual(descriptors[i].onBeforeRender)
      expect(Object.getOwnPropertyDescriptor(volume, 'onAfterRender')).toEqual(descriptors[i].onAfterRender)
      expect(volume.parent).toBe(f.parent)
    }
    expect(f.bound.size).toBe(0)
    expect(f.renderer.sortObjects).toBe(true)
    expect(f.renderer.shadowMap.autoUpdate).toBe(true)
    expect(f.camera.layers.mask).toBe(0x25)
    first.bindSceneDepth.mockImplementation(() => { f.bound.add('a') })
    first.unbindSceneDepth.mockImplementation(() => { f.bound.delete('a') })
    first.onBeforeRender = Object3D.prototype.onBeforeRender
    first.onAfterRender = Object3D.prototype.onAfterRender
    f.setOnDraw(() => {})
    f.draw()
    expect(f.bound.size).toBe(0)
  })

  it('restores inherited callbacks without creating own properties', () => {
    const f = fixture()
    for (const volume of f.volumes) {
      Reflect.deleteProperty(volume, 'onBeforeRender')
      Reflect.deleteProperty(volume, 'onAfterRender')
    }
    f.draw()
    expect(f.calls).toEqual([['a', 'b', 'c']])
    for (const volume of f.volumes) {
      expect(Object.hasOwn(volume, 'onBeforeRender')).toBe(false)
      expect(Object.hasOwn(volume, 'onAfterRender')).toBe(false)
    }
  })

  it.each(['screen', 'no MSAA', 'auto clear', 'XR'])('keeps individual renders for %s', mode => {
    const f = fixture()
    if (mode === 'no MSAA') f.target.samples = 0
    if (mode === 'auto clear') f.renderer.autoClear = true
    if (mode === 'XR') Object.assign(f.renderer.xr, { isPresenting: true })
    f.draw(f.volumes, mode === 'screen' ? null : f.target)
    expect(f.calls).toEqual([['a'], ['b'], ['c']])
  })

  it.each(['opt out', 'children', 'opaque', 'depth test', 'depth write', 'culling', 'material callback', 'scaled', 'temporal'])('treats %s as a batch barrier', mode => {
    const f = fixture()
    const middle = f.volumes[1]
    if (mode === 'opt out') middle.supportsDepthVolumeBatch = false
    if (mode === 'children') middle.add(new Object3D())
    if (mode === 'opaque') middle.material.transparent = false
    if (mode === 'depth test') middle.material.depthTest = true
    if (mode === 'depth write') middle.material.depthWrite = true
    if (mode === 'culling') middle.frustumCulled = true
    if (mode === 'material callback') middle.material.onBeforeRender = () => {}
    if (mode === 'scaled' || mode === 'temporal') Object.assign(middle, {
      resolutionScale: mode === 'scaled' ? 0.5 : 1,
      temporalBlend: mode === 'temporal' ? 0.5 : 0,
      temporalRevision: 0,
      bindLowResolution() {}, unbindLowResolution() {}, bindTemporalCapture() {}, unbindTemporalCapture() {}
    })
    f.draw()
    expect(f.calls).toEqual([['a'], ['b'], ['c']])
    expect(middle.material.onBeforeRender === Material.prototype.onBeforeRender).toBe(mode !== 'material callback')
  })

  it('starts a fresh batch at a repeated material so each draw refreshes uniforms', () => {
    const f = fixture()
    f.volumes[1].material = f.volumes[0].material
    f.draw()
    expect(f.calls).toEqual([['a'], ['b', 'c']])
  })

  it('dispatches scaled volumes through the resolution renderer between eligible runs', () => {
    const f = fixture()
    const barrier = Object.assign(new Object3D(), { bindSceneDepth: vi.fn(), unbindSceneDepth: vi.fn() })
    const scaled = { prepare: vi.fn(), render: vi.fn((_renderer, _target, _camera, volume) => f.renderer.render(volume, f.camera)) }
    f.draw([f.volumes[0], f.volumes[1], barrier, f.volumes[2]], f.target, scaled as unknown as DepthVolumeResolutionRenderer)
    expect(f.calls).toEqual([['a', 'b'], [], ['c']])
    expect(scaled.render.mock.calls.map(args => args[3])).toEqual([barrier, f.volumes[2]])
  })
})
