import { describe, it, expect, vi, beforeEach } from 'vitest'
import { Kernel } from '@/core/framework/container/Kernel'
import { Container } from '@/core/framework/container/Container'
import { RenderingServiceProvider } from '@/core/providers/RenderingServiceProvider'
import { Tokens } from '@/core/providers/tokens'
import { config } from '@/core/framework/config'
import { createTestContainer } from '../helpers/createTestContainer'

/**
 * Привязки рендер-слоя ленивые, поэтому get() по-настоящему зовёт фабрику,
 * а WebGL-контекста в jsdom нет. Поэтому подменяется модуль фабрик: каждая
 * возвращает уникальный сентинел. Проверка идентичности остаётся несущей —
 * если две привязки в провайдере перепутать местами, токен вернёт чужой
 * сентинел и тест упадёт.
 */
const mocks = vi.hoisted(() => {
  const fakes = {
    renderer: { tag: 'renderer' },
    labelRenderer: { tag: 'labelRenderer' },
    scene: { tag: 'scene' },
    camera: { tag: 'camera' },
    astroControls: { tag: 'astroControls' },
    clock: { tag: 'clock' }
  }

  return {
    fakes,
    createRenderer: vi.fn(() => fakes.renderer),
    createLabelRenderer: vi.fn(() => fakes.labelRenderer),
    createScene: vi.fn(() => fakes.scene),
    createCamera: vi.fn(() => fakes.camera),
    createAstroControls: vi.fn(() => fakes.astroControls),
    createClock: vi.fn(() => fakes.clock)
  }
})

vi.mock('@/core/graphic/renderingFactories', () => ({
  createRenderer: mocks.createRenderer,
  createLabelRenderer: mocks.createLabelRenderer,
  createScene: mocks.createScene,
  createCamera: mocks.createCamera,
  createAstroControls: mocks.createAstroControls,
  createClock: mocks.createClock
}))

describe('RenderingServiceProvider — проводка рендер-токенов', () => {
  // Счётчики вызовов — часть утверждений («фабрика не звалась», «звалась с тем-то»),
  // поэтому их обязательно сбрасывать: иначе тест проходил бы за счёт вызова,
  // сделанного предыдущим тестом. Глобального clearMocks в конфиге нет.
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('регистрация не создаёт объекты — bootstrap не зовёт ни одной фабрики', () => {
    new Kernel([RenderingServiceProvider]).bootstrap()

    expect(mocks.createRenderer).not.toHaveBeenCalled()
    expect(mocks.createLabelRenderer).not.toHaveBeenCalled()
    expect(mocks.createScene).not.toHaveBeenCalled()
    expect(mocks.createCamera).not.toHaveBeenCalled()
    expect(mocks.createAstroControls).not.toHaveBeenCalled()
    expect(mocks.createClock).not.toHaveBeenCalled()
  })

  // Отдельной has()-проверки регистраций нет намеренно: она целиком покрыта
  // этим тестом — has() доказывает лишь то, что какой-то вызов привязки был,
  // а идентичность доказывает и факт регистрации, и правильный объект за токеном
  it('каждый токен указывает на результат своей фабрики', () => {
    const container: Container = new Kernel([RenderingServiceProvider]).bootstrap()

    expect(container.get(Tokens.Renderer)).toBe(mocks.fakes.renderer)
    expect(container.get(Tokens.LabelRenderer)).toBe(mocks.fakes.labelRenderer)
    expect(container.get(Tokens.Scene)).toBe(mocks.fakes.scene)
    expect(container.get(Tokens.Camera)).toBe(mocks.fakes.camera)
    expect(container.get(Tokens.AstroControls)).toBe(mocks.fakes.astroControls)
    expect(container.get(Tokens.Clock)).toBe(mocks.fakes.clock)
  })

  it('AstroControls получает камеру, рендерер и свой конфиг', () => {
    const container: Container = new Kernel([RenderingServiceProvider]).bootstrap()

    container.get(Tokens.AstroControls)

    expect(mocks.createAstroControls).toHaveBeenCalledWith(
      mocks.fakes.camera,
      mocks.fakes.renderer,
      config('astroControls')
    )
  })

  it('Renderer создаётся с maxPixelRatio из конфига', () => {
    const container: Container = new Kernel([RenderingServiceProvider]).bootstrap()

    container.get(Tokens.Renderer)

    expect(mocks.createRenderer).toHaveBeenCalledWith(config('renderer'), config('maxPixelRatio'))
    expect(mocks.createRenderer).toHaveBeenCalledWith(expect.anything(), 2)
  })

  it('полный контейнер с заглушками резолвит Application без исключений', () => {
    const container: Container = createTestContainer()

    expect(() => container.get(Tokens.Application)).not.toThrow()
  })
})
