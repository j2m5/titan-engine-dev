import { Color, Object3D, PerspectiveCamera, Vector3, WebGLRenderer, WebGLRenderTarget } from 'three'
import { DEFAULT_NEBULA_PARAMS } from '@/core/renderables/Nebula/NebulaParams'
import { NebulaDensityBaker } from '@/core/renderables/Nebula/volume/NebulaDensityBaker'
import { ImpostorBaker } from '@/core/renderables/Nebula/volume/ImpostorBaker'

function rendererFixture() {
  const original = new WebGLRenderTarget(1, 1)
  let target = original, layer = 2, mip = 3, alpha = 0.7
  const color = new Color(0xabcdef)
  const draws: { target: WebGLRenderTarget; layer: number; x: number; y: number; width: number; worldX: number; cameraX: number }[] = []
  let fail = false
  const renderer = {
    getRenderTarget: () => target,
    getActiveCubeFace: () => layer,
    getActiveMipmapLevel: () => mip,
    setRenderTarget: (next: WebGLRenderTarget, nextLayer = 0, nextMip = 0) => { target = next; layer = nextLayer; mip = nextMip },
    getClearColor: (out: Color) => out.copy(color),
    getClearAlpha: () => alpha,
    setClearColor: (next: Color | number, nextAlpha: number) => { color.set(next); alpha = nextAlpha },
    clear: () => {},
    render: (object: Object3D, camera: PerspectiveCamera) => {
      object.updateMatrixWorld()
      draws.push({ target, layer, x: target.scissor.x, y: target.scissor.y, width: target.scissor.z,
        worldX: object.matrixWorld.elements[12], cameraX: camera.position.x })
      if (fail) throw new Error('GPU failed')
    }
  } as unknown as WebGLRenderer
  return { renderer, draws, fail: () => { fail = true }, restored: () => target === original && layer === 2 && mip === 3 && alpha === 0.7 && color.getHex() === 0xabcdef }
}

describe('incremental nebula bakers', () => {
  it('submits one density layer per step, restarts and stops when complete', () => {
    const f = rendererFixture()
    const baker = new NebulaDensityBaker(f.renderer, 3)
    baker.start(DEFAULT_NEBULA_PARAMS)
    expect(f.draws).toHaveLength(0)
    expect(baker.step()).toBe(false)
    expect(f.draws.map(draw => draw.layer)).toEqual([0])
    baker.start(DEFAULT_NEBULA_PARAMS)
    expect(baker.step(3)).toBe(true)
    expect(baker.step()).toBe(true)
    expect(f.draws.map(draw => draw.layer)).toEqual([0, 0, 1, 2])
    expect(f.restored()).toBe(true)
    baker.dispose()
  })

  it('publishes tiled impostors and orientation only after the final tile', () => {
    const f = rendererFixture()
    const baker = new ImpostorBaker(f.renderer, 256)
    const volume = new Object3D(), camera = new PerspectiveCamera()
    camera.position.z = 10
    baker.bake(volume, camera, new Vector3(), 1)
    const previous = baker.texture, orientation = baker.orientation.clone()
    camera.position.set(10, 0, 0)
    baker.begin(volume, camera, new Vector3(), 1)
    expect(baker.pending).toBe(true)
    expect(baker.texture).toBe(previous)
    expect(baker.orientation.equals(orientation)).toBe(true)
    expect(baker.step()).toBe(false)
    expect(baker.step()).toBe(false)
    expect(baker.step()).toBe(false)
    expect(baker.texture).toBe(previous)
    expect(baker.step()).toBe(true)
    expect(baker.pending).toBe(false)
    expect(baker.texture).not.toBe(previous)
    expect(baker.orientation.equals(orientation)).toBe(false)
    expect(f.draws.slice(1).map(draw => [draw.x, draw.y, draw.width])).toEqual([[0, 0, 128], [128, 0, 128], [0, 128, 128], [128, 128, 128]])
    expect(baker.step()).toBe(true)
    expect(f.draws).toHaveLength(5)
    expect(f.restored()).toBe(true)
    baker.dispose()
  })

  it('snapshots transforms across frames and restores the current object state', () => {
    const f = rendererFixture()
    const baker = new ImpostorBaker(f.renderer, 256)
    const volume = new Object3D(), camera = new PerspectiveCamera()
    volume.position.x = 4
    camera.position.set(0, 0, 10)
    baker.begin(volume, camera, new Vector3(), 1)
    volume.position.x = 99
    volume.updateMatrixWorld()
    camera.position.x = 50
    baker.step(); baker.step()
    expect(f.draws.map(draw => draw.worldX)).toEqual([4, 4])
    expect(f.draws.map(draw => draw.cameraX)).toEqual([0, 0])
    expect(volume.matrixWorld.elements[12]).toBe(99)
    expect(volume.matrixWorldAutoUpdate).toBe(true)
    baker.invalidate()
    expect(baker.pending).toBe(false)
    expect(baker.shouldRebake(new Vector3(), new Vector3(0, 0, 10), 1)).toBe(true)
    expect(baker.step()).toBe(true)
    expect(f.draws).toHaveLength(2)
    baker.dispose()
  })

  it('restores renderer and volume state and abandons a throwing tile', () => {
    const f = rendererFixture()
    const baker = new ImpostorBaker(f.renderer, 256)
    const volume = new Object3D(), camera = new PerspectiveCamera()
    baker.begin(volume, camera, new Vector3(), 1)
    f.fail()
    expect(() => baker.step()).toThrow('GPU failed')
    expect(baker.pending).toBe(false)
    expect(volume.matrixWorldAutoUpdate).toBe(true)
    expect(f.restored()).toBe(true)
    expect(baker.step()).toBe(true)
    baker.dispose()
  })

  it('restores the layered render target and stops a failed density generation', () => {
    const f = rendererFixture()
    const baker = new NebulaDensityBaker(f.renderer, 3)
    baker.start(DEFAULT_NEBULA_PARAMS)
    f.fail()
    expect(() => baker.step()).toThrow('GPU failed')
    expect(f.restored()).toBe(true)
    expect(baker.step()).toBe(true)
    expect(f.draws).toHaveLength(1)
    baker.dispose()
  })

  it('clips edge tiles to a small target and disposes both buffers while pending', () => {
    const f = rendererFixture()
    const baker = new ImpostorBaker(f.renderer, 150)
    const volume = new Object3D(), camera = new PerspectiveCamera()
    baker.bake(volume, camera, new Vector3(), 1)
    const first = f.draws[0].target
    baker.begin(volume, camera, new Vector3(), 1)
    expect(baker.step()).toBe(false)
    expect(baker.step()).toBe(false)
    expect(f.draws[2].width).toBe(22)
    const second = f.draws[1].target
    let disposed = 0
    first.addEventListener('dispose', () => { disposed++ })
    second.addEventListener('dispose', () => { disposed++ })
    baker.dispose()
    expect(disposed).toBe(2)
    expect(baker.pending).toBe(false)
    expect(baker.step()).toBe(true)
    expect(f.draws).toHaveLength(3)
  })
})
