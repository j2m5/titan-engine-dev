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
 * exp-слой — expTerm × e^{d/H} (профиль сдвигается вниз вместе с дном);
 * линейный профиль (озоновая «палатка») — сдвиг слоёв на d, абсолютная
 * высота сохраняется. Неопознанная форма — без компенсации: шов важнее
 * дрейфа оптики.
 *
 * Компенсация живёт в ПРОФИЛЕ, а не в коэффициентах, и это несущее решение,
 * а не вкус (хотфикс 2026-08-17). Шейдер ведёт луч до аналитического дна,
 * поэтому слой между дном и датумом лежит под реальной поверхностью, но всё
 * равно попадает в интеграл. С множителем в коэффициентах его толща росла как
 * β·H·(e^{d/H}−1): у тел с глубоким рельефом и тонкой дымкой (Татуин d/H≈12.9)
 * это τ≈2·10³ — диск заливало непрозрачной мглой. В профиле тот же множитель
 * упирается в кламп плотности [0,1] шейдерного GetLayerDensity: под датумом
 * ρ≡1, толща линейна (τ = β·d), а над датумом произведение β·ρ тождественно
 * исходному — вид атмосферы сохраняется точно.
 */

import { AtmosphereConfig, DensityProfileLayer } from '@/core/renderables/Atmosphere/AtmosphereConfig'

type Profile = [DensityProfileLayer, DensityProfileLayer]

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

/**
 * Компенсация одного вещества: exp-профиль растит expTerm (кламп плотности
 * шейдера держит подповерхностный слой на ρ=1), линейный — сдвигает слои.
 * Коэффициенты не трогаются ни в одном случае — они паспорт вещества.
 */
function adjustSpecies(profile: Profile, dKm: number): Profile {
  if (isEmptyLayer(profile[0]) && isEmptyLayer(profile[1])) return profile

  if (isExpProfile(profile)) {
    // Верхний слой — та же экспонента в новой системе высот: множитель e^{d/H}
    // компенсируется сдвигом координаты, поэтому НАД датумом плотность
    // тождественна исходной (E·e^{d/H}·e^{−(a+d)/H} = E·e^{−a/H}).
    //
    // Нижний слой — нулевая прокладка ровно до датума. Без неё под датумом
    // работала бы та же раздутая экспонента, кламп [0,1] шейдерного
    // GetLayerDensity держал бы её на ρ≡1, и подповерхностный слой попадал бы
    // в интеграл КАЖДОГО луча к диску планеты. Вертикально это давало τ = β·d,
    // но луч к лимбу проходит тот же слой вдоль хорды 2·√(2Rd) — у Татуина
    // (R=5232 км, d=15.5 км) в 52 раза длиннее, у Земли при поле −11 км в 68.
    // Отсюда пересвет: толща в надире у Татуина росла втрое, пропускание в
    // синем падало 0.77 → 0.46. С прокладкой вклад ровно нулевой при любом
    // наклоне луча, а заявка «над датумом вид сохраняется точно» становится
    // верной не только для вертикали.
    const factor = Math.exp(dKm * -profile[1].expScale)

    return [
      { width: dKm, expTerm: 0, expScale: 0, linearTerm: 0, constantTerm: 0 },
      { ...profile[1], expTerm: profile[1].expTerm * factor }
    ]
  }

  if (isLinearProfile(profile)) {
    // Граница слоёв width — тоже высота: сдвигается только у нижнего слоя,
    // верхний свой width (неиспользуемый ноль) сохраняет
    return [shiftLayer(profile[0], dKm, dKm), shiftLayer(profile[1], dKm, 0)]
  }

  return profile
}

/**
 * Опускает дно атмосферы до пола рельефа (floorMeters — самая низкая точка
 * рельефа родителя, метры; источник — `AtmosphereConfig.terrainFloorMeters`,
 * см. её докблок) с компенсацией оптики на опорной сфере. Дно никогда не
 * ПОДНИМАЕТСЯ: иначе горизонтный скачок вылезет из-за силуэта.
 *
 * Проверка полная (тип + конечность + знак), а не просто `floorMeters >= 0`:
 * значение приходит из БД, где типов нет, и сигнатура `number` тут обещание,
 * а не гарантия. `NaN >= 0` — false, то есть мусор проехал бы дальше и осел
 * в LUT неотличимо от чёрного экрана; ЧИСЛОВАЯ СТРОКА (`'-8174.25'`) обманула
 * бы и форму `!(x < 0)` — JS приводит её к числу при сравнении, так что одним
 * отрицанием тут не обойтись (поймано тестом на нечисловой пол).
 */
export function adjustAtmosphereForTerrainFloor(config: AtmosphereConfig, floorMeters: number): AtmosphereConfig {
  if (typeof floorMeters !== 'number' || !Number.isFinite(floorMeters) || floorMeters >= 0) return config

  const dKm = -floorMeters / 1000

  return {
    ...config,
    bottomRadius: config.bottomRadius - dKm,
    rayleighDensity: adjustSpecies(config.rayleighDensity, dKm),
    mieDensity: adjustSpecies(config.mieDensity, dKm),
    absorptionDensity: adjustSpecies(config.absorptionDensity, dKm)
  }
}
