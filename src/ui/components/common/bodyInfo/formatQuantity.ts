import { AU } from '@/core/constants'

const SUPERSCRIPT: Record<string, string> = {
  '0': '⁰',
  '1': '¹',
  '2': '²',
  '3': '³',
  '4': '⁴',
  '5': '⁵',
  '6': '⁶',
  '7': '⁷',
  '8': '⁸',
  '9': '⁹',
  '-': '⁻'
}

const LIGHT_YEAR_KM: number = 9.4607304725808e12
const DAYS_PER_YEAR: number = 365.25

/**
 * Три значащих цифры. От 10⁶ и меньше 10⁻³ — мантисса × 10ⁿ (масса Земли
 * 5.97 × 10²⁴), от тысячи до миллиона — целое с разделителями (радиус
 * 69,911), остальное — без хвостовых нулей (9.86, 0.0167).
 */
export function formatNumber(value: number): string {
  if (!Number.isFinite(value)) return '—'
  if (value === 0) return '0'

  const abs: number = Math.abs(value)

  if (abs >= 1e6 || abs < 1e-3) {
    let exponent: number = Math.floor(Math.log10(abs))
    let mantissa: number = value / 10 ** exponent

    // 9.996 округляется до 10.00 — переносим в порядок
    if (Math.abs(Number(mantissa.toFixed(2))) >= 10) {
      mantissa /= 10
      exponent += 1
    }

    const power: string = String(exponent)
      .split('')
      .map((char: string): string => SUPERSCRIPT[char])
      .join('')

    return `${mantissa.toFixed(2)} × 10${power}`
  }

  if (abs >= 1000) return Math.round(value).toLocaleString('en-US')

  return String(Number(value.toPrecision(3)))
}

export function formatWithUnit(value: number, unit: string): string {
  return `${formatNumber(value)} ${unit}`
}

/** До 0.01 а.е. — км, до 10 000 а.е. — а.е., дальше световые годы */
export function formatDistanceKm(km: number): string {
  if (km < 0.01 * AU) return formatWithUnit(km, 'km')
  if (km < 1e4 * AU) return formatWithUnit(km / AU, 'AU')

  return formatWithUnit(km / LIGHT_YEAR_KM, 'ly')
}

/** Меньше секунды — мс (пульсары), меньше двух суток — часы, дальше сутки */
export function formatRotationPeriod(hours: number): string {
  if (hours < 1 / 3600) return formatWithUnit(hours * 3.6e6, 'ms')
  if (hours < 48) return formatWithUnit(hours, 'h')

  return formatWithUnit(hours / 24, 'd')
}

/** До двух лет — сутки, дальше годы */
export function formatOrbitalPeriod(days: number): string {
  if (days < 2 * DAYS_PER_YEAR) return formatWithUnit(days, 'd')

  return formatWithUnit(days / DAYS_PER_YEAR, 'yr')
}

/** У лун полуось в км, у остальных — а.е. */
export function formatSemiMajorAxis(au: number): string {
  return au < 0.01 ? formatWithUnit(au * AU, 'km') : formatWithUnit(au, 'AU')
}

export function formatAngle(degrees: number): string {
  return `${formatNumber(degrees)}°`
}
