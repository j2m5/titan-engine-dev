import type {
  ColorSpace,
  MagnificationTextureFilter,
  Mapping,
  MinificationTextureFilter,
  PixelFormat,
  TextureDataType,
  Wrapping
} from 'three'
import { AtmosphereConfig } from '@/core/renderables/Atmosphere/AtmosphereConfig'

export type ValueOf<T> = T[keyof T]

export enum AllowedCategories {
  barycenter,
  blackHole,
  star,
  planet,
  atmosphere,
  ring
}

export type AllowedCategory = keyof typeof AllowedCategories

export enum ResourceLifecycles {
  resident,
  streamable
}

export type ResourceLifecycle = keyof typeof ResourceLifecycles

export enum ResourceTypes {
  diffuse,
  bump,
  cloud,
  night,
  specular,
  cube
}

export type ResourceType = keyof typeof ResourceTypes

export type ResourceParameters = {
  mapping?: Mapping
  wrapS?: Wrapping
  wrapT?: Wrapping
  magFilter?: MagnificationTextureFilter
  minFilter?: MinificationTextureFilter
  format?: PixelFormat
  type?: TextureDataType
  anisotropy?: number
  colorSpace?: ColorSpace
}

export interface ICategory {
  readonly id: number
  readonly alias: AllowedCategory
  name: string
}

export interface IActor {
  readonly id: number
  readonly categoryId: number | AllowedCategory
  readonly parentId: number | null
  name: string
  description: string
  color: string
}

export interface IOrbit {
  readonly id: number
  readonly actorId: number
  semiMajorAxis: number
  eccentricity: number
  inclination: number
  argOfPeriapsis: number
  ascendingNode: number
  meanAnomalyAtEpoch: number
  /** Эпоха оскулирующих элементов — юлианская дата (сутки), на которую снята meanAnomalyAtEpoch */
  epoch: number
  /**
   * Явный сидерический период обращения, сутки; 0 = вывести из гравитационного
   * параметра. Обязателен для барицентрических подорбит (масса родителя-барицентра
   * не даёт корректного среднего движения)
   */
  period: number
}

export interface IRotationObject {
  readonly id: number
  readonly actorId: number
  meridianAngle: number
  ascendingNode: number
  inclination: number
  period: number
  direction?: 1 | -1
}

export interface IPhysicalObject {
  readonly id: number
  readonly actorId: number
  readonly parentId: number | null
  mass: number
  radius: number
  axialTilt: number
  orbitalPeriod: number
  rotationPeriod: number
  temperature: number
}

export interface IRenderingObject<T extends string = string, U = any> {
  readonly id: number
  readonly actorId: number
  data: Record<T, U>
}

export interface IPlacement {
  readonly id: number
  readonly actorId: number
  x: number
  y: number
  z: number
}

export interface IResource extends ResourceParameters {
  readonly id: number
  readonly resourceType: ResourceType
  readonly lifecycle: ResourceLifecycle
  readonly lifetime: number
  readonly path: string
}

export interface IActorResource {
  readonly id: number
  readonly actorId: number
  readonly resourceId: number
}

export interface IPlanetRenderingObject {
  emission: number
  bumpScale: number
}

export interface IAtmosphereRenderingObject extends AtmosphereConfig {}

export interface IRingRenderingObject {
  innerRadius: number
  outerRadius: number
  alphaTest: number
  countParticles: number
}

export type Colorable = {
  r: number
  g: number
  b: number
}

export type TKeplerianModel = Omit<IOrbit, 'id' | 'actorId'>

export type TOrientationModel = Omit<IRotationObject, 'id' | 'actorId'>
