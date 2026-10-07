import { describe, it, expect } from 'vitest'
import { SCREENSHOT_HEIGHT, screenshotFilename, screenshotSize } from '@/core/graphic/screenshot'

describe('screenshotSize — 4K «как на экране»', () => {
  it('окно 16:9 даёт ровно 3840×2160', () => {
    expect(screenshotSize(1920, 1080, 16384)).toEqual({ width: 3840, height: 2160 })
  })

  it('высота 4K, ширина по пропорции окна — у камеры тот же aspect', () => {
    const size = screenshotSize(1920, 969, 16384)

    expect(size.height).toBe(SCREENSHOT_HEIGHT)
    expect(size.width).toBe(Math.round((2160 * 1920) / 969))
  })

  it('сверхширокое окно ужимается под предел GPU пропорционально, а не обрезается', () => {
    // 32:9 → 7680×2160 при пределе 4096
    const size = screenshotSize(3840, 1080, 4096)

    expect(size.width).toBeLessThanOrEqual(4096)
    expect(size.height).toBeLessThanOrEqual(4096)
    expect(size.width / size.height).toBeCloseTo(32 / 9, 2)
  })

  it('высокое узкое окно упирается в предел по высоте тоже', () => {
    const size = screenshotSize(1080, 1920, 2048)

    expect(size.height).toBe(2048)
    expect(size.width / size.height).toBeCloseTo(1080 / 1920, 2)
  })

  it('вырожденный вьюпорт (свёрнутое окно) не даёт NaN и нулей', () => {
    const size = screenshotSize(0, 0, 16384)

    expect(Number.isFinite(size.width) && size.width > 0).toBe(true)
    expect(size.height).toBe(SCREENSHOT_HEIGHT)
  })
})

describe('screenshotFilename', () => {
  it('местное время с ведущими нулями, без двоеточий (их не любят файловые системы)', () => {
    expect(screenshotFilename(new Date(2026, 9, 7, 4, 5, 9))).toBe('screenshot-2026-10-07_04-05-09.png')
  })
})
