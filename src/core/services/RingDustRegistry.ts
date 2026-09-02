import type { RingDustVolume } from '@/core/renderables/DetailedRingStreamingSystem/dust/RingDustVolume'

/**
 * Реестр объёмов пылевой дымки колец для пасса RingDustPass.
 *
 * Гало рисуется не в основном RenderPass, а своим пассом после сцены (марш
 * режется по глубине сцены), и пассу нужно знать, какие объёмы существуют,
 * не обходя граф сцены каждый кадр. Объём регистрируется при создании и
 * снимается в dispose(); пасс читает снимок каждый кадр.
 */
export class RingDustRegistry {
  private readonly items = new Set<RingDustVolume>()

  public register(volume: RingDustVolume): void {
    this.items.add(volume)
  }

  public unregister(volume: RingDustVolume): void {
    this.items.delete(volume)
  }

  public volumes(): readonly RingDustVolume[] {
    return Array.from(this.items)
  }

  public get size(): number {
    return this.items.size
  }
}
