/**
 * Детерминированный генератор псевдослучайных чисел (mulberry32).
 * Один и тот же seed всегда даёт одну и ту же последовательность.
 * Используется для воспроизводимой генерации астероидов в секторах.
 */
class SeededRandom {
  private state: number

  public constructor(seed: number) {
    this.state = seed | 0
  }

  /** Возвращает число в диапазоне [0, 1) */
  public next(): number {
    this.state |= 0
    this.state = (this.state + 0x6d2b79f5) | 0
    let t = Math.imul(this.state ^ (this.state >>> 15), 1 | this.state)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }

  /** Возвращает число в диапазоне [min, max) */
  public range(min: number, max: number): number {
    return min + this.next() * (max - min)
  }

  /** Возвращает целое число в диапазоне [min, max] */
  public int(min: number, max: number): number {
    return Math.floor(this.range(min, max + 1))
  }
}

/**
 * Хеш-функция для генерации seed из координат сектора.
 * Комбинирует несколько чисел в один детерминированный seed.
 */
function hashSectorKey(ringId: number, layerIndex: number, angleIndex: number): number {
  let h = 0x811c9dc5
  const values = [ringId, layerIndex, angleIndex]
  for (const v of values) {
    h ^= v & 0xff
    h = Math.imul(h, 0x01000193)
    h ^= (v >>> 8) & 0xff
    h = Math.imul(h, 0x01000193)
    h ^= (v >>> 16) & 0xff
    h = Math.imul(h, 0x01000193)
    h ^= (v >>> 24) & 0xff
    h = Math.imul(h, 0x01000193)
  }
  return h >>> 0
}

export { SeededRandom, hashSectorKey }
