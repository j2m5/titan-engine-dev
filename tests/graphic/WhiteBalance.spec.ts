import { Vector3 } from 'three'
import {
  REFERENCE_TEMPERATURE_K,
  exposureGain,
  whiteBalanceGain
} from '@/core/graphic/effects/grading/whiteBalance'

describe('whiteBalance: экспозиция и баланс белого', () => {
  it('нулевая экспозиция не меняет кадр, стоп удваивает', () => {
    expect(exposureGain(0)).toBe(1)
    expect(exposureGain(1)).toBe(2)
    expect(exposureGain(-1)).toBe(0.5)
  })

  it('на опорной температуре и нулевом тинте баланс белого тождественен', () => {
    // Инвариант: нейтральные значения ручек обязаны оставлять кадр нетронутым.
    // Опорная точка — та же функция локуса, поэтому равенство точное, а не
    // приблизительное «примерно D65»
    const gain: Vector3 = whiteBalanceGain(REFERENCE_TEMPERATURE_K, 0)

    expect(gain.x).toBeCloseTo(1, 6)
    expect(gain.y).toBeCloseTo(1, 6)
    expect(gain.z).toBeCloseTo(1, 6)
  })

  it('температура ниже опорной охлаждает кадр, выше — согревает', () => {
    // Семантика белого баланса: число — температура ОПОРНОГО СВЕТА. Сказать
    // камере, что свет тёплый, значит заставить её компенсировать синим
    const cool: Vector3 = whiteBalanceGain(3000, 0)
    const warm: Vector3 = whiteBalanceGain(12000, 0)

    expect(cool.z / cool.x).toBeGreaterThan(1)
    expect(warm.z / warm.x).toBeLessThan(1)
  })

  it('тинт двигает зелёный против пурпурного', () => {
    const green: Vector3 = whiteBalanceGain(REFERENCE_TEMPERATURE_K, 1)
    const magenta: Vector3 = whiteBalanceGain(REFERENCE_TEMPERATURE_K, -1)

    expect(green.y).toBeGreaterThan(1)
    expect(magenta.y).toBeLessThan(1)
  })

  it('баланс белого не меняет общую яркость', () => {
    // Множитель нормирован по яркости: температура отвечает за оттенок, за
    // яркость отвечает только экспозиция. Иначе две ручки дрались бы за одно
    const weights: Vector3 = new Vector3(0.2126, 0.7152, 0.0722)

    for (const temperature of [2000, 4000, 6500, 9000, 20000]) {
      const gain: Vector3 = whiteBalanceGain(temperature, 0)

      expect(gain.dot(weights)).toBeCloseTo(1, 6)
    }
  })

  it('множитель остаётся в разумной полосе по всему документированному диапазону', () => {
    // Регрессия: ниже точки, где локус Планка выходит за гамму sRGB, целевой
    // цвет получал отрицательный канал; Math.max(..., eps) превращал его в
    // почти-ноль, и деление давало взрывной множитель (порядка 1e6 до
    // нормировки по яркости). NaN/знак не ловят такой дефект — нужна полоса
    for (const temperature of [500, 1000, 1667, 2000, 3000, 6500, 9000, 20000, 40000, 100000]) {
      const gain: Vector3 = whiteBalanceGain(temperature, 0)

      expect(Number.isFinite(gain.x + gain.y + gain.z)).toBe(true)
      expect(gain.x).toBeGreaterThan(0.05)
      expect(gain.y).toBeGreaterThan(0.05)
      expect(gain.z).toBeGreaterThan(0.05)
      expect(gain.x).toBeLessThan(11)
      expect(gain.y).toBeLessThan(11)
      expect(gain.z).toBeLessThan(11)
    }
  })
})
