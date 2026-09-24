/**
 * Пульсар: гало и LOD точки — те же, что у белого карлика (тело и импостор
 * общие с ним); лучи-маяк живут в данных актора, конфига не имеют.
 */
export interface PulsarConfig {
  pulsar: {
    /** Гистерезис LOD — доля дистанции переключения */
    lodHysteresis: number
    /** Прозрачность спрайта-ореола (StarInnerLayer); 0 гасит слой */
    haloOpacity: number
    /** Масштаб спрайта-ореола относительно звёздного */
    haloScale: number
  }
}

export const pulsar: PulsarConfig = {
  pulsar: {
    lodHysteresis: 0.05,
    haloOpacity: 0.05,
    haloScale: 0.45
  }
}
