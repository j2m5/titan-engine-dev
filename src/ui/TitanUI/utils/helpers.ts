export function formatCssValue(value: number | string, unit: string = 'px'): string {
  if (typeof value === 'number') {
    return `${value}${unit}`
  }

  return value
}
