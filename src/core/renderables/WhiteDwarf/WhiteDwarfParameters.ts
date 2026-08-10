import { Actor } from '@/core/models/Actor'
import { readRenderingData } from '@/core/helpers/renderingData'
import { IWhiteDwarfRenderingObject } from '@/core/models/types'

/** Медианный карлик поля: большинство наблюдаемых лежит между 8 и 20 kK */
export const WHITE_DWARF_DEFAULT_TEMPERATURE_K: number = 15000

/**
 * Калибровочный множитель яркости тела: НЕ физика, а посадка в HDR-коридор
 * движка.
 *
 * Честное отношение планковских функций даёт Sirius B около 214 при коридоре
 * [1, 64] и пороге блума 1. Формально это правда — поверхностная яркость там
 * действительно в полсотни раз солнечной, — но блум с девятью мипами, радиусом
 * 0.95 и SCREEN-смешиванием превращал её в белую заливку всего кадра, а не в
 * яркий диск.
 *
 * Половина выбрана как ровно вдвое: вместе с опущенным до 32 WD_HDR_CEILING
 * она даёт ровно половинную яркость ОБОИМ карликам сразу — горячему, который
 * упирается в потолок, и холодному, который до него не достаёт, — и сохраняет
 * отношение яркостей между ними. По отдельности ни одна из двух правок этого
 * не делает.
 *
 * Отделена от exposureBias намеренно: та ручка остаётся нейтральной (1) и
 * означает «поверх откалиброванного уровня», а не «поверх честной физики».
 */
export const WHITE_DWARF_DISPLAY_SCALE: number = 0.5

export interface WhiteDwarfParameters {
  temperature: number
  exposureBias: number
}

const DEFAULTS: Omit<WhiteDwarfParameters, 'temperature'> = {
  /**
   * Множитель поверх ОТКАЛИБРОВАННОГО уровня (WHITE_DWARF_DISPLAY_SCALE), а не
   * поверх честной физики: единица — нейтральное значение, а не «как в
   * природе». Горячий карлик и при ней упирается в потолок HDR и выходит ровно
   * белым — это ожидаемо. Ноль гасит тело.
   */
  exposureBias: 1
}

/**
 * Параметры карлика из данных актора с дефолтами.
 *
 * Ручек мало намеренно: цвет, яркость и лимбовое потемнение выводятся из
 * температуры физического объекта (см. planckX и visibleBandRadianceRatio),
 * а не задаются здесь — иначе их можно было бы развести между собой и получить
 * тело, у которого цвет не соответствует яркости.
 *
 * Ловушка: `??` вместо `||` принципиален — нулевые значения (погашенный диск,
 * выключенная вуаль) обязаны переживать чтение.
 */
export function whiteDwarfParameters(actor: Actor): WhiteDwarfParameters {
  const data: IWhiteDwarfRenderingObject = readRenderingData<IWhiteDwarfRenderingObject>(actor) ?? {}

  return {
    temperature:
      actor.physicalObject?.getAttribute('temperature', WHITE_DWARF_DEFAULT_TEMPERATURE_K) ??
      WHITE_DWARF_DEFAULT_TEMPERATURE_K,
    // Кламп снизу: отрицательный множитель дал бы отрицательную светимость,
    // которую потолок HDR не ловит — он ограничивает только сверху
    exposureBias: Math.max(data.exposureBias ?? DEFAULTS.exposureBias, 0)
  }
}
