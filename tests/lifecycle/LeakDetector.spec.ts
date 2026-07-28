import { describe, it, expect } from 'vitest'
import type { WebGLRenderer } from 'three'
import { LeakDetector } from '@/core/lifecycle/LeakDetector'

function rendererWith(geometries: number, textures: number): WebGLRenderer {
  return { info: { memory: { geometries, textures } } } as unknown as WebGLRenderer
}

describe('LeakDetector', () => {
  it('первый снимок задаёт планку и утечкой не считается', () => {
    const detector = new LeakDetector(rendererWith(12, 4))

    expect(detector.record()).toBeNull()
  })

  it('рост над планкой — утечка с дельтой', () => {
    const renderer = rendererWith(12, 4)
    const detector = new LeakDetector(renderer)

    detector.record()
    renderer.info.memory.geometries = 20
    renderer.info.memory.textures = 7

    expect(detector.record()).toEqual({ geometries: 8, textures: 3 })
  })

  it('совпадение с планкой утечкой не считается', () => {
    const detector = new LeakDetector(rendererWith(12, 4))

    detector.record()

    expect(detector.record()).toBeNull()
  })

  it('падение ниже планки утечкой не считается', () => {
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

  it('разовая прибавка сообщается один раз, а не на каждой разборке', () => {
    // Так выглядит ресурс уровня приложения, введённый поздним сценарием:
    // текстура шума чёрной дыры появляется при первом же материале дыры и
    // живёт до конца сессии. Планка обязана подняться на новый уровень,
    // иначе одна законная текстура даёт предупреждение вечно.
    const renderer = rendererWith(12, 4)
    const detector = new LeakDetector(renderer)

    detector.record()
    renderer.info.memory.textures = 5

    expect(detector.record()).toEqual({ geometries: 0, textures: 1 })
    expect(detector.record()).toBeNull()
    expect(detector.record()).toBeNull()
  })

  it('утечка по единице на разборку сообщается каждый раз', () => {
    const renderer = rendererWith(12, 4)
    const detector = new LeakDetector(renderer)

    detector.record()

    renderer.info.memory.textures = 5
    expect(detector.record()).toEqual({ geometries: 0, textures: 1 })

    renderer.info.memory.textures = 6
    expect(detector.record()).toEqual({ geometries: 0, textures: 1 })

    renderer.info.memory.textures = 7
    expect(detector.record()).toEqual({ geometries: 0, textures: 1 })
  })

  it('планка держится по каждому счётчику отдельно', () => {
    // Разборка, в которой геометрий стало меньше, а текстур больше, не должна
    // ронять планку по геометриям: иначе возврат к прежнему числу геометрий
    // на следующей разборке будет объявлен утечкой.
    const renderer = rendererWith(12, 4)
    const detector = new LeakDetector(renderer)

    detector.record()

    renderer.info.memory.geometries = 5
    renderer.info.memory.textures = 6
    expect(detector.record()).toEqual({ geometries: 0, textures: 2 })

    renderer.info.memory.geometries = 12

    expect(detector.record()).toBeNull()
  })

  it('возврат к прежнему уровню после падения приростом не считается', () => {
    const renderer = rendererWith(12, 4)
    const detector = new LeakDetector(renderer)

    detector.record()

    renderer.info.memory.textures = 6
    detector.record()

    renderer.info.memory.textures = 3
    expect(detector.record()).toBeNull()

    renderer.info.memory.textures = 6
    expect(detector.record()).toBeNull()
  })
})
