/**
 * Подгонка атмосферного конфига под пол рельефа терраформного тела.
 *
 * Аналитическая «земля» Брунетона — сфера bottomRadius; поверхность
 * терраформного тела — R + h(dir), и низины уходят ниже опорной сферы.
 * Горизонтный скачок шейдера тогда висит над реальным силуэтом — атмосфера
 * «отлипает» (тот же артефакт, что якорь 6d валидации закрыл для сфер).
 * Дно опускается до пола рельефа: при bottom ≤ R + min(h) силуэт в любом
 * направлении не ниже аналитического горизонта, и скачок закрыт геометрией.
 *
 * Опускание дна на d без компенсации разредило бы оптику на опорной высоте
 * в e^{−d/H} раз и увело калибровку. Компенсация по форме профиля:
 * exp-слой — коэффициенты × e^{d/H} (профиль не трогаем: плотность в шейдере
 * клампится в [0,1], масштабировать expTerm нельзя); линейный профиль
 * (озоновая «палатка») — сдвиг слоёв на d, абсолютная высота сохраняется.
 * Неопознанная форма — без компенсации: шов важнее дрейфа оптики.
 */

import { AtmosphereConfig, DensityProfileLayer } from '@/core/renderables/Atmosphere/AtmosphereConfig'
import { heightFieldStorage } from '@/core/services/HeightFieldStorage'
import { Actor } from '@/core/models/Actor'

type Profile = [DensityProfileLayer, DensityProfileLayer]
type Rgb = [number, number, number]

function isEmptyLayer(layer: DensityProfileLayer): boolean {
  return (
    layer.width === 0 &&
    layer.expTerm === 0 &&
    layer.expScale === 0 &&
    layer.linearTerm === 0 &&
    layer.constantTerm === 0
  )
}

/** Идиома expLayer(): нижний слой пуст, верхний — чистая экспонента. */
function isExpProfile(profile: Profile): boolean {
  const top = profile[1]
  return isEmptyLayer(profile[0]) && top.expTerm !== 0 && top.linearTerm === 0 && top.constantTerm === 0
}

function isLinearProfile(profile: Profile): boolean {
  return profile[0].expTerm === 0 && profile[1].expTerm === 0
}

/** Слой в новой системе высот: h_нов = h_стар + d, значения на прежних абсолютных высотах те же. */
function shiftLayer(layer: DensityProfileLayer, dKm: number, widthShift: number): DensityProfileLayer {
  return {
    width: layer.width + widthShift,
    expTerm: layer.expTerm,
    expScale: layer.expScale,
    linearTerm: layer.linearTerm,
    constantTerm: layer.constantTerm - layer.linearTerm * dKm
  }
}

function scaleRgb(rgb: Rgb, factor: number): Rgb {
  return [rgb[0] * factor, rgb[1] * factor, rgb[2] * factor]
}

/**
 * Компенсация одного вещества: exp-профиль масштабирует коэффициенты,
 * линейный — сдвигает слои. Возвращает пару «профиль + коэффициенты».
 */
function adjustSpecies(profile: Profile, coefficients: Rgb[], dKm: number): { profile: Profile; coefficients: Rgb[] } {
  if (isEmptyLayer(profile[0]) && isEmptyLayer(profile[1])) {
    return { profile, coefficients }
  }

  if (isExpProfile(profile)) {
    const factor = Math.exp(dKm * -profile[1].expScale)
    return { profile, coefficients: coefficients.map((c) => scaleRgb(c, factor)) }
  }

  if (isLinearProfile(profile)) {
    // Граница слоёв width — тоже высота: сдвигается только у нижнего слоя,
    // верхний свой width (неиспользуемый ноль) сохраняет
    return {
      profile: [shiftLayer(profile[0], dKm, dKm), shiftLayer(profile[1], dKm, 0)],
      coefficients
    }
  }

  return { profile, coefficients }
}

/**
 * Опускает дно атмосферы до пола рельефа (floorMeters — минимум карты высот,
 * метры) с компенсацией оптики на опорной сфере. Пол ≥ 0 — конфиг как есть:
 * дно никогда не поднимается, иначе горизонтный скачок вылезет из-за силуэта.
 */
export function adjustAtmosphereForTerrainFloor(config: AtmosphereConfig, floorMeters: number): AtmosphereConfig {
  if (floorMeters >= 0) return config

  const dKm = -floorMeters / 1000

  const rayleigh = adjustSpecies(config.rayleighDensity, [config.rayleighScattering], dKm)
  const mie = adjustSpecies(config.mieDensity, [config.mieScattering, config.mieExtinction], dKm)
  const absorption = adjustSpecies(config.absorptionDensity, [config.absorptionExtinction], dKm)

  return {
    ...config,
    bottomRadius: config.bottomRadius - dKm,
    rayleighDensity: rayleigh.profile,
    rayleighScattering: rayleigh.coefficients[0],
    mieDensity: mie.profile,
    mieScattering: mie.coefficients[0],
    mieExtinction: mie.coefficients[1],
    absorptionDensity: absorption.profile,
    absorptionExtinction: absorption.coefficients[0]
  }
}

/**
 * Пол рельефа родительской планеты в метрах (≤ 0). Тело без карты — 0:
 * легаси-сфера сидит ровно на bottomRadius, шов закрыт прежним равенством.
 */
export function terrainFloorMetersFor(actor: Actor): number {
  const parent = actor.parent

  if (!parent) return 0

  const path = parent.resources.where('resourceType', 'height').first()?.getAttribute('path')
  const map = typeof path === 'string' ? heightFieldStorage.get(path) : undefined

  return map ? Math.min(0, map.minMeters) : 0
}
