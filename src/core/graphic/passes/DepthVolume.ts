import type { BufferGeometry, Camera, Mesh, Object3D, ShaderMaterial, Texture, Vector2 } from 'three'

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
 * Слой оверлеев (линии орбит): рисует OverlayPass поверх уже лензированного
 * кадра, чтобы схематичные линии не искривлялись линзами чёрной дыры.
 * Основной проход слой не видит
 */
export const OVERLAY_LAYER = 28

/**
 * Слой прозрачного перед линзой: LensFrontSorter переносит сюда на один кадр
 * прозрачные объекты тел, стоящих перед активной чёрной дырой; LensFrontPass
 * рисует их поверх лензированного кадра и возвращает на слой 0. Основной
 * проход слой не видит
 */
export const LENS_FRONT_LAYER = 27

/**
 * Второй слой перенесённых объектов, пишущих глубину (препасс кольца,
 * билборды камней): LensFrontPass дописывает их глубину в буфер с глубиной
 * сцены — её читают атмосфера и копия для объёмов
 */
export const LENS_FRONT_DEPTH_LAYER = 26

/**
 * Потребитель копии кадра (BlackHolePass): перед рендером получает цвет и
 * глубину сцены, после — отвязывается, чтобы рендер вне пасса шёл без них
 */
export interface SceneFrameConsumer extends Object3D {
  /** skyLayer — слой видимого неба кадра (SkyLayer), того же размера, что копии */
  bindSceneFrame(sceneColor: Texture, sceneDepth: Texture, skyLayer: Texture, logFarFactor: number): void
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
  /** Opt in to a shared render/resolve for consecutive direct transparent draws.
   * Bind/unbind and object callbacks may only refresh this draw's uniforms;
   * they must not mutate other volumes, renderer state or invoke nested renders.
   * Material callbacks, children, shared materials and scaled/temporal draws
   * keep their separate render boundaries. Original object callback roots remain. */
  readonly supportsDepthVolumeBatch?: boolean
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

/** Optional capability: reconstruct a reduced image, raymarching depth edges natively. */
export interface ScaledDepthVolume extends DepthVolume {
  readonly resolutionScale: number
  bindLowResolution(texture: Texture, size: Vector2): void
  unbindLowResolution(): void
}

export function isScaledDepthVolume(volume: DepthVolume): volume is ScaledDepthVolume {
  const candidate = volume as Partial<ScaledDepthVolume>
  return typeof candidate.resolutionScale === 'number' &&
    typeof candidate.bindLowResolution === 'function' && typeof candidate.unbindLowResolution === 'function'
}

/** Opt-in shader modes DEPTH_VOLUME_RECONSTRUCT / DEPTH_VOLUME_FALLBACK.
 * A closed BackSide proxy covers each pixel once; depth comes from the scene sampler.
 * Callbacks must only refresh the current draw's uniforms (as for a multipass material). */
export type StencilDepthVolume = ScaledDepthVolume & Mesh<BufferGeometry, ShaderMaterial> & {
  readonly supportsStencilReconstruction: true
  /** MSAA composition is safe only when every viewport sample has proxy coverage. */
  coversReconstructionViewport?(camera: Camera): boolean
}

export function isStencilDepthVolume(volume: DepthVolume): volume is StencilDepthVolume {
  const candidate = volume as Partial<StencilDepthVolume>
  return isScaledDepthVolume(volume) && candidate.supportsStencilReconstruction === true &&
    candidate.isMesh === true && candidate.material?.isShaderMaterial === true
}

/** Optional local-position metadata for independent, per-volume history. */
export interface TemporalDepthVolume extends ScaledDepthVolume {
  readonly temporalBlend: number
  readonly temporalRevision: number
  bindTemporalCapture(jitter: number): void
  unbindTemporalCapture(): void
}

export function isTemporalDepthVolume(volume: DepthVolume): volume is TemporalDepthVolume {
  const candidate = volume as Partial<TemporalDepthVolume>
  return isScaledDepthVolume(volume) && typeof candidate.temporalBlend === 'number' &&
    typeof candidate.temporalRevision === 'number' && typeof candidate.bindTemporalCapture === 'function' &&
    typeof candidate.unbindTemporalCapture === 'function'
}
