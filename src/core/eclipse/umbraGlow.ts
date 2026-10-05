/** Сила подсветки умбры тела с атмосферой (доля полного света), дефолт 0.02. */
export const DEFAULT_UMBRA_GLOW = 0.02

export function resolveUmbraGlow(data: { umbraGlow?: unknown } | undefined, context: string): number {
  const raw = data?.umbraGlow
  if (raw === undefined) return DEFAULT_UMBRA_GLOW
  if (typeof raw !== 'number' || !Number.isFinite(raw) || raw < 0 || raw > 1) {
    throw new Error(`umbraGlow ${context}: должен быть числом в [0, 1]: ${String(raw)}`)
  }
  return raw
}
