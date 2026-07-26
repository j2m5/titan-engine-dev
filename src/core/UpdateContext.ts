import type { PerspectiveCamera } from 'three'

/**
 * Пер-кадровый контекст обновления сцены. Формируется Engine один раз за
 * кадр и прокидывается в updateObject каждого объекта — избавляет renderables
 * от прямого доступа к глобальному состоянию времени и рендер-слоя.
 */
export interface UpdateContext {
  delta: number
  epoch: number
  /** Секунд с запуска часов рендера */
  elapsed: number
  /** Активная камера кадра */
  camera: PerspectiveCamera
}
