export function formatCssValue(value: number | string, unit: string = 'px'): string {
  if (typeof value === 'number') {
    return `${value}${unit}`
  }

  return value
}

/**
 * Инлайн-размеры только из переданных пропов: без них style.width/height
 * вызывающего остаётся в силе (раньше дефолтный 'auto' молча его затирал).
 */
export function sizeStyle(width?: number | string, height?: number | string): React.CSSProperties {
  return {
    ...(width !== undefined && { width: formatCssValue(width) }),
    ...(height !== undefined && { height: formatCssValue(height) })
  }
}

export interface SliderFill {
  /** Доля значения, 0–100 */
  percent: number
  /** Доля буфера, 0–100, не меньше percent */
  bufferPercent: number
}

/**
 * Заливка дорожки слайдера в процентах. Пустой диапазон (max ≤ min) — 0%, а
 * не NaN; доли зажаты в 0–100; буфер меньше значения не рисует сегмент назад
 * (буфер по умолчанию 0 при отрицательном min, буфер аудио позади курсора).
 */
export function sliderFill(value: number, min: number, max: number, buffer: number): SliderFill {
  const span: number = max - min

  if (!(span > 0)) return { percent: 0, bufferPercent: 0 }

  const clamp = (x: number): number => Math.min(100, Math.max(0, x))
  const percent: number = clamp(((value - min) / span) * 100)

  return { percent, bufferPercent: Math.max(percent, clamp(((buffer - min) / span) * 100)) }
}
