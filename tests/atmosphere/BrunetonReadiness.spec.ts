import { describe, it, expect, vi } from 'vitest'
import { Object3D, type WebGLRenderer } from 'three'
import type { Actor } from '@/core/models/Actor'
import { AtmosphereRegistry } from '@/core/services/AtmosphereRegistry'
import { BrunetonAtmosphere } from '@/core/renderables/Atmosphere/BrunetonAtmosphere'
import { EMPTY_LAYER, expLayer, type AtmosphereConfig } from '@/core/renderables/Atmosphere/AtmosphereConfig'

const gpu = vi.hoisted(() => ({ fail: false, disposals: 0 }))
// The external GPU operation is replaced; owner events and registry publication remain real.
vi.mock('@/core/renderables/Atmosphere/AtmosphereLUTGenerator', () => ({
  AtmosphereLUTGenerator: class {
    generate() {
      if (gpu.fail) throw Error('fixture LUT failure')
      return { transmittance: {}, scattering: {}, irradiance: {} }
    }
    dispose() {
      gpu.disposals++
    }
  }
}))

describe('Bruneton LUT readiness owner', () => {
  it('invalidates on context loss and publishes ready only after successful regeneration', () => {
    const config: AtmosphereConfig = {
      solarIrradiance: [1, 1, 1],
      sunAngularRadius: 0.004,
      bottomRadius: 6371,
      topRadius: 6431,
      rayleighDensity: [EMPTY_LAYER, expLayer(8)],
      rayleighScattering: [0.005, 0.01, 0.03],
      mieDensity: [EMPTY_LAYER, expLayer(1.2)],
      mieScattering: [0.004, 0.004, 0.004],
      mieExtinction: [0.005, 0.005, 0.005],
      miePhaseFunctionG: 0.8,
      absorptionDensity: [EMPTY_LAYER, EMPTY_LAYER],
      absorptionExtinction: [0, 0, 0],
      groundAlbedo: [0.1, 0.1, 0.1],
      muSMin: -0.2
    }
    const listeners = new Map<string, () => void>()
    const renderer = {
      domElement: {
        addEventListener: (name: string, callback: () => void) => listeners.set(name, callback),
        removeEventListener: (name: string) => listeners.delete(name)
      }
    } as unknown as WebGLRenderer
    const model = {
      getAttribute: (name: string, fallback: unknown) => (name === 'id' ? 2 : fallback),
      renderingObject: { getAttribute: () => config }
    } as unknown as Actor
    const registry = new AtmosphereRegistry()
    gpu.fail = false
    gpu.disposals = 0
    const owner = new BrunetonAtmosphere(model, renderer, registry)
    try {
      const entry = registry.get(2)!
      const initialLut = entry.lut
      expect(entry.ready).toBe(true)
      const initial = entry.generation
      listeners.get('webglcontextlost')!()
      expect(entry.ready).toBe(false)
      expect(entry.generation).toBeGreaterThan(initial)
      const pending = entry.generation
      gpu.fail = true
      expect(() => listeners.get('webglcontextrestored')!()).toThrow('fixture LUT failure')
      expect(entry.ready).toBe(false)
      expect(entry.generation).toBeGreaterThan(pending)
      const failedGeneration = entry.generation
      gpu.fail = false
      listeners.get('webglcontextrestored')!()
      expect(entry.ready).toBe(true)
      expect(entry.generation).toBeGreaterThan(failedGeneration)
      expect(entry.lut).not.toBe(initialLut)
      const replacement = { ...entry, object: new Object3D() }
      registry.register(replacement)
      const replacementGeneration = replacement.generation
      listeners.get('webglcontextlost')!()
      listeners.get('webglcontextrestored')!()
      expect(replacement.ready).toBe(true)
      expect(replacement.generation).toBe(replacementGeneration)
    } finally {
      gpu.fail = false
      owner.dispose()
    }
    expect(registry.size).toBe(1)
    expect(gpu.disposals).toBe(2) // Failed generator retired, successful retry owned until disposal.
    registry.unregister(2)
    expect(listeners.size).toBe(0)
  })
})
