import { ClampToEdgeWrapping, DataTexture, LinearFilter, RGBAFormat, UnsignedByteType } from 'three'

/**
 * 1D-текстура полос кольца (RGBA по бинам радиуса) и средний цвет полос.
 *
 * RGB — цвет полосы: тинт альбедо камней относительно среднего цвета, чтобы
 * вблизи камни несли ту же палитру, что кольцо издали. A — альфа полосы:
 * оптическая толща слоя по нормали для самозатенения камней и пыли (чанк
 * RingDust). Средний цвет взвешен по альфе — пустоты кольцо не красят.
 * Маппинг u — тот же, что у RingShader: u = (r − inner) / (outer − inner).
 */
const createRingBandTexture = (
  color: Float32Array,
  alpha: Float32Array
): { texture: DataTexture; meanColor: [number, number, number] } | null => {
  const bins = alpha.length
  if (bins === 0 || color.length !== bins * 3) return null

  let weight = 0
  const mean = [0, 0, 0]
  for (let i = 0; i < bins; i++) {
    weight += alpha[i]
    for (let k = 0; k < 3; k++) mean[k] += color[i * 3 + k] * alpha[i]
  }
  if (weight <= 0) return null

  const bytes = new Uint8Array(bins * 4)
  for (let i = 0; i < bins; i++) {
    for (let k = 0; k < 3; k++) bytes[i * 4 + k] = Math.round(color[i * 3 + k] * 255)
    bytes[i * 4 + 3] = Math.round(alpha[i] * 255)
  }

  const texture = new DataTexture(bytes, bins, 1, RGBAFormat, UnsignedByteType)
  texture.magFilter = LinearFilter
  texture.minFilter = LinearFilter
  texture.wrapS = ClampToEdgeWrapping
  texture.wrapT = ClampToEdgeWrapping
  texture.generateMipmaps = false
  texture.needsUpdate = true
  texture.name = 'RingBandProfile'

  return { texture, meanColor: [mean[0] / weight, mean[1] / weight, mean[2] / weight] }
}

export { createRingBandTexture }
