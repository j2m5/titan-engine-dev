import type { Object3D, Texture, Vector2 } from 'three'

/**
 * Слой графа сцены для объёмов, которые рисует DepthVolumePass. Основной
 * RenderPass рисует слой 0 камеры и эти объёмы не видит; пасс включает слой на
 * камере только на время своего рендера. Рендер объёма вне пасса (запекание
 * импостора туманности) включает слой на своей камере сам.
 */
export const DEPTH_VOLUME_LAYER = 30

/**
 * Слой меша сильной зоны чёрной дыры: рисует BlackHolePass после объёмов,
 * сэмплируя копию кадра. Основной проход слой не видит; кликовый рейкастер
 * включает его у себя (Engine)
 */
export const BLACK_HOLE_LAYER = 29

/**
 * Потребитель копии кадра (BlackHolePass): перед рендером получает цвет и
 * глубину сцены, после — отвязывается, чтобы рендер вне пасса шёл без них
 */
export interface SceneFrameConsumer extends Object3D {
  bindSceneFrame(sceneColor: Texture, sceneDepth: Texture, logFarFactor: number): void
  unbindSceneFrame(): void
}

export function isSceneFrameConsumer(object: Object3D): object is SceneFrameConsumer {
  const candidate = object as Partial<SceneFrameConsumer>
  return typeof candidate.bindSceneFrame === 'function' && typeof candidate.unbindSceneFrame === 'function'
}

/**
 * Объём, чей марш режется по глубине сцены (см. DepthVolumePass).
 *
 * Живёт в графе сцены (матрицы считает основной проход), но рисуется пассом
 * после сцены. Перед рендером пасс привязывает копию глубины сцены, после —
 * отвязывает: любой другой рендер объёма (запекание) идёт без обрезки.
 */
export interface DepthVolume extends Object3D {
  /**
   * Радиус описанной сферы прокси в ЛОКАЛЬНЫХ единицах объёма (масштаб мира
   * пасс применяет сам). Порядок рисования — по дальней кромке
   * (расстояние до центра + радиус): объём, охватывающий камеру и остальные,
   * ложится первым, а не по совпадающему центру. Не задан — по центру.
   */
  readonly boundingRadius?: number
  /**
   * @param sceneDepth копия depth-текстуры сцены, лог-глубина three в .r
   * @param resolution размер таргета в пикселях: gl_FragCoord → uv копии
   * @param logFarFactor log2(far + 1) камеры — знаменатель лог-глубины three
   */
  bindSceneDepth(sceneDepth: Texture, resolution: Vector2, logFarFactor: number): void
  unbindSceneDepth(): void
}
