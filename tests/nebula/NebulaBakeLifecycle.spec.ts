import { Color, PerspectiveCamera, Vector2, type WebGLRenderer } from 'three'
import { Nebula } from '@/core/renderables/Nebula'
import { NebulaBakeQueue } from '@/core/renderables/Nebula/volume/NebulaBakeQueue'
import { NebulaVolume } from '@/core/renderables/Nebula/volume/NebulaVolume'

function setup(maxTextureBytes = 64 * 1024 ** 2) {
  const canvas = new EventTarget()
  const render = vi.fn()
  const renderer = {
    domElement: canvas, render,
    getSize: (v: Vector2) => v.set(1024, 1024),
    getRenderTarget: () => null, getActiveCubeFace: () => 0, getActiveMipmapLevel: () => 0,
    setRenderTarget: vi.fn(), getClearColor: (c: Color) => c.set(0), getClearAlpha: () => 1,
    setClearColor: vi.fn(), clear: vi.fn()
  } as unknown as WebGLRenderer
  const queue = new NebulaBakeQueue({ maxStepsPerFrame: 4, maxCpuMs: Infinity, maxTextureBytes })
  const camera = new PerspectiveCamera(50, 1, 0.01, 1e9)
  camera.position.z = 1e6
  const create = () => new Nebula(renderer, { size: 1, quality: { bakeResolution: 64 } }, null, queue)
  const volumeOf = (nebula: Nebula) => nebula.children.find(c => c instanceof NebulaVolume) as NebulaVolume
  const frame = (nebula: Nebula) => { nebula.updateView(camera); queue.pumpFrame() }
  return { canvas, render, queue, camera, create, volumeOf, frame }
}

