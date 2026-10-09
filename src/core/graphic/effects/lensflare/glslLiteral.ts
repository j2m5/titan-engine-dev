/** Литерал float для GLSL: у целого обязана быть точка; погрешность округления тригонометрии — ноль */
export function glslFloat(value: number): string {
  if (!Number.isFinite(value)) throw new RangeError(`glslFloat: не конечное число ${value} — в GLSL литерала нет`)
  const clean = Math.abs(value) < 1e-12 ? 0 : value
  const text = String(Number(clean.toPrecision(7)))
  return /[.e]/.test(text) ? text : `${text}.0`
}
