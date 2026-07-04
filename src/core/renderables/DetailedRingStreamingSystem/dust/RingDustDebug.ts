import { RingDustVolume } from './RingDustVolume'

/** Uniform-подмножество материала камней, нужное kill-switch'у фога */
interface RockDustUniforms {
  uDustDensity: { value: number }
}

interface RingDustDebugTarget {
  volume: RingDustVolume
  rockUniforms: RockDustUniforms[]
}

/** Диагностический хендл пыли кольца (dev-консоль) */
interface RingDustDebugHandle {
  /** 0 выкл, 1 τ false-color, 2 alpha, 3 гейт, 4 теплокарта шагов */
  setDebugMode(mode: 0 | 1 | 2 | 3 | 4): void
  /** Kill-switch объёма-гало (камни не трогает) */
  setVolumeEnabled(on: boolean): void
  /** Kill-switch аэроперспективы камней (объём не трогает) */
  setRockFogEnabled(on: boolean): void
}

declare global {
  interface Window {
    __titanRingDust?: RingDustDebugHandle
  }
}

/**
 * Вешает диагностический хендл пыли на window.__titanRingDust.
 *
 * Главный урок попытки №1: причину визуальных артефактов искать отключением
 * слоёв по одному и false-color визуализацией, а не кручением модели.
 */
const installRingDustDebug = (target: RingDustDebugTarget): void => {
  const savedDensities = target.rockUniforms.map((u) => u.uDustDensity.value)

  window.__titanRingDust = {
    setDebugMode(mode) {
      target.volume.dustMaterial.uniforms.uDustDebugMode.value = mode
    },
    setVolumeEnabled(on) {
      target.volume.visible = on
    },
    setRockFogEnabled(on) {
      target.rockUniforms.forEach((u, i) => {
        u.uDustDensity.value = on ? savedDensities[i] : 0
      })
    }
  }
}

export { installRingDustDebug }
export type { RingDustDebugHandle, RingDustDebugTarget, RockDustUniforms }
