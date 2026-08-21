import type { Actor } from '@/core/models/Actor'

/**
 * Доступ к слою `renderingObject.data` актора.
 *
 * `IRenderingObject.data` — это `Record<string, unknown>`: схема БД не различает
 * конфиги по категориям, поэтому форма утверждается локально, там где категория
 * известна. Раньше эта пара «каст + гард» дублировалась по местам вызова
 * (Ring, RingShader, RenderableFactory, BrunetonAtmosphere) — здесь она в
 * одном месте, а сужение на стороне вызова доказывает сам tsc, без `!` и
 * без каста.
 */

/**
 * Мягкое чтение: отсутствие строки `renderingObject` — легальный случай.
 * Так живёт, например, Sgr A*: минимальная чёрная дыра описана одним
 * physicalObject, и весь её конфиг выводится из массы.
 */
function readRenderingData<TConfig>(model: Actor): TConfig | undefined {
  return model.renderingObject?.getAttribute('data') as TConfig | undefined
}

/**
 * Строгое чтение: конфиг обязателен, его отсутствие — баг данных.
 * Проверка стоит до конструирования объекта: отказ здесь ничего не аллоцирует.
 *
 * @param tag имя компонента для диагностики. Сообщения намеренно различаются:
 *   по тексту ошибки должно быть видно, какой именно слой не смог построиться
 * @param subject существительное в родительном падеже для текста ошибки —
 *   у фабрики речь идёт про кольцо, а не про абстрактного актора
 */
function requireRenderingData<TConfig>(model: Actor, tag: string, subject: string = 'актора'): TConfig {
  const data: TConfig | undefined = readRenderingData<TConfig>(model)

  if (!data) {
    throw new Error(`[${tag}] У ${subject} "${model.getAttribute('name', '?')}" отсутствует renderingObject.data`)
  }

  return data
}

export { readRenderingData, requireRenderingData }
