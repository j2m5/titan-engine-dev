/**
 * Пульсар: LOD точки — тот же, что у белого карлика (тело и импостор
 * общие с ним); лучи-маяк живут в данных актора, конфига не имеют.
 */
export interface PulsarConfig {
  pulsar: {
    /** Гистерезис LOD — доля дистанции переключения */
    lodHysteresis: number
  }
}

export const pulsar: PulsarConfig = {
  pulsar: {
    lodHysteresis: 0.05
  }
}
