/**
 * Пер-кадровый контекст обновления сцены. Формируется Engine один раз за
 * кадр и прокидывается в updateObject каждого объекта — заменяет прямой
 * доступ renderables к глобальному timeStore.
 */
export interface UpdateContext {
  delta: number
  epoch: number
}
