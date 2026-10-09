import { Actor } from '@/core/models/Actor'
import { relativeSpeedKms, worldVelocity } from '@/core/bodyInfo/worldVelocity'

const EPOCH = 2461222.5

describe('worldVelocity: скорость, с которой тело реально движется по сцене', () => {
  it('Земля относительно Солнца — 29–30.5 км/с (через барицентр Земля–Луна)', () => {
    const speed = relativeSpeedKms(Actor.find(7)!, Actor.find(4)!, EPOCH)

    expect(speed).toBeGreaterThan(29)
    expect(speed).toBeLessThan(30.5)
  })

  it('Луна относительно Земли — около 1 км/с, а не ~13 км/с из масс барицентра', () => {
    const speed = relativeSpeedKms(Actor.find(19)!, Actor.find(7)!, EPOCH)

    expect(speed).toBeGreaterThan(0.9)
    expect(speed).toBeLessThan(1.1)
  })

  it('Юпитер относительно Солнца — 12.4–13.8 км/с', () => {
    const speed = relativeSpeedKms(Actor.find(10)!, Actor.find(4)!, EPOCH)

    expect(speed).toBeGreaterThan(12.4)
    expect(speed).toBeLessThan(13.8)
  })

  it('скорость тела без орбиты вдоль всей цепочки — ноль (барицентр Солнечной системы)', () => {
    expect(worldVelocity(Actor.find(1)!, EPOCH).length()).toBe(0)
  })
})
