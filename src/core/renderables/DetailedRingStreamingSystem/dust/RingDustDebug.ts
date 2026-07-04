import { RingDustVolume } from './RingDustVolume'

/** Uniform-подмножество материала камней, нужное kill-switch'у и живой подстройке */
interface RockDustUniforms {
  uDustDensity: { value: number }
  uDustScaleHeight?: { value: number }
  uDustNearFade?: { value: number }
  uDustAnglePower?: { value: number }
}

/** Живо-настраиваемые ручки модели пыли (для отладки в консоли) */
interface RingDustTunables {
  density: number
  scaleHeight: number
  nearFade: number
  anglePower: number
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
  /** Живая подстройка модели: пишет в объём И в материалы камней (общая модель) */
  set(params: Partial<RingDustTunables>): void
  /** Снимок фактического состояния: юниформы объёма, флаги меша, плотности камней */
  dump(): Record<string, unknown>
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
    },
    set(params) {
      const vu = target.volume.dustMaterial.uniforms
      if (params.density !== undefined) {
        vu.uDustDensity.value = params.density
        target.rockUniforms.forEach((u) => (u.uDustDensity.value = params.density!))
        // держим kill-switch-снимок в согласии с новой плотностью
        savedDensities.fill(params.density)
      }
      if (params.scaleHeight !== undefined) {
        vu.uDustScaleHeight.value = params.scaleHeight
        target.rockUniforms.forEach((u) => u.uDustScaleHeight && (u.uDustScaleHeight.value = params.scaleHeight!))
      }
      if (params.nearFade !== undefined) {
        vu.uDustNearFade.value = params.nearFade
        target.rockUniforms.forEach((u) => u.uDustNearFade && (u.uDustNearFade.value = params.nearFade!))
      }
      if (params.anglePower !== undefined) {
        vu.uDustAnglePower.value = params.anglePower
        target.rockUniforms.forEach((u) => u.uDustAnglePower && (u.uDustAnglePower.value = params.anglePower!))
      }
    },
    dump() {
      const u = target.volume.dustMaterial.uniforms
      return {
        volume: {
          visible: target.volume.visible,
          renderOrder: target.volume.renderOrder,
          frustumCulled: target.volume.frustumCulled,
          parentChain: (() => {
            const chain: string[] = []
            let o = target.volume.parent
            while (o) {
              chain.push(`${o.name || o.type}(visible=${o.visible})`)
              o = o.parent
            }
            return chain.join(' <- ')
          })()
        },
        uniforms: {
          density: u.uDustDensity.value,
          scaleHeight: u.uDustScaleHeight.value,
          ringInner: u.uDustRingInner.value,
          ringOuter: u.uDustRingOuter.value,
          anglePower: u.uDustAnglePower.value,
          nearFade: u.uDustNearFade.value,
          maxSteps: u.uDustMaxSteps.value,
          debugMode: u.uDustDebugMode.value,
          camRingPos: u.uDustCamRingPos.value.toArray(),
          lightDirRing: u.uDustLightDirRing.value.toArray()
        },
        rockDensities: target.rockUniforms.map((r) => r.uDustDensity.value)
      }
    }
  }
}

export { installRingDustDebug }
export type { RingDustDebugHandle, RingDustDebugTarget, RockDustUniforms, RingDustTunables }
