import { config } from '@/core/framework/config'
import { star } from '@/config/star'

describe('star config: значения приёмки', () => {
  it('яркость импостора закреплена на прежнем emissiveIntensity', () => {
    // 40 — не замер, а перенос прежней константы MeshStandardMaterial
    // (emissiveIntensity) как есть: яркость билборда на приёмке не менялась
    expect(star.star.impostorIntensity).toBe(40)
  })

  it('гистерезис LOD мал: стык сведён по размеру, крупный дал бы скачок', () => {
    // Обратное переключение происходит на d·(1−h): диск возвращается на
    // 12/(1−h) px. При 0.05 это ~12.6px (неразличимо), при 0.3 как у чёрной
    // дыры — ~17px (виден скачок)
    expect(star.star.lodHysteresis).toBe(0.05)
  })

  it('секция star доезжает до config()', () => {
    expect(config('star.impostorIntensity')).toBe(40)
    expect(config('star.lodHysteresis')).toBe(0.05)
  })
})
