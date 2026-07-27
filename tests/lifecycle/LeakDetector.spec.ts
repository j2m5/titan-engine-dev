import { describe, it, expect } from 'vitest'
import type { WebGLRenderer } from 'three'
import { LeakDetector } from '@/core/lifecycle/LeakDetector'

function rendererWith(geometries: number, textures: number): WebGLRenderer {
  return { info: { memory: { geometries, textures } } } as unknown as WebGLRenderer
}

describe('LeakDetector', () => {
  it('первый снимок становится эталоном и утечкой не считается', () => {
    const detector = new LeakDetector(rendererWith(12, 4))

    expect(detector.record()).toBeNull()
  })

  it('рост относительно эталона — утечка с дельтой', () => {
    const renderer = rendererWith(12, 4)
    const detector = new LeakDetector(renderer)

    detector.record()
    renderer.info.memory.geometries = 20
    renderer.info.memory.textures = 7

    expect(detector.record()).toEqual({ geometries: 8, textures: 3 })
  })

  it('совпадение с эталоном утечкой не считается', () => {
    const detector = new LeakDetector(rendererWith(12, 4))

    detector.record()

    expect(detector.record()).toBeNull()
  })

  it('падение ниже эталона утечкой не считается', () => {
    const renderer = rendererWith(12, 4)
    const detector = new LeakDetector(renderer)

    detector.record()
    renderer.info.memory.geometries = 5

    expect(detector.record()).toBeNull()
  })

  it('рост только по текстурам тоже утечка', () => {
    const renderer = rendererWith(12, 4)
    const detector = new LeakDetector(renderer)

    detector.record()
    renderer.info.memory.textures = 5

    expect(detector.record()).toEqual({ geometries: 0, textures: 1 })
  })
})
