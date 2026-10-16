import { describe, expect, it, vi } from 'vitest'
import { DataTexture, SRGBColorSpace } from 'three'
import { createEarthCloudProfile } from '@/core/clouds/profiles/earthCloudProfile'
import { createJupiterCloudProfile } from '@/core/clouds/profiles/jupiterCloudProfile'
import { prepareCloudSource } from '@/core/clouds/appearance/prepareCloudSource'
import { prepareCloudSourceAsync } from '@/core/clouds/appearance/prepareCloudSourceAsync'
import { createCloudReduction } from '@/core/clouds/appearance/cloudPreparationSteps'

describe('resumable cloud preparation', () => {
  it('integrates fractional source pixel weights without quantizing before reduction', () => {
    const job = createCloudReduction(7, 1, 3, 1, (i) => [i / 4 >= 3 ? 1 : 0], 1)
    while (!job.step(1)) {
      /* advance one bounded source sample */
    }
    expect([job.output[0], job.output[4], job.output[8]]).toEqual([0, 182, 255])
  })
  it.each([false, true])('matches canonical asymmetric nonlinear scalar/RGB preparation, flipY=%s', async (flipY) => {
    const bytes = Uint8Array.from({ length: 7 * 5 * 4 }, (_, i) => (i * 37) % 256)
    const source = new DataTexture(bytes, 7, 5)
    source.flipY = flipY
    source.colorSpace = SRGBColorSpace
    const color = new DataTexture(new Uint8Array([255, 0, 64, 255]), 1, 1)
    const dispose = vi.spyOn(source, 'dispose')
    const version = [source.version, source.source.version]
    for (const config of [createEarthCloudProfile(), createJupiterCloudProfile()]) {
      config.layers[0].color = { kind: 'map', map: { resourceId: 99 }, strength: 0.7 }
      const resolver = (id: number) => (id === 99 ? color : source)
      const sync = prepareCloudSource(config, resolver)
      let yields = 0
      const async = await prepareCloudSourceAsync(config, resolver, {
        yield: async () => {
          yields++
        },
        budgetMs: 0
      })
      expect(async.config).toEqual(sync.config)
      expect(async.textures.weather.image.data).toEqual(sync.textures.weather.image.data)
      expect(async.textures.color!.source).not.toBe(color.source)
      expect(async.textures.color!.image.data).toBe(color.image.data)
      expect(async.textures.colorStrength).toBe(0.7)
      expect(yields).toBeGreaterThan(1)
      for (const key of ['flipY', 'wrapS', 'wrapT', 'minFilter', 'magFilter', 'colorSpace', 'generateMipmaps'] as const)
        expect(async.textures.weather[key]).toEqual(sync.textures.weather[key])
      async.dispose()
      async.dispose()
      sync.dispose()
    }
    expect([source.version, source.source.version]).toEqual(version)
    expect(dispose).not.toHaveBeenCalled()
  })
  it('preserves exact decoded sample order across slices inside one fractional output pixel', () => {
    const step = createCloudReduction(300, 3, 1, 1, (i) => [i % 8 ? 1 : 0], 1)
    expect(step.step(1)).toBe(false)
    while (!step.step(7)) {
      /* bounded source sample work */
    }
    expect(step.output[0]).toBe(128)
  })
  it('rejects promptly on cancellation during a yield and leaves borrowed textures intact', async () => {
    const source = new DataTexture(new Uint8Array(1024 * 4), 1024, 1)
    const dispose = vi.spyOn(source, 'dispose')
    const control = new AbortController()
    await expect(
      prepareCloudSourceAsync(createEarthCloudProfile(), () => source, {
        signal: control.signal,
        yield: async () => {
          control.abort()
        },
        budgetMs: 0
      })
    ).rejects.toMatchObject({ name: 'AbortError' })
    expect(dispose).not.toHaveBeenCalled()
  })
  it('captures independent color resources before the first yield', async () => {
    const source = new DataTexture(new Uint8Array([64, 64, 64, 255]), 1, 1)
    const color = new DataTexture(new Uint8Array([255, 0, 0, 255]), 1, 1)
    const config = createEarthCloudProfile()
    config.layers[0].color = { kind: 'map', map: { resourceId: 37 }, strength: 1 }
    let captured = true
    const result = await prepareCloudSourceAsync(
      config,
      (id) => {
        expect(captured).toBe(true)
        return id === 37 ? color : source
      },
      {
        yield: async () => {
          captured = false
        }
      }
    )
    expect((result.textures.weather.image.data as Uint8Array)[0]).toBe(128)
    result.dispose()
  })
})
