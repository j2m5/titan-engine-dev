import { IUniform, Uniform, Vector3, Vector4 } from 'three'
import { MAX_OCCLUDERS } from '@/core/eclipse/eclipseMath'

/** Данные затмения для шейдера: центры тел и звезда — относительно центра получателя, в одной системе и единицах. */
export interface EclipseUniformData {
  count: number
  /** xyz — центр, w — радиус; длина MAX_OCCLUDERS */
  occluders: Vector4[]
  star: Vector3
  starRadius: number
  /** rgb — нормированный цвет умбры, a — сила (0 — чёрная); длина MAX_OCCLUDERS */
  umbra: Vector4[]
}

export function emptyEclipseData(): EclipseUniformData {
  return {
    count: 0,
    occluders: Array.from({ length: MAX_OCCLUDERS }, () => new Vector4()),
    star: new Vector3(),
    starRadius: 0,
    umbra: Array.from({ length: MAX_OCCLUDERS }, () => new Vector4())
  }
}

export type EclipseUniformName = 'uEclipseCount' | 'uEclipseOccluders' | 'uEclipseStar' | 'uEclipseStarRadius' | 'uEclipseUmbra'

/** Юниформы чанка eclipseHostFunctions; без затмений — count 0. */
export function createEclipseUniforms(): Record<EclipseUniformName, Uniform> {
  const d = emptyEclipseData()
  return {
    uEclipseCount: new Uniform(0),
    uEclipseOccluders: new Uniform(d.occluders),
    uEclipseStar: new Uniform(d.star),
    uEclipseStarRadius: new Uniform(0),
    uEclipseUmbra: new Uniform(d.umbra)
  }
}

/** Копирует данные в юниформы материала (объекты векторов не подменяются). */
export function applyEclipseUniforms(uniforms: Record<string, IUniform>, data: EclipseUniformData): void {
  uniforms.uEclipseCount.value = Math.min(data.count, MAX_OCCLUDERS)
  const occ = uniforms.uEclipseOccluders.value as Vector4[]
  const umbra = uniforms.uEclipseUmbra.value as Vector4[]
  for (let i = 0; i < MAX_OCCLUDERS; i++) {
    occ[i].copy(data.occluders[i])
    umbra[i].copy(data.umbra[i])
  }
  ;(uniforms.uEclipseStar.value as Vector3).copy(data.star)
  uniforms.uEclipseStarRadius.value = data.starRadius
}
