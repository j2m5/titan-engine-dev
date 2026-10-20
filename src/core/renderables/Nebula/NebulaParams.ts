import { Color, Vector3 } from 'three'

export type DeepPartial<T> = {
  [K in keyof T]?: T[K] extends object ? DeepPartial<T[K]> : T[K]
}

/**
 * Порядок значений несущий: он же кодирует uShape для шейдера (см.
 * NEBULA_SHAPE_IDS). Вставлять новую форму в СЕРЕДИНУ нельзя — сдвинет коды у
 * всех последующих.
 */
export type NebulaShape = 'ellipsoid' | 'disk' | 'shell' | 'torus' | 'hourglass'

/** Код формы для uShape. Единственное место соответствия имени и числа */
export const NEBULA_SHAPE_IDS: Readonly<Record<NebulaShape, number>> = {
  ellipsoid: 0,
  disk: 1,
  shell: 2,
  torus: 3,
  hourglass: 4
}
export type NebulaLOD = 'raymarch' | 'impostor' | 'auto'

export interface ColorStop {
  t: number // 0..1 position along density
  color: Color
}

export interface NebulaLobe {
  center: Vector3 // local space, components in [-1, 1]
  radius: number // local units
  weight: number // contribution multiplier
  seed: number
}

export interface NebulaCavity {
  center: Vector3 // local space
  radius: number
  strength: number // 0..1 carve amount
}

export interface NebulaParams {
  seed: number

  size: number // proxy half-extent, Three.js units
  shape: NebulaShape
  /**
   * Толщина формы в локальных единицах. Смысл РАЗНЫЙ у разных форм, и это не
   * экономия, а следствие того, что формы взаимоисключающие — живёт всегда
   * ровно одно значение:
   *  - shell: доля радиуса, занятая стенкой (внутренняя кромка на 1 - t);
   *  - torus: радиус трубы, кольцо тогда радиуса 1 - t (труба касается границы);
   *  - hourglass: радиус талии в самом узком месте;
   *  - ellipsoid, disk: не используется вовсе.
   */
  shapeThickness: number
  /**
   * Поворот ФОРМЫ, эйлеровы углы XYZ в радианах. Применяется ДО axisRatios,
   * поэтому сплющивание идёт по собственным осям формы, а не по осям прокси.
   * Нули — тождественность, поведение до появления ручки.
   *
   * Ловушка, стоившая одной итерации на Ring Nebula: раз сплющивание живёт в
   * системе ФОРМЫ, у наклонённого тора оно пережимает трубу, и кольцо рвётся —
   * часть его уходит за пределы трубы и пропадает. У тора собственная толщина
   * уже есть (shapeThickness), поэтому наклонённому кольцу axisRatios обычно не
   * нужны вовсе; наклон задаётся отсюда.
   */
  shapeRotation: Vector3
  axisRatios: Vector3 // anisotropy (x,y,z)
  edgeFalloff: number
  density: number // gas amount per unit of local path length
  gas: {
    absorption: number // gas extinction multiplier, independent of emission
  }
  structure: {
    direction: Vector3 // unoriented unit axis in object/proxy-local coordinates
    stretch: number // 1 = isotropic, up to 16; affects internal gas/dust noise
  }

  lobes: NebulaLobe[]
  cavities: NebulaCavity[]
  noise: {
    octaves: number
    frequency: number
    lacunarity: number
    gain: number
    warpStrength: number
    /**
     * Варп самого контура формы, 0..1: граница считается в точке p + boundaryWarp·w,
     * где w — двухоктавный вектор домен-варпа в исходных координатах. При
     * structure.stretch=1 он переиспользуется шумом. 0 — аналитический контур.
     */
    boundaryWarp: number
    ridged: number // 0..1 billow<->ridged mix
    contrast: number
    worleyStrength: number // 0..1 Worley cell-wall carving (GPU-only filaments)
  }

  palette: {
    stops: ColorStop[]
    secondary: Color
    secondaryThreshold: number
    emissiveIntensity: number
    /**
     * Доля радиального тона в итоговом цвете. 0 — цвет ведёт ОДНА плотность,
     * ровно как до появления этой ручки.
     *
     * Плотность отвечает на вопрос «насколько густо», а у планетарной
     * туманности цвет отвечает на другой — «насколько ионизовано», и это
     * величина радиальная: O III рядом со звездой, H-alpha дальше, [N II] на
     * самой кромке. Подменять одно другим можно только пока плотность и радиус
     * скоррелированы; у оболочки с узлами по всему объёму эта подмена течёт.
     */
    radialMix: number
    /** Тон у центра (сильная ионизация). Не используется при radialMix = 0 */
    innerColor: Color
    /** Тон у внешней кромки (слабая ионизация). Не используется при radialMix = 0 */
    outerColor: Color
  }

