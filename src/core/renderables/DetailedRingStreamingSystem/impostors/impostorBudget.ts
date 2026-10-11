import type { ImpostorLayout } from './impostorLayout'

function validBytes(bytes: number): void {
  if (!Number.isSafeInteger(bytes) || bytes < 0) throw new RangeError('Неверный размер GPU-ресурса')
}

export function textureBytes(width: number, height: number, layers: number, levels: number, bytesPerTexel: number): number {
  for (const size of [width, height, layers, levels, bytesPerTexel]) {
    if (!Number.isSafeInteger(size) || size < 1) throw new RangeError('Неверный размер текстуры')
  }
  let bytes = 0
  for (let level = 0; level < levels; level++) {
    bytes += Math.max(1, Math.floor(width / 2 ** level)) * Math.max(1, Math.floor(height / 2 ** level)) * layers * bytesPerTexel
  }
  validBytes(bytes)
  return bytes
}

export function atlasBytes(layout: ImpostorLayout, archetypeCount: number): number {
  if (!Number.isSafeInteger(archetypeCount) || archetypeCount < 1) throw new RangeError('Неверное число архетипов')
  return textureBytes(layout.pageSize, layout.pageSize, archetypeCount + 1, layout.mipCount, 8)
}

export function instanceAttributeBytes(capacities: readonly number[]): number {
  let total = 0
  for (const capacity of capacities) {
    validBytes(capacity)
    total += capacity * 8
  }
  validBytes(total)
  return total
}

export interface ImpostorBudgetSnapshot {
  allocatedBytes: number
  reservedBytes: number
  peakBytes: number
}

/** Резерв включает живые данные владельца и ещё не созданные ресурсы. */
export class ImpostorBudget {
  private readonly owners = new Map<object, { quota: number; allocated: number }>()
  private peak = 0

  public constructor(public readonly limitBytes: number) {
    validBytes(limitBytes)
  }

  public reserve(owner: object, bytes: number): boolean {
    validBytes(bytes)
    const previous = this.owners.get(owner)
    if (bytes < (previous?.allocated ?? 0)) return false
    let used = bytes
    for (const [key, entry] of this.owners) if (key !== owner) used += entry.quota
    if (used > this.limitBytes) return false
    this.owners.set(owner, { quota: bytes, allocated: previous?.allocated ?? 0 })
    this.peak = Math.max(this.peak, used)
    return true
  }

  public commit(owner: object, bytes?: number): void {
    const entry = this.owners.get(owner)
    if (!entry) throw new Error('GPU-ресурс не зарезервирован')
    const allocated = bytes ?? entry.quota
    validBytes(allocated)
    if (allocated > entry.quota) throw new RangeError('GPU-ресурс превышает резерв')
    entry.allocated = allocated
  }

  public release(owner: object): void {
    this.owners.delete(owner)
  }

  public invalidate(): void { this.owners.clear() }

  public snapshot(): ImpostorBudgetSnapshot {
    let allocatedBytes = 0
    let reservedBytes = 0
    for (const entry of this.owners.values()) {
      allocatedBytes += entry.allocated
      reservedBytes += entry.quota - entry.allocated
    }
    return { allocatedBytes, reservedBytes, peakBytes: this.peak }
  }
}
