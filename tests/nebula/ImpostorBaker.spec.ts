import { vi } from 'vitest'
import { Camera, Object3D, PerspectiveCamera, Vector3, WebGLRenderer } from 'three'
import { ImpostorBaker } from '@/core/renderables/Nebula/volume/ImpostorBaker'
import { DEPTH_VOLUME_LAYER } from '@/core/graphic/passes/DepthVolume'

describe('ImpostorBaker', () => {
  it('камера запекания видит слой объёмов DepthVolumePass', () => {
    // Объём туманности лежит на слое пасса, который камера по умолчанию не видит;
    // запекание рендерит объём своей камерой вне пасса и обязано включить слой
    const render = vi.fn()
    const renderer = {
      getRenderTarget: () => null,
      setRenderTarget: () => {},
      getClearAlpha: () => 1,
      setClearAlpha: () => {},
      clear: () => {},
      render
    } as unknown as WebGLRenderer
    const volume = new Object3D()
    volume.layers.set(DEPTH_VOLUME_LAYER)

    const baker = new ImpostorBaker(renderer, 64)
    baker.bake(volume, new PerspectiveCamera(), new Vector3(), 10)

    expect(render).toHaveBeenCalledTimes(1)
    const bakeCamera = render.mock.calls[0][1] as Camera
    expect(bakeCamera.layers.test(volume.layers)).toBe(true)
  })
})