  dust: {
    strength: number
    threshold: number
    color: Color
    seed: number | null // null inherits the nebula seed
    frequency: number
    contrast: number
  }

  lighting: {
    starPosition: Vector3 | null // world space
    scatterStrength: number
    ambient: number
    /** Цвет рассеянного света звезды; null — белый (scatter красит палитру как раньше) */
    color: Color | null
    /** Радиус спада scatter от звезды, локальные единицы [-1,1]; 0 — спада нет */
    falloffRadius: number
    /** null keeps legacy hemispheric lighting; otherwise HG g in [-0.9,0.9]. */
    anisotropy: number | null
    /** Scale light-path optical depth, [0,1]; 0 skips self-shadowing. */
    shadowStrength: number
  }

  quality: {
    maxSteps: number
    lightSteps: number // midpoint samples toward the star, integer [1,16]
    resolutionScale: number
    /** Previous-frame weight, [0,0.95]; 0 keeps static sampling without history. */
    temporalBlend: number
    forceLOD: NebulaLOD
    bake3DTexture: boolean
    bakeResolution: number
  }
}

function clamp(v: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, v))
}

function cloneNebulaParams(src: NebulaParams): NebulaParams {
  return {
    seed: src.seed,
    size: src.size,
    shape: src.shape,
    shapeThickness: src.shapeThickness,
    shapeRotation: src.shapeRotation.clone(),
    axisRatios: src.axisRatios.clone(),
    edgeFalloff: src.edgeFalloff,
    density: src.density,
    gas: { ...src.gas },
    structure: { direction: src.structure.direction.clone(), stretch: src.structure.stretch },
    lobes: src.lobes.map((l) => ({ center: l.center.clone(), radius: l.radius, weight: l.weight, seed: l.seed })),
    cavities: src.cavities.map((c) => ({ center: c.center.clone(), radius: c.radius, strength: c.strength })),
    noise: { ...src.noise },
    palette: {
      stops: src.palette.stops.map((s) => ({ t: s.t, color: s.color.clone() })),
      secondary: src.palette.secondary.clone(),
      secondaryThreshold: src.palette.secondaryThreshold,
      emissiveIntensity: src.palette.emissiveIntensity,
      radialMix: src.palette.radialMix,
      innerColor: src.palette.innerColor.clone(),
      outerColor: src.palette.outerColor.clone()
    },
    dust: { ...src.dust, color: src.dust.color.clone() },
    lighting: {
      starPosition: src.lighting.starPosition ? src.lighting.starPosition.clone() : null,
      scatterStrength: src.lighting.scatterStrength,
      ambient: src.lighting.ambient,
      color: src.lighting.color ? src.lighting.color.clone() : null,
      falloffRadius: src.lighting.falloffRadius,
      anisotropy: src.lighting.anisotropy,
      shadowStrength: src.lighting.shadowStrength
    },
    quality: { ...src.quality }
  }
}

export function makeDefaultNebulaParams(): NebulaParams {
  return {
    seed: 1337,
    size: 1000,
    shape: 'ellipsoid',
    shapeThickness: 0.35,
    shapeRotation: new Vector3(0, 0, 0),
    axisRatios: new Vector3(1, 0.8, 1),
    edgeFalloff: 0.35,
    density: 4.0,
    gas: { absorption: 1 },
    structure: { direction: new Vector3(0, 1, 0), stretch: 1 },
    lobes: [],
    cavities: [],
    noise: {
      octaves: 5,
      frequency: 1.6,
      lacunarity: 2.0,
      gain: 0.5,
      warpStrength: 0.35,
      boundaryWarp: 0,
      ridged: 0.4,
      contrast: 1.6,
      worleyStrength: 0.4
    },
    palette: {
      // Soft, muted blue-green family (not neon): deep teal-blue core -> muted teal
      // -> soft aqua-green -> pale mint highlight. Reads natural rather than surreal.
      stops: [
        { t: 0.0, color: new Color(0x06141c) },
        { t: 0.45, color: new Color(0x1f6b66) },
        { t: 0.8, color: new Color(0x4cbfa6) },
        { t: 1.0, color: new Color(0xbdeede) }
      ],
      // soft cool blue accent in dense regions -> gentle blue<->green multichromy
      secondary: new Color(0x5aa0d8),
      secondaryThreshold: 0.6,
      emissiveIntensity: 1.6,
      // Ноль — несущий дефолт: чанк цвета общий на все туманности, и любое
      // другое значение сдвинуло бы уже принятые сцены
      radialMix: 0,
      innerColor: new Color(0x8fd8ff),
      outerColor: new Color(0xb85a3a)
    },
    dust: {
      strength: 0.6,
      threshold: 0.55,
      color: new Color(0x05090c),
      seed: null,
      frequency: 0.9,
      contrast: 1
    },
    lighting: {
      starPosition: null,
      scatterStrength: 0.8,
      // Self-emission baseline: 1.0 keeps the nebula fully visible WITHOUT a star
      // (it is self-emissive). The star's scatter is additive on top. Reflection-type
      // nebulae override this low so they read as star-lit rather than self-lit.
      ambient: 1.0,
      // null и 0 — несущие дефолты: чанк цвета общий на все туманности
      color: null,
      falloffRadius: 0,
      anisotropy: null,
      shadowStrength: 0
    },
    quality: {
      // 64 keeps full-screen interior cost ~33% below 96; dithering hides the
      // extra banding. Raise again once per-step cost drops (3D-texture bake).
      maxSteps: 64,
      lightSteps: 6,
      resolutionScale: 1,
      temporalBlend: 0,
      forceLOD: 'auto',
      // ON by default: the static form bakes to a 3D texture once -> ~12 snoise +
      // Worley per step collapse to 1 trilinear fetch (stable 144 FPS interior).
      bake3DTexture: true,
      bakeResolution: 128
    }
  }
}

