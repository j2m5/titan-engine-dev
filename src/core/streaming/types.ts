/** Карта-кандидат на стриминг: один streamable-ресурс одного видимого тела. */
export interface MapCandidate {
  actorId: number
  /** Имя актора: по нему рендерабл ищется в графе сцены. */
  name: string
  /** Ключ реестра текстур. */
  path: string
  /** `MAP_TYPE_RANK[resourceType]` — слой значимости карты, рельеф раньше косметики. */
  typeRank: number
  /**
   * Радиус тела, делённый на расстояние до камеры.
   *
   * Монотонно связано с угловым размером на экране, то есть с числом пикселей,
   * которые займёт текстура. Расстояние до камеры само по себе не годится:
   * Сатурн, наблюдаемый с Мимаса, дальше Мимаса, но занимает пол-неба.
   */
  actorPriority: number
}

/** Что загрузить и что вытеснить по итогам одного решения. */
export interface StreamDecision {
  /** Порядок: `(typeRank asc, actorPriority desc)` — рельеф и ближнее раньше. */
  load: MapCandidate[]
  /** Зеркальный порядок: младшие слои дальних тел вытесняются первыми. */
  evict: MapCandidate[]
  /**
   * Пути, заслужившие резидентность по слою и бюджету сами по себе — по
   * путям, а не по акторам: единица бюджета теперь карта, а не тело. Не то
   * же самое, что «есть в `load`»: путь может быть в `wantedPaths`, но уже
   * загружен или временно исключён после провала. Поле нужно, чтобы отличить
   * «ещё в зоне приоритета, просто заблокирован» от «покинул зону» и решить,
   * когда снимать блокировку повторной попытки.
   *
   * `load ⊆ wantedPaths` (по путям) — структурная гарантия. `wantedPaths` и
   * `evict` не пересекаются, только пока вызывающий код не считает один путь
   * одновременно резидентным и исключённым.
   */
  wantedPaths: Set<string>
}

/**
 * Порядок значимости слоёв карты тела — решение владельца «рельеф важнее»:
 * diffuse > slope > detail* > cloud > night > specular.
 *
 * Внутри detail-слоя (2.0–2.3) суб-ранги идут по гейт-значимости, не по
 * алфавиту: материал (см. PlanetMaterial) гейтит ВЕСЬ detail-набор по
 * наличию detailNormal — без него detailDiffuse в бюджете мёртв (видимого
 * эффекта ноль), поэтому detailNormal ранжирован первым внутри слоя и при
 * тесном бюджете влезает раньше diffuse-компаньона детейла.
 * `height` сюда не входит: он resident и стримеру не виден.
 */
export const MAP_TYPE_RANK: Readonly<Record<string, number>> = {
  diffuse: 0,
  slope: 1,
  detailNormal: 2.0,
  detailArm: 2.1,
  detailDiffuse: 2.2,
  detailNormal2: 2.3,
  cloud: 3,
  night: 4,
  specular: 5
}

/** Ранг неизвестного типа карты — после `specular`, в самом хвосте. */
const UNKNOWN_MAP_TYPE_RANK: number = 5.5

/**
 * Ранг типа карты. Неизвестный streamable-тип получает {@link UNKNOWN_MAP_TYPE_RANK}
 * и dev-warn вместо броска: почти-последний слой безопаснее падения стриминга,
 * а предупреждение в деве укажет чинить таблицу `MAP_TYPE_RANK`.
 */
export function mapTypeRank(resourceType: string): number {
  const rank: number | undefined = MAP_TYPE_RANK[resourceType]

  if (rank !== undefined) return rank

  if (import.meta.env.DEV) {
    console.warn(`mapTypeRank: неизвестный тип карты "${resourceType}", ранг по умолчанию ${UNKNOWN_MAP_TYPE_RANK}`)
  }

  return UNKNOWN_MAP_TYPE_RANK
}
