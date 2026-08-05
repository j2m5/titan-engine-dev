import {
  STAR_IMPOSTOR_PIXELS,
  apparentSizeAtDistance,
  distanceForApparentSize
} from '@/core/helpers/apparentSize'

describe('apparentSize: видимый размер и расстояние', () => {
  it('перевод туда и обратно тождественен', () => {
    // Единственный инвариант, который делает стык LOD согласованным: обе
    // стороны обязаны считать одну величину одной функцией
    const distance = distanceForApparentSize(1000, 12, 50, 1080)

    expect(apparentSizeAtDistance(1000, distance, 50, 1080)).toBeCloseTo(12, 6)
  })

  it('высота кадра считается через 2 * tan(fov / 2), а не tan(fov)', () => {
    // Объект размером во всю высоту кадра на расстоянии d занимает ровно
    // viewportHeight пикселей. tan(fov) даёт здесь ошибку около 28%
    const distance = 100
    const frameHeight = 2 * Math.tan((50 * Math.PI) / 180 / 2) * distance

    expect(apparentSizeAtDistance(frameHeight, distance, 50, 1080)).toBeCloseTo(1080, 6)
  })

  it('вдвое дальше — вдвое мельче', () => {
    const near = apparentSizeAtDistance(1000, 500, 50, 1080)
    const far = apparentSizeAtDistance(1000, 1000, 50, 1080)

    expect(near / far).toBeCloseTo(2, 6)
  })

  it('размер импостора звезды — общая константа, а не число в двух местах', () => {
    expect(STAR_IMPOSTOR_PIXELS).toBe(12)
  })
})

describe('стык LOD звезды', () => {
  it('на расстоянии переключения диск звезды и билборд одного размера', () => {
    // Именно это расхождение давало скачок: свитч стоял на 3 пикселях, а
    // билборд рисовал себя в 12
    const diameter = 2 * 695700
    const fov = 50
    const viewportHeight = 1080

    const switchDistance = distanceForApparentSize(diameter, STAR_IMPOSTOR_PIXELS, fov, viewportHeight)
    const starPixels = apparentSizeAtDistance(diameter, switchDistance, fov, viewportHeight)

    expect(starPixels).toBeCloseTo(STAR_IMPOSTOR_PIXELS, 6)
  })
})