export const DEFAULT_NEBULA_PARAMS: NebulaParams = makeDefaultNebulaParams()

export function mergeNebulaParams(
  overrides: DeepPartial<NebulaParams> = {},
  base: NebulaParams = makeDefaultNebulaParams()
): NebulaParams {
  const result = cloneNebulaParams(base)
  const o = overrides as Partial<NebulaParams>

  if (o.seed !== undefined) result.seed = o.seed
  if (o.size !== undefined) result.size = o.size
  if (o.shape !== undefined) result.shape = o.shape
  // Кламп несущий: нулевая толщина делит на ноль в торе, единичная схлопывает
  // оболочку в точку, а отрицательная выворачивает талию песочных часов
  if (o.shapeThickness !== undefined) result.shapeThickness = clamp(o.shapeThickness, 0.02, 0.98)
  if (o.shapeRotation) result.shapeRotation.copy(o.shapeRotation as Vector3)
  if (o.axisRatios) result.axisRatios.copy(o.axisRatios as Vector3)
  if (o.edgeFalloff !== undefined) result.edgeFalloff = o.edgeFalloff
  if (o.density !== undefined) result.density = Math.max(0, o.density)
  const structure = result.structure
  const direction = overrides.structure?.direction
  if (direction) {
    structure.direction.set(
      direction.x ?? structure.direction.x,
      direction.y ?? structure.direction.y,
      direction.z ?? structure.direction.z
    )
  }
  // Scale before normalizing: Vector3.length() squares components and can
  // overflow/underflow even when every supplied component is finite/nonzero.
  const axis = structure.direction
  const largest = Math.max(Math.abs(axis.x), Math.abs(axis.y), Math.abs(axis.z))
  if (axis.toArray().every(Number.isFinite) && largest > 0) axis.set(axis.x / largest, axis.y / largest, axis.z / largest).normalize()
  else axis.set(0, 1, 0)
  if (overrides.structure?.stretch !== undefined) structure.stretch = overrides.structure.stretch
  structure.stretch = Number.isFinite(structure.stretch) ? clamp(structure.stretch, 1, 16) : 1
  // Clone + default-fill so callers can't (a) leave the override array aliased to
  // params (mutation hazard) or (b) pass a partial lobe/cavity that writes NaN into
  // a uniform (missing weight/seed/strength).
  if (o.lobes) {
    result.lobes = (o.lobes as Array<Partial<NebulaLobe>>).map((l) => ({
      center: l.center ? (l.center as Vector3).clone() : new Vector3(),
      radius: l.radius ?? 0.3,
      weight: l.weight ?? 1,
      seed: l.seed ?? 0
    }))
  }
  if (o.cavities) {
    result.cavities = (o.cavities as Array<Partial<NebulaCavity>>).map((c) => ({
      center: c.center ? (c.center as Vector3).clone() : new Vector3(),
      radius: c.radius ?? 0.3,
      strength: c.strength ?? 1
    }))
  }

  Object.assign(result.noise, overrides.noise)
  result.noise.boundaryWarp = clamp(result.noise.boundaryWarp, 0, 1)
  if (overrides.palette) {
    if (overrides.palette.stops)
      result.palette.stops = (overrides.palette.stops as Array<Partial<ColorStop>>).map((s) => ({
        t: s.t ?? 0,
        color: s.color ? (s.color as Color).clone() : new Color(0xffffff)
      }))
    if (overrides.palette.secondary) result.palette.secondary.copy(overrides.palette.secondary as Color)
    if (overrides.palette.secondaryThreshold !== undefined)
      result.palette.secondaryThreshold = overrides.palette.secondaryThreshold
    if (overrides.palette.emissiveIntensity !== undefined)
      result.palette.emissiveIntensity = overrides.palette.emissiveIntensity
    // Кламп несущий: смешивание вне [0, 1] экстраполирует за оба тона и уводит
    // каналы в отрицательные значения
    if (overrides.palette.radialMix !== undefined)
      result.palette.radialMix = clamp(overrides.palette.radialMix, 0, 1)
    if (overrides.palette.innerColor) result.palette.innerColor.copy(overrides.palette.innerColor as Color)
    if (overrides.palette.outerColor) result.palette.outerColor.copy(overrides.palette.outerColor as Color)
  }
  if (overrides.gas?.absorption !== undefined) result.gas.absorption = overrides.gas.absorption
  if (overrides.dust) {
    if (overrides.dust.strength !== undefined) result.dust.strength = overrides.dust.strength
    if (overrides.dust.threshold !== undefined) result.dust.threshold = overrides.dust.threshold
    if (overrides.dust.color) result.dust.color.copy(overrides.dust.color as Color)
    if (overrides.dust.seed !== undefined) result.dust.seed = overrides.dust.seed
    if (overrides.dust.frequency !== undefined) result.dust.frequency = overrides.dust.frequency
    if (overrides.dust.contrast !== undefined) result.dust.contrast = overrides.dust.contrast
  }
  // Non-finite controls must never reach noise coordinates or optical integration.
  result.gas.absorption = Number.isFinite(result.gas.absorption) ? Math.max(0, result.gas.absorption) : 1
  result.dust.strength = Number.isFinite(result.dust.strength) ? Math.max(0, result.dust.strength) : 0.6
  result.dust.threshold = Number.isFinite(result.dust.threshold) ? clamp(result.dust.threshold, 0, 1) : 0.55
  result.dust.frequency = Number.isFinite(result.dust.frequency) ? clamp(result.dust.frequency, 0.01, 32) : 0.9
  result.dust.contrast = Number.isFinite(result.dust.contrast) ? clamp(result.dust.contrast, 0.1, 8) : 1
  result.dust.seed = result.dust.seed !== null && Number.isFinite(result.dust.seed) ? Math.round(result.dust.seed) : null
  if (overrides.lighting) {
    if (overrides.lighting.starPosition !== undefined)
      result.lighting.starPosition = overrides.lighting.starPosition
        ? (overrides.lighting.starPosition as Vector3).clone()
        : null
    if (overrides.lighting.scatterStrength !== undefined)
      result.lighting.scatterStrength = overrides.lighting.scatterStrength
    if (overrides.lighting.ambient !== undefined) result.lighting.ambient = overrides.lighting.ambient
    if (overrides.lighting.color !== undefined)
      result.lighting.color = overrides.lighting.color ? (overrides.lighting.color as Color).clone() : null
    if (overrides.lighting.falloffRadius !== undefined)
      result.lighting.falloffRadius = Math.max(overrides.lighting.falloffRadius, 0)
    if (overrides.lighting.anisotropy !== undefined) result.lighting.anisotropy = overrides.lighting.anisotropy
    if (overrides.lighting.shadowStrength !== undefined) result.lighting.shadowStrength = overrides.lighting.shadowStrength
  }
  const g = result.lighting.anisotropy
  result.lighting.anisotropy = g !== null && Number.isFinite(g) ? clamp(g, -0.9, 0.9) : null
  result.lighting.shadowStrength = Number.isFinite(result.lighting.shadowStrength) ? clamp(result.lighting.shadowStrength, 0, 1) : 0
  Object.assign(result.quality, overrides.quality)

  result.quality.lightSteps = Number.isFinite(result.quality.lightSteps) ? clamp(Math.round(result.quality.lightSteps), 1, 16) : 6
  result.quality.resolutionScale = Number.isFinite(result.quality.resolutionScale) ? clamp(result.quality.resolutionScale, 0.25, 1) : 1
  result.quality.temporalBlend = Number.isFinite(result.quality.temporalBlend) ? clamp(result.quality.temporalBlend, 0, 0.95) : 0
  result.quality.bakeResolution = clamp(Math.round(result.quality.bakeResolution), 64, 256)
  result.quality.maxSteps = clamp(Math.round(result.quality.maxSteps), 8, 256)

  return result
}
