import { describe, it, expect, vi } from 'vitest'
import { PerspectiveCamera, Scene, Vector2 } from 'three'
import { AtmosphereRegistry } from '@/core/services/AtmosphereRegistry'
import { Postprocessing } from '@/core/graphic/Postprocessing'

const MAX_RENDERBUFFER_SIZE = 0x84e8

interface Rig {
  pp: Postprocessing
  camera: PerspectiveCamera
  log: string[]
  render: ReturnType<typeof vi.fn>
  blob: Blob
  canvas: { toBlob: (callback: (value: Blob | null) => void, type?: string) => void }
}

/**
 * Фейковые рендерер и композер пишут вызовы в общий журнал: снимок держится
 * на ПОРЯДКЕ (pixelRatio до ресайза, toBlob до возврата размера).
 */
function rig(cssWidth: number, cssHeight: number, pixelRatio: number, maxSize: number = 16384): Rig {
  const log: string[] = []
  const blob = new Blob(['png'])
  const renderer = {
    getSize: (target: Vector2): Vector2 => target.set(cssWidth, cssHeight),
    getPixelRatio: (): number => pixelRatio,
    setPixelRatio: (value: number): void => {
      log.push(`renderer.setPixelRatio(${value})`)
    },
    setSize: (width: number, height: number, updateStyle?: boolean): void => {
      log.push(`renderer.setSize(${width}, ${height}, ${updateStyle})`)
    },
    capabilities: { maxTextureSize: maxSize },
    getContext: () => ({
      MAX_RENDERBUFFER_SIZE,
      getParameter: (name: number): number => (name === MAX_RENDERBUFFER_SIZE ? maxSize : 0)
    }),
    domElement: {
      toBlob: (callback: (value: Blob | null) => void, type?: string): void => {
        log.push(`toBlob(${type})`)
        callback(blob)
      }
    }
  }
  const camera = new PerspectiveCamera(50, cssWidth / cssHeight, 0.1, 1000)
  const pp = new Postprocessing(renderer as never, new Scene(), camera, new AtmosphereRegistry(), null as never)
  const render = vi.fn((): void => {
    log.push('composer.render')
  })

  pp.composer = {
    setSize: (width: number, height: number, updateStyle?: boolean): void => {
      log.push(`composer.setSize(${width}, ${height}, ${updateStyle})`)
    },
    render
  } as never

  return { pp, camera, log, render, blob, canvas: renderer.domElement }
}

describe('Postprocessing.captureScreenshot — 4K «как на экране»', () => {
  it('uses delta zero and invalidates both capture and restored history even when render throws', async () => {
    const { pp, render } = rig(1600, 900, 1.5)
    const invalidate = vi.spyOn(pp, 'invalidateCloudHistory')
    const draw = vi.spyOn(pp, 'render')
    await pp.captureScreenshot()
    expect(draw).toHaveBeenCalledWith(0)
    expect(invalidate).toHaveBeenCalledTimes(2)
    render.mockImplementation(() => {
      throw Error('capture render failure')
    })
    expect(() => pp.captureScreenshot()).toThrow('capture render failure')
    expect(invalidate).toHaveBeenCalledTimes(4)
  })
  it('restores dimensions and history when toBlob throws inside its promise', async () => {
    const { pp, canvas, log } = rig(1600, 900, 1.5)
    const invalidate = vi.spyOn(pp, 'invalidateCloudHistory')
    canvas.toBlob = () => {
      throw Error('encoder failure')
    }
    await expect(pp.captureScreenshot()).rejects.toThrow('encoder failure')
    expect(invalidate).toHaveBeenCalledTimes(2)
    expect(log.slice(-3)).toEqual([
      'renderer.setSize(1600, 900, false)',
      'renderer.setPixelRatio(1.5)',
      'composer.setSize(1600, 900, false)'
    ])
  })
  it('порядок: pixelRatio 1 → ресайз без стиля → рендер → toBlob → возврат CSS-размера → pixelRatio → пассы', async () => {
    const { pp, log, blob } = rig(1920, 1080, 2)

    await expect(pp.captureScreenshot()).resolves.toBe(blob)

    expect(log).toEqual([
      'renderer.setPixelRatio(1)',
      'composer.setSize(3840, 2160, false)',
      'composer.render',
      'toBlob(image/png)',
      // CSS-размер ДО pixelRatio: иначе setPixelRatio пересчитал бы канвас
      // от 3840×2160 и на миг раздул его до 7680×4320
      'renderer.setSize(1920, 1080, false)',
      'renderer.setPixelRatio(2)',
      'composer.setSize(1920, 1080, false)'
    ])
  })

  it('камеру не трогает: пропорция снимка та же, что у окна', async () => {
    const { pp, camera } = rig(1920, 969, 1)
    const aspect = camera.aspect
    const updateProjection = vi.spyOn(camera, 'updateProjectionMatrix')

    await pp.captureScreenshot()

    expect(camera.aspect).toBe(aspect)
    expect(updateProjection).not.toHaveBeenCalled()
  })

  it('размер ужимается под предел renderbuffer у GPU', () => {
    const { pp, log } = rig(3840, 1080, 1, 4096)

    void pp.captureScreenshot()

    const resize = log.find((line: string) => line.startsWith('composer.setSize'))!
    const [width, height] = resize.match(/\d+/g)!.map(Number)

    expect(width).toBeLessThanOrEqual(4096)
    expect(width / height).toBeCloseTo(32 / 9, 2)
  })

  it('исключение в рендере не оставляет окно в 4K: размер и pixelRatio возвращаются', () => {
    const { pp, log, render } = rig(1600, 900, 1.5)

    render.mockImplementation((): void => {
      throw new Error('context lost')
    })

    expect(() => pp.captureScreenshot()).toThrow('context lost')
    expect(log.slice(-3)).toEqual([
      'renderer.setSize(1600, 900, false)',
      'renderer.setPixelRatio(1.5)',
      'composer.setSize(1600, 900, false)'
    ])
  })
})
