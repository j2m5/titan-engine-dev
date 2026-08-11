import { Color, Vector3 } from 'three'
import { degToRad } from 'three/src/math/MathUtils'
import { fromAstronomicalUnits } from '@/core/helpers/scaling'
import { DeepPartial, NebulaParams, NebulaShape, mergeNebulaParams } from '@/core/renderables/Nebula/NebulaParams'
import { makeNebulaParams } from '@/core/renderables/Nebula/presets'

/**
 * JSON-зеркало NebulaParams для слоя данных (renderingObject.data).
 *
 * Зачем отдельный тип: NebulaParams держит Vector3 и Color, а data —
 * чистый JSON (его сериализует генератор таблиц). Здесь Vector3 записан
 * тройкой, Color — hex-строкой, как actor.color и dustColor у кольца.
 *
 * Именование повторяет прецедент атмосферы: сам тип живёт рядом со своим
 * рендерблом, а модельный алиас (INebulaRenderingObject) заводится в
 * core/models/types.ts.
 */

export type NebulaTriple = [number, number, number]

export type NebulaPreset = 'emission' | 'reflection' | 'dark'

export interface NebulaRenderingData {
  preset?: NebulaPreset
  seed?: number
  /** Полуразмер облака в АСТРОНОМИЧЕСКИХ ЕДИНИЦАХ (в NebulaParams — уже Three-юниты) */
  size?: number
  shape?: NebulaShape
  /** Толщина формы; смысл зависит от формы — см. NebulaParams.shapeThickness */
  shapeThickness?: number
  /** Поворот формы, эйлеровы углы XYZ в ГРАДУСАХ (в NebulaParams — уже радианы) */
  shapeRotation?: NebulaTriple
  axisRatios?: NebulaTriple
  edgeFalloff?: number
  density?: number
  lobes?: Array<{ center?: NebulaTriple; radius?: number; weight?: number; seed?: number }>
  cavities?: Array<{ center?: NebulaTriple; radius?: number; strength?: number }>
  noise?: Partial<NebulaParams['noise']>
  palette?: {
    stops?: Array<{ t: number; color: string }>
    secondary?: string
    secondaryThreshold?: number
    emissiveIntensity?: number
    /** Доля радиального тона; 0 — цвет ведёт одна плотность (см. NebulaParams) */
    radialMix?: number
    innerColor?: string
    outerColor?: string
  }
  dust?: { strength?: number; threshold?: number; color?: string }
  lighting?: {
    /** Мировая точка источника; фиксируется при конструировании и за звездой не следит */
    starPosition?: NebulaTriple | null
    scatterStrength?: number
    ambient?: number
  }
  quality?: Partial<NebulaParams['quality']>
}

function toVector(triple: NebulaTriple | undefined): Vector3 | undefined {
  return triple ? new Vector3(triple[0], triple[1], triple[2]) : undefined
}

/**
 * Единственное место встречи JSON с three-типами.
 *
 * Порядок слоёв: дефолты движка -> preset -> поля data. Обе склейки делает
 * mergeNebulaParams, поэтому клампы (maxSteps, resolutionScale,
 * bakeResolution) и добор недостающих полей у lobes/cavities достаются
 * бесплатно и обойти их из данных нельзя.
 */
export function nebulaParamsFromData(data: NebulaRenderingData): NebulaParams {
  const overrides: DeepPartial<NebulaParams> = {}

  if (data.seed !== undefined) overrides.seed = data.seed
  if (data.size !== undefined) overrides.size = fromAstronomicalUnits(data.size)
  if (data.shape !== undefined) overrides.shape = data.shape
  if (data.shapeThickness !== undefined) overrides.shapeThickness = data.shapeThickness
  // Градусы в данных, радианы в параметрах — как у всех углов в базе
  if (data.shapeRotation)
    overrides.shapeRotation = new Vector3(
      degToRad(data.shapeRotation[0]),
      degToRad(data.shapeRotation[1]),
      degToRad(data.shapeRotation[2])
    )
  if (data.axisRatios) overrides.axisRatios = toVector(data.axisRatios)
  if (data.edgeFalloff !== undefined) overrides.edgeFalloff = data.edgeFalloff
  if (data.density !== undefined) overrides.density = data.density

  if (data.lobes) {
    overrides.lobes = data.lobes.map((lobe) => ({
      center: toVector(lobe.center),
      radius: lobe.radius,
      weight: lobe.weight,
      seed: lobe.seed
    }))
  }

  if (data.cavities) {
    overrides.cavities = data.cavities.map((cavity) => ({
      center: toVector(cavity.center),
      radius: cavity.radius,
      strength: cavity.strength
    }))
  }

  if (data.noise) overrides.noise = { ...data.noise }
  if (data.quality) overrides.quality = { ...data.quality }

  if (data.palette) {
    overrides.palette = {
      stops: data.palette.stops?.map((stop) => ({ t: stop.t, color: new Color(stop.color) })),
      secondary: data.palette.secondary ? new Color(data.palette.secondary) : undefined,
      secondaryThreshold: data.palette.secondaryThreshold,
      emissiveIntensity: data.palette.emissiveIntensity,
      radialMix: data.palette.radialMix,
      innerColor: data.palette.innerColor ? new Color(data.palette.innerColor) : undefined,
      outerColor: data.palette.outerColor ? new Color(data.palette.outerColor) : undefined
    }
  }

  if (data.dust) {
    overrides.dust = {
      strength: data.dust.strength,
      threshold: data.dust.threshold,
      color: data.dust.color ? new Color(data.dust.color) : undefined
    }
  }

  if (data.lighting) {
    overrides.lighting = {
      starPosition: data.lighting.starPosition ? toVector(data.lighting.starPosition) : data.lighting.starPosition,
      scatterStrength: data.lighting.scatterStrength,
      ambient: data.lighting.ambient
    }
  }

  return data.preset ? makeNebulaParams(data.preset, overrides) : mergeNebulaParams(overrides)
}
