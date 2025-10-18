export function formatter(precision: number = 0): Intl.NumberFormat {
  return new Intl.NumberFormat('en-US', {
    maximumFractionDigits: precision
  })
}
