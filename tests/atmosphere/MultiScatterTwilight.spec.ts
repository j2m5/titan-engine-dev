import { MULTIPLE_SCATTERING_FRAG } from '@/core/renderables/Atmosphere/AtmosphereLUTGenerator'

describe('AtmosphereLUTGenerator: сумеречный спад multi-scatter вуали', () => {
  const frag: string = MULTIPLE_SCATTERING_FRAG

  it('кривая спада — куб smoothstep, прижимающий вуаль к терминатору', () => {
    // Без куба вуаль порядков 2+ тянулась серо-зелёной полосой далеко за
    // гашение поверхности (smoothstep(-0.08, 0.25, NdotL) в PlanetShaderTemplate) —
    // «полоса рассогласования терминаторов» (расследование 2026-07-31).
    // Куб глушит хвост в ночи (s^3 << s при s -> 0), не трогая день (1^3 = 1).
    expect(frag).toContain('float twilight = pow(smoothstep(u_mu_s_min * 0.6, 0.0, ms_mu_s), 3.0);')
  })

  it('ширина спада остаётся адаптивной к планете: доля от u_mu_s_min, не константа', () => {
    // Абсолютный порог (типа -0.25) ломал бы планеты с иной геометрией оболочки
    expect(frag).toContain('u_mu_s_min * 0.6')
  })

  it('спад формует вклад через mix с ночным полом (u_ms_night_floor = 1.0 — чистая физика)', () => {
    expect(frag).toContain('float shaped = u_ms_factor * mix(u_ms_night_floor, 1.0, twilight);')
  })

  it('аккумулятор по-прежнему делит на фазу Рэлея и не трогает alpha (mie.r одиночного)', () => {
    // Исторические грабли: alpha=1.0 в аддитивном бленде портил mie.r —
    // формула спада не должна была задеть этот контракт
    expect(frag).toContain('delta_multiple_scattering * shaped / RayleighPhaseFunction(nu), 0.0)')
  })
})
