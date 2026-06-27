import { makeNebulaParams, NEBULA_PRESETS } from '@/core/renderables/Nebula/presets'

describe('nebula presets', () => {
  it('exposes the three named presets', () => {
    expect(Object.keys(NEBULA_PRESETS).sort()).toEqual(['dark', 'emission', 'reflection'])
  })

  it('applies a preset then user overrides on top', () => {
    const p = makeNebulaParams('dark', { seed: 77 })
    expect(p.seed).toBe(77)
    // dark preset cranks dust strength above the default 0.6
    expect(p.dust.strength).toBeGreaterThan(0.6)
  })
})
