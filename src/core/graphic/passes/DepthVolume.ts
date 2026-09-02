import type { Object3D, Texture, Vector2 } from 'three'

/**
 * Слой графа сцены для объёмов, которые рисует DepthVolumePass. Основной
 * RenderPass рисует слой 0 камеры и эти объёмы не видит; пасс включает слой на
 * камере только на время своего рендера. Рендер объёма вне пасса (запекание
 * импостора туманности) включает слой на своей камере сам.
 */
export const DEPTH_VOLUME_LAYER = 30

/**
 * Объём, чей марш режется по глубине сцены (см. DepthVolumePass).
 *
 * Живёт в графе сцены (матрицы считает основной проход), но рисуется пассом
 * после сцены. Перед рендером пасс привязывает копию глубины сцены, после —
 * отвязывает: любой другой рендер объёма (запекание) идёт без обрезки.
 */
export interface DepthVolume extends Object3D {
  /**
   * @param sceneDepth копия depth-текстуры сцены, лог-глубина three в .r
   * @param resolution размер таргета в пикселях: gl_FragCoord → uv копии
   * @param logFarFactor log2(far + 1) камеры — знаменатель лог-глубины three
   */
  bindSceneDepth(sceneDepth: Texture, resolution: Vector2, logFarFactor: number): void
  unbindSceneDepth(): void
}
