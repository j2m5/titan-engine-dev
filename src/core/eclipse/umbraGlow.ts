/** Сила подсветки умбры тела с атмосферой (доля полного света), дефолт 0.02. */
export const DEFAULT_UMBRA_GLOW = 0.02

export function resolveUmbraGlow(data: { umbraGlow?: unknown } | undefined, context: string): number {
  const raw = data?.umbraGlow
  if (raw === undefined) return DEFAULT_UMBRA_GLOW
  if (typeof raw !== 'number' || !Number.isFinite(raw) || raw < 0) {
    throw new Error(`umbraGlow ${context}: должен быть числом >= 0: ${String(raw)}`)
  }
  return raw
}
