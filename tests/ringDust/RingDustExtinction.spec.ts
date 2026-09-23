import { AddEquation, AdditiveBlending, Color, CustomBlending, OneFactor, OneMinusSrcAlphaFactor } from 'three'
import { RingDustRaymarchMaterial } from '@/core/renderables/DetailedRingStreamingSystem/dust/RingDustRaymarchMaterial'
import { RingDustVolume } from '@/core/renderables/DetailedRingStreamingSystem/dust/RingDustVolume'

const EXT_LINE = 'float alphaExt = (1.0 - exp(-tau * uDustExtinction)) * gate;'
const OUT_LINE = 'gl_FragColor = vec4(haze * litFrac * alpha, alphaExt);'
const ADDITIVE_OUT_LINE = 'gl_FragColor = vec4(haze * litFrac, alpha);'

const makeVolume = (extra: Partial<{ extinction: number }> = {}) =>
  new RingDustVolume({
    innerRadius: 70,
    outerRadius: 140,
    dustScaleHeight: 0.5,
    dustDensity: 0.01,
    dustColor: new Color(0x9b968c),
    anglePower: 2,
    nearFade: 20,
    maxSteps: 16,
    planetRadius: 0,
    ...extra
  })

// CPU-зеркала двух выходов шейдера: аддитивный (SrcAlpha, One) и
// премультиплированный over (One, OneMinusSrcAlpha) — держать в синхроне с GLSL
const additiveComposite = (bg: number, haze: number, tau: number, gate: number): number => {
  const alpha = (1 - Math.exp(-tau)) * gate
  return bg + haze * alpha
}
const overComposite = (bg: number, haze: number, tau: number, gate: number, k: number): number => {
  const alpha = (1 - Math.exp(-tau)) * gate
  const alphaExt = (1 - Math.exp(-tau * k)) * gate
  return haze * alpha + bg * (1 - alphaExt)
}

describe('RingDustExtinction', () => {
  it('без extinction — аддитивный блендинг, в тексте нет ни юниформа, ни alphaExt, выход прежний', () => {
    const m = new RingDustRaymarchMaterial()
    expect(m.blending).toBe(AdditiveBlending)
    const fs = m.fragmentShader
    expect(fs).not.toContain('uDustExtinction')
    expect(fs).not.toContain('alphaExt')
    expect(fs).toContain(ADDITIVE_OUT_LINE)
  })

  it('extinction: true — премультиплированный over: One / OneMinusSrcAlpha по цвету и альфе, AddEquation', () => {
    const m = new RingDustRaymarchMaterial(undefined, { extinction: true })
    expect(m.blending).toBe(CustomBlending)
    expect(m.blendEquation).toBe(AddEquation)
    expect(m.blendEquationAlpha).toBe(AddEquation)
    expect(m.blendSrc).toBe(OneFactor)
    expect(m.blendDst).toBe(OneMinusSrcAlphaFactor)
    expect(m.blendSrcAlpha).toBe(OneFactor)
    expect(m.blendDstAlpha).toBe(OneMinusSrcAlphaFactor)
    expect(m.transparent).toBe(true)
    expect(m.depthWrite).toBe(false)
    expect(m.depthTest).toBe(false)
  })

  it('extinction: true — юниформ объявлен, отдельная альфа поглощения и премультиплированный цвет на выходе', () => {
    const fs = new RingDustRaymarchMaterial(undefined, { extinction: true }).fragmentShader
    expect(fs).toContain('uniform float uDustExtinction;')
    expect(fs).toContain(EXT_LINE)
    expect(fs).toContain(OUT_LINE)
    expect(fs).not.toContain(ADDITIVE_OUT_LINE)
    // Вес вклада alpha считается как прежде — поглощение его не трогает
    expect(fs).toContain('float alpha = (1.0 - exp(-tau)) * gate;')
    expect(fs.indexOf(EXT_LINE)).toBeLessThan(fs.indexOf(OUT_LINE))
  })

  it('юниформ поглощения всегда есть, по умолчанию 0 (нейтрально)', () => {
    expect(new RingDustRaymarchMaterial().uniforms.uDustExtinction.value).toBe(0)
    expect(new RingDustRaymarchMaterial(undefined, { extinction: true }).uniforms.uDustExtinction.value).toBe(0)
  })

  it('ранние выходы фрагмента при over: только discard или непрозрачная диагностика, ничего не затемняет кадр', () => {
    const fs = new RingDustRaymarchMaterial(undefined, { extinction: true }).fragmentShader
    const main = fs.slice(fs.indexOf('void main()'))
    const writes = main.match(/gl_FragColor\s*=\s*[^;]+;/g) ?? []
    // Ровно два выхода: диагностика (непрозрачно, alpha 1 → over кладёт её поверх) и штатный
    expect(writes).toEqual(['gl_FragColor = vec4(dbg, 1.0);', OUT_LINE])
    // Все прочие выходы до штатного — discard (пустой интервал, гейт, alpha ниже порога)
    const earlyExits = main.match(/^\s*if \(.*\) discard;$/gm) ?? []
    expect(earlyExits.length).toBe(4)
    // return встречается только в диагностической ветке
    const returns = main.match(/\breturn;/g) ?? []
    expect(returns.length).toBe(1)
  })

  it('CPU-зеркало: при k = 0 over совпадает с аддитивным, при k = 1 и τ = 12.7 фон гаснет', () => {
    const cases: Array<[number, number, number, number]> = [
      [1, 0.4, 0.3, 1],
      [5, 0.8, 2, 0.6],
      [0.2, 1.5, 12.7, 1]
    ]
    for (const [bg, haze, tau, gate] of cases) {
      expect(overComposite(bg, haze, tau, gate, 0)).toBeCloseTo(additiveComposite(bg, haze, tau, gate), 12)
    }
    const alphaExt = 1 - Math.exp(-12.7 * 1)
    expect(1 - alphaExt).toBeLessThan(1e-5)
    // Свет дымки тот же, что в аддитивной модели: разница только в множителе фона
    const haze = 0.7
    expect(overComposite(0, haze, 12.7, 1, 1)).toBeCloseTo(additiveComposite(0, haze, 12.7, 1), 12)
    // Гейт гасит и поглощение: при gate = 0 фон не тронут
    expect(overComposite(3, haze, 12.7, 0, 1)).toBe(3)
  })

  it('RingDustVolume: extinction > 0 включает опцию и пишет юниформ; 0 или не задано — аддитивно', () => {
    const on = makeVolume({ extinction: 0.5 }).dustMaterial
    expect(on.blending).toBe(CustomBlending)
    expect(on.uniforms.uDustExtinction.value).toBe(0.5)
    expect(on.fragmentShader).toContain(OUT_LINE)

    for (const volume of [makeVolume(), makeVolume({ extinction: 0 })]) {
      expect(volume.dustMaterial.blending).toBe(AdditiveBlending)
      expect(volume.dustMaterial.uniforms.uDustExtinction.value).toBe(0)
      expect(volume.dustMaterial.fragmentShader).not.toContain('uDustExtinction')
    }
  })
})
