import { BlendFunction, Effect } from 'postprocessing'

/**
 * Дизеринг финального пасса: ломает бандинг 8-битного квантования
 * (тёмные градиенты скайбокса, ореолы атмосфер). Interleaved gradient
 * noise (Jimenez, SIGGRAPH 2014) — тот же паттерн, что в RingDust.
 *
 * Амплитуда — один LSB 8-бит (±0.5/255): ниже порога заметности,
 * но достаточно, чтобы полосы рассыпались в шум.
 *
 * Некон­волюционный: живёт в одном пассе с ChromaticAberration,
 * ПОСЛЕДНИМ — после него только квантование в канвас.
 */
const fragmentShader = /* glsl */ `
  float ditherIgn(const in vec2 xy) {
    return fract(52.9829189 * fract(dot(xy, vec2(0.06711056, 0.00583715))));
  }

  void mainImage(const in vec4 inputColor, const in vec2 uv, out vec4 outputColor) {
    float noise = ditherIgn(gl_FragCoord.xy) - 0.5;
    outputColor = vec4(inputColor.rgb + noise * (1.0 / 255.0), inputColor.a);
  }
`

class DitheringEffect extends Effect {
  public constructor() {
    super('DitheringEffect', fragmentShader, { blendFunction: BlendFunction.NORMAL })
  }
}

export { DitheringEffect }
