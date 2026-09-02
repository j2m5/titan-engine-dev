import type { DepthVolume } from '@/core/graphic/passes/DepthVolume'

/**
 * Реестр объёмов, которые рисует DepthVolumePass (пыль колец, туманности).
 *
 * Объёмы рисуются не в основном RenderPass, а своим пассом после сцены (марш
 * режется по глубине сцены), и пассу нужно знать, какие объёмы существуют,
 * не обходя граф сцены каждый кадр. Объём регистрируется при создании и
 * снимается в dispose(); пасс читает снимок каждый кадр.
 */
export class DepthVolumeRegistry {
  private readonly items = new Set<DepthVolume>()

  public register(volume: DepthVolume): void {
    this.items.add(volume)
  }

  public unregister(volume: DepthVolume): void {
    this.items.delete(volume)
  }

  public volumes(): readonly DepthVolume[] {
    return Array.from(this.items)
  }

  public get size(): number {
    return this.items.size
  }
}
