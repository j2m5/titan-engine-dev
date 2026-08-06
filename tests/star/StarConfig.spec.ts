import { config } from '@/core/framework/config'
import { star } from '@/config/star'

describe('star config: значения приёмки', () => {
  it('гистерезис LOD мал: стык сведён по размеру, крупный дал бы скачок', () => {
    // Обратное переключение происходит на d·(1−h): диск возвращается на
    // 12/(1−h) px. При 0.05 это ~12.6px (неразличимо), при 0.3 как у чёрной
    // дыры — ~17px (виден скачок)
    expect(star.star.lodHysteresis).toBe(0.05)
  })

  it('секция star доезжает до config()', () => {
    expect(config('star.lodHysteresis')).toBe(0.05)
  })

  it('ручки яркости импостора нет намеренно', () => {
    // Билборд считает поверхность формулами диска (чанк starSurface, общие
    // константы): любой множитель поверх воссоздал бы шов на переключении
    expect('impostorIntensity' in star.star).toBe(false)
  })
})
