import { Color, Vector3 } from 'three'

export const NUM_STARS: number = 100000
export const GALAXY_MEAN_RADIUS: number = 600
export const GALAXY_THICKNESS: number = 5

export const CORE_X_DIST: number = 33
export const CORE_Y_DIST: number = 33

export const OUTER_CORE_X_DIST: number = 200
export const OUTER_CORE_Y_DIST: number = 200

export const ARM_X_DIST: number = 100
export const ARM_Y_DIST: number = 50
export const ARM_X_MEAN: number = 200
export const ARM_Y_MEAN: number = 100

export const HAZE_COLOR_CENTER: Color = new Color(0xffd192)
export const HAZE_COLOR_MID: Color = new Color(0xdeb182)
export const HAZE_COLOR_EDGE: Color = new Color(0x7fbfff)
export const HAZE_THICKNESS: number = 5000
export const HAZE_MAX: number = 70
export const HAZE_MIN: number = 40
export const HAZE_OPACITY: number = 0.05
export const HAZE_RATIO: number = 0.4

export const SPIRAL: number = 2
export const ARMS: number = 3

export const spectralColors: number[] = [
  0xfbf8ff, 0xc8d5ff, 0xd8e2ff, 0xe6ecfc, 0xfbf8ff, 0xfff4e8, 0xffeeda, 0xfeead3, 0xfccecb, 0xebd3da, 0xe7dbf3
]

export function gaussianRandom(mean: number = 0, stdev: number = 0): number {
  const u: number = 1 - Math.random()
  const v: number = Math.random()
  const z: number = Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v)

  return z * stdev + mean
}

export function spiral(x: number, y: number, z: number, offset: number): Vector3 {
  const r: number = Math.sqrt(x ** 2 + y ** 2)
  let theta: number = offset

  theta += x > 0 ? Math.atan(y / x) : Math.atan(y / x) + Math.PI
  theta += (r / ARM_X_DIST) * SPIRAL

  return new Vector3(r * Math.cos(theta), r * Math.sin(theta), z)
}

export function generateInnerCore(count: number): Vector3[] {
  const points: Vector3[] = []

  for (let i: number = 0; i < count / 4; i++) {
    const point: Vector3 = new Vector3(
      gaussianRandom(0, CORE_X_DIST),
      gaussianRandom(0, CORE_Y_DIST),
      gaussianRandom(0, GALAXY_THICKNESS)
    )

    points.push(point)
  }

  return points
}

export function generateOuterCore(count: number): Vector3[] {
  const points: Vector3[] = []

  for (let i: number = 0; i < count / 4; i++) {
    const point: Vector3 = new Vector3(
      gaussianRandom(0, OUTER_CORE_X_DIST),
      gaussianRandom(0, OUTER_CORE_Y_DIST),
      gaussianRandom(0, GALAXY_THICKNESS)
    )

    points.push(point)
  }

  return points
}

export function generateArms(count: number): Vector3[] {
  const points: Vector3[] = []

  for (let i: number = 0; i < ARMS; i++) {
    for (let j: number = 0; j < count; j++) {
      const point: Vector3 = spiral(
        gaussianRandom(ARM_X_MEAN, ARM_X_DIST),
        gaussianRandom(ARM_Y_MEAN, ARM_Y_DIST),
        gaussianRandom(0, GALAXY_THICKNESS),
        (j * 2 * Math.PI) / ARMS
      )

      points.push(point)
    }
  }

  return points
}