describe('Nebula bake lifecycle', () => {
  it('keeps the live fallback after an initial bake failure and prepares the other nebula', async () => {
    const { create, volumeOf, render, queue } = setup()
    const first = create(), second = create()
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    try {
      render.mockImplementationOnce(() => { throw new Error('initial density failure') })
      await expect(queue.prepareInitial()).resolves.toBeUndefined()
      expect(volumeOf(first).visible).toBe(true)
      expect(volumeOf(first).material.uniforms.uDensityReady.value).toBe(0)
      expect(volumeOf(first).material.uniforms.uLodBlend.value).toBe(1)
      expect(volumeOf(second).material.uniforms.uDensityReady.value).toBe(1)
      expect(queue.pendingCount).toBe(0)
      expect(error).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({ message: 'initial density failure' }))
    } finally { first.dispose(); second.dispose(); error.mockRestore() }
  })

  it('submits no constructor work and publishes only complete density and impostor generations', () => {
    const { create, volumeOf, frame, render, queue } = setup()
    const nebula = create()
    const material = volumeOf(nebula).material, u = material.uniforms, initialVersion = material.version
    try {
      expect(render).not.toHaveBeenCalled()
      expect(u.uDensityReady.value).toBe(0)
      for (let i = 0; i < 15; i++) frame(nebula)
      expect(render).toHaveBeenCalledTimes(60)
      expect(u.uDensityReady.value).toBe(0)
      expect(u.uLodBlend.value).toBe(1)
      expect(material.version).toBe(initialVersion)
      frame(nebula)
      expect(u.uDensityReady.value).toBe(1)
      expect(material.version).toBe(initialVersion + 1)
      expect(u.uDensityTex.value).not.toBeNull()
      for (let i = 0; i < 3; i++) frame(nebula)
      expect(u.uLodBlend.value).toBe(1)
      frame(nebula)
      expect(u.uLodBlend.value).toBe(0)
      expect(u.uImpostorMap.value).not.toBeNull()
      expect(queue.pendingCount).toBe(0)
    } finally { nebula.dispose() }
    expect(queue.allocatedBytes).toBe(0)
  })

  it('shares the per-frame and memory limits, then admits a waiting nebula after disposal', () => {
    const bytes = 64 ** 3 * 2 + 2 * 512 ** 2 * 8
    const { create, volumeOf, frame, render, queue } = setup(bytes)
    const first = create()
    const second = create()
    try {
      frame(second)
      expect(render).toHaveBeenCalledTimes(4)
      expect(queue.allocatedBytes).toBe(bytes)
      expect(volumeOf(second).material.uniforms.uDensityReady.value).toBe(0)
      first.dispose()
      expect(queue.pendingCount).toBe(0)
      frame(second)
      expect(render).toHaveBeenCalledTimes(8)
      expect(queue.allocatedBytes).toBe(bytes)
      for (let i = 0; i < 19; i++) frame(second)
      expect(volumeOf(second).material.uniforms.uLodBlend.value).toBe(0)
    } finally { first.dispose(); second.dispose() }
    expect(queue.allocatedBytes).toBe(0)
    expect(queue.pendingCount).toBe(0)
  })

  it('restoration cancels partial work, falls back to live rendering and obeys the same budget', () => {
    const { create, volumeOf, frame, canvas, render, queue } = setup()
    const nebula = create()
    const material = volumeOf(nebula).material, u = material.uniforms
    try {
      for (let i = 0; i < 20; i++) frame(nebula)
      expect(u.uLodBlend.value).toBe(0)
      const readyVersion = material.version
      render.mockClear()
      canvas.dispatchEvent(new Event('webglcontextrestored'))
      expect(render).not.toHaveBeenCalled()
      expect(u.uDensityReady.value).toBe(0)
      expect(u.uLodBlend.value).toBe(1)
      expect(material.version).toBe(readyVersion + 1)
      for (let i = 0; i < 19; i++) frame(nebula)
      expect(u.uLodBlend.value).toBe(1)
      frame(nebula)
      expect(u.uLodBlend.value).toBe(0)
      expect(render).toHaveBeenCalledTimes(80)
      expect(material.version).toBe(readyVersion + 2)
    } finally { nebula.dispose() }
    canvas.dispatchEvent(new Event('webglcontextrestored'))
    queue.pumpFrame()
    expect(render).toHaveBeenCalledTimes(80)
  })

  it('a failed job releases its reservation and leaves a visible live fallback without retrying every frame', () => {
    const { create, volumeOf, frame, render, queue } = setup()
    const nebula = create()
    try {
      render.mockImplementationOnce(() => { throw new Error('GPU failure') })
      expect(() => frame(nebula)).toThrow('GPU failure')
      expect(queue.pendingCount).toBe(0)
      expect(queue.allocatedBytes).toBe(0)
      expect(volumeOf(nebula).visible).toBe(true)
      expect(volumeOf(nebula).material.uniforms.uLodBlend.value).toBe(1)
      frame(nebula)
      expect(render).toHaveBeenCalledTimes(1)
    } finally { nebula.dispose() }
  })

  it('returns to the procedural program when impostor baking fails after density is ready', () => {
    const { create, volumeOf, frame, render, queue } = setup()
    const nebula = create(), material = volumeOf(nebula).material
    try {
      for (let i = 0; i < 16; i++) frame(nebula)
      expect(material.uniforms.uDensityReady.value).toBe(1)
      const readyVersion = material.version
      render.mockImplementationOnce(() => { throw new Error('Impostor GPU failure') })
      expect(() => frame(nebula)).toThrow('Impostor GPU failure')
      expect(material.version).toBe(readyVersion + 1)
      expect(material.uniforms.uDensityReady.value).toBe(0)
      expect(material.uniforms.uDensityTex.value).toBeNull()
      expect(material.uniforms.uLodBlend.value).toBe(1)
      expect(queue.pendingCount).toBe(0)
      expect(queue.allocatedBytes).toBe(0)
    } finally { nebula.dispose() }
  })

  it.each([5, 18])('abandons an incomplete generation on context restore (after %s frames)', (frames) => {
    const { create, volumeOf, frame, canvas, render, queue } = setup()
    const nebula = create()
    try {
      for (let i = 0; i < frames; i++) frame(nebula)
      expect(queue.pendingCount).toBe(1)
      render.mockClear()
      canvas.dispatchEvent(new Event('webglcontextrestored'))
      expect(render).not.toHaveBeenCalled()
      const u = volumeOf(nebula).material.uniforms
      expect(u.uDensityReady.value).toBe(0)
      expect(u.uLodBlend.value).toBe(1)
      for (let i = 0; i < 20; i++) frame(nebula)
      expect(render).toHaveBeenCalledTimes(80)
      expect(u.uLodBlend.value).toBe(0)
      expect(queue.pendingCount).toBe(0)
    } finally { nebula.dispose() }
    expect(queue.allocatedBytes).toBe(0)
  })
})
