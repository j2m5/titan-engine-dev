import { fromAstronomicalUnits } from '@/core/helpers/scaling'
import { WebGLRendererParameters } from 'three'
import { height, width } from '@/core/constants/resolution'
import {
  Actors,
  Categories,
  Orbits,
  PhysicalObjects,
  Placements,
  RenderingObjects,
  Resources,
  RotationObjects
} from '@storage/database'

export type TAppConfig = {
  RendererParameters: WebGLRendererParameters
  PerspectiveCameraParameters: PerspectiveCameraParameters
  DefaultCameraPosition: [number, number, number]
}

export type TAppData = {
  db: Map<string, unknown>
  entities: string[]
}

export type PerspectiveCameraParameters = {
  fov: number
  aspect: number
  near: number
  far: number
}

export const AppConfig: TAppConfig = {
  RendererParameters: {
    logarithmicDepthBuffer: true,
    antialias: false
  },
  PerspectiveCameraParameters: {
    fov: 50,
    aspect: width / height,
    near: 0.000001,
    far: fromAstronomicalUnits(2000)
  },
  DefaultCameraPosition: [0, 0, fromAstronomicalUnits(0.01)]
}

const db: Map<string, unknown> = new Map()
db.set('categories', Categories)
db.set('actors', Actors)
db.set('physicalObjects', PhysicalObjects)
db.set('renderingObjects', RenderingObjects)
db.set('orbits', Orbits)
db.set('rotationObjects', RotationObjects)
db.set('placements', Placements)
db.set('resources', Resources)

export const AppData: TAppData = {
  db,
  entities: []
}

export function getData<TData>(table: string): TData[] {
  return AppData.db.get(table) as TData[]
}
