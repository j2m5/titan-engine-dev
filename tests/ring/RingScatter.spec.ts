import {
  RING_OPPOSITION_G,
  ringPhase,
  ringScatteredBrightness
} from './ringScatterMirror'

// Вклад в кадр = покрытие (альфа) × рассеянная яркость: альфа-блендинг
// домножает цвет фрагмента на альфу
const contribution = (cosTheta: number, alpha: number): number =>
  alpha * ringScatteredBrightness(cosTheta, alpha, 0.6, 0.5, 3)

const BACKLIT = -1
const FRONTLIT = 1

describe('рассеяние кольца', () => {
  it('изотропная фаза равна единице', () => {
    expect(ringPhase(0, 0)).toBeCloseTo(1, 10)
    expect(ringPhase(1, 0)).toBeCloseTo(1, 10)
    expect(ringPhase(-1, 0)).toBeCloseTo(1, 10)
  })

  it('отрицательный показатель даёт пик на просвет, положительный — со стороны звезды', () => {
    expect(ringPhase(BACKLIT, -0.6)).toBeGreaterThan(ringPhase(FRONTLIT, -0.6))
    expect(ringPhase(FRONTLIT, RING_OPPOSITION_G)).toBeGreaterThan(ringPhase(BACKLIT, RING_OPPOSITION_G))
  })

  it('НА ПРОСВЕТ разрежённый участок ярче плотного — это и есть инверсия', () => {
    expect(contribution(BACKLIT, 0.33)).toBeGreaterThan(contribution(BACKLIT, 0.9))
  })

  it('СО СТОРОНЫ ЗВЕЗДЫ плотный участок ярче разрежённого — порядок обратный', () => {
    expect(contribution(FRONTLIT, 0.9)).toBeGreaterThan(contribution(FRONTLIT, 0.33))
  })

  it('вклад в кадр имеет максимум на средней плотности и падает к обоим краям', () => {
    // Пустого места не видно, плотное не пропускает свет — светится середина
    let best = 0
    let bestAlpha = 0

    for (let alpha = 0.02; alpha <= 1; alpha += 0.02) {
      const value = contribution(BACKLIT, alpha)
      if (value > best) {
        best = value
        bestAlpha = alpha
      }
    }

    expect(bestAlpha).toBeGreaterThan(0.1)
    expect(bestAlpha).toBeLessThan(0.75)
    expect(contribution(BACKLIT, 0.02)).toBeLessThan(best)
    expect(contribution(BACKLIT, 1)).toBeLessThan(best)
  })

  it('переход через плоскость кольца непрерывен', () => {
    // Прежняя реализация ветвилась по стороне и роняла яркость в 0.2 раза
    // ступенькой; единая формула обязана меняться плавно
    const step = 0.001
    let maxJump = 0

    for (let cos = -1; cos < 1; cos += step) {
      const jump = Math.abs(
        ringScatteredBrightness(cos + step, 0.5, 0.6, 0.5, 3) - ringScatteredBrightness(cos, 0.5, 0.6, 0.5, 3)
      )
      if (jump > maxJump) maxJump = jump
    }

    // Прежняя ступенька роняла яркость на порядок; здесь шаг по cosTheta в
    // 0.001 даёт около 0.025 — порог 0.1 оставляет запас и ловит разрыв
    expect(maxJump).toBeLessThan(0.1)
  })

  it('нулевое затухание выключает инверсию: плотность перестаёт влиять на яркость', () => {
    // Точка отката, если вид не понравится
    const thin = ringScatteredBrightness(BACKLIT, 0.2, 0.6, 0.5, 0)
    const dense = ringScatteredBrightness(BACKLIT, 0.9, 0.6, 0.5, 0)

    expect(thin).toBeCloseTo(dense, 10)
  })
})
