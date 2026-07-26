import type { PerspectiveCamera } from 'three'

/**
 * Пер-кадровый контекст обновления сцены. Формируется Engine один раз за
 * кадр и прокидывается в updateObject каждого объекта — заменяет прямой
 * доступ renderables к глобальному timeStore и к глобальному threeJS.
 */
export interface UpdateContext {
  delta: number
  epoch: number
  /** Секунд с запуска часов рендера; было threeJS.clock.getElapsedTime() */
  elapsed: number
  /** Активная камера кадра; было threeJS.camera */
  camera: PerspectiveCamera
}
