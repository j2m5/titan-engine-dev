import { DataTexture, FloatType, NoColorSpace, RGBAFormat, SRGBColorSpace, Vector3, type WebGLRenderer } from 'three'
import { AsteroidSurfaceAverages } from '@/core/renderables/DetailedRingStreamingSystem/impostors/AsteroidSurfaceAverages'

describe('средние PBR-карт', () => {
  const renderer = {} as WebGLRenderer
  it('декодирует sRGB до усреднения, ARM оставляет линейной', async () => {
    const diffuse = new DataTexture(new Uint8Array([128, 0, 255, 255, 255, 128, 0, 255, 0, 255, 128, 255]), 3, 1)
    diffuse.colorSpace = SRGBColorSpace
    const arm = new DataTexture(new Uint8Array([128, 255, 0, 255]), 1, 1)
    arm.colorSpace = NoColorSpace
    const averages = new AsteroidSurfaceAverages(renderer)
    const result = await averages.prepare(diffuse, arm)
    result.diffuse.toArray().forEach(n => expect(n).toBeCloseTo((1 + .21586050011389926) / 3, 10))
    expect(result.arm).toEqual(new Vector3(128 / 255, 1, 0))
    averages.clear()
  })

  it('учитывает версию карты и не отдаёт кэш для мутации потребителю', async () => {
    const data = new Float32Array([.2, .4, .8, 1]), diffuse = new DataTexture(data, 1, 1, RGBAFormat, FloatType)
    const averages = new AsteroidSurfaceAverages(renderer)
    const first = await averages.prepare(diffuse, diffuse)
    first.diffuse.set(5, 5, 5)
    expect((await averages.prepare(diffuse, diffuse)).diffuse.x).toBeCloseTo(.2, 7)
    data[0] = .7
    diffuse.needsUpdate = true
    expect((await averages.prepare(diffuse, diffuse)).diffuse.x).toBeCloseTo(.7, 7)
    const dispose = vi.fn()
    diffuse.addEventListener('dispose', dispose)
    averages.clear()
    expect(dispose).not.toHaveBeenCalled()
  })
})
