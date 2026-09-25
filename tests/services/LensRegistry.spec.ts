import { describe, it, expect } from 'vitest'
import { Object3D } from 'three'
import { LensRegistry, LensEntry } from '@/core/services/LensRegistry'

const entry = (): LensEntry => ({ object: new Object3D(), rsUnits: 1, simulationRadiusUnits: 27, background: () => null })

describe('LensRegistry', () => {
  it('регистрирует, отдаёт снимок и снимает; повторная регистрация не дублирует', () => {
    const registry = new LensRegistry()
    const a = entry()
    const b = entry()

    registry.register(a)
    registry.register(a)
    registry.register(b)
    expect(registry.size).toBe(2)
    expect(registry.entries()).toEqual([a, b])

    registry.unregister(a)
    expect(registry.entries()).toEqual([b])
    registry.unregister(a)
    expect(registry.size).toBe(1)
  })
})
