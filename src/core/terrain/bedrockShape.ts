/** Shared shape constants: CPU geometry/bounds and the fragment material mask. */
export const BEDROCK_SHAPE = {
  riserStart: 0.3,
  riserWidth: 0.4,
  footStart: 0.08,
  footWidth: 0.34,
  footWeight: 0.2,
  wallStart: 0.4025,
  wallWidth: 0.32,
  warpPeriod: 10000,
  warpRatio: 1.618,
  warpA: 0.18,
  warpB: 0.11,
  jointPeriod: 3000,
  jointRatio: 1.37,
  jointA: 0.09,
  jointB: 0.045,
  jointRound: 0.1
} as const

const S = BEDROCK_SHAPE
const smooth = (start: number, width: number, p: number): number => {
  const t = Math.max(0, Math.min(1, (p - start) / width))
  return t * t * (3 - 2 * t)
}
const derivative = (start: number, width: number, p: number): number => {
  const t = Math.max(0, Math.min(1, (p - start) / width))
  return (6 * t * (1 - t)) / width
}

/** C1, periodic, zero mean. Weighted riser centers stay at phase .5, conserving the mean height. */
export function bedrockProfile(phase: number, weathering = 0): number {
  const p = phase - Math.floor(phase)
  const old = smooth(S.riserStart, S.riserWidth, p)
  if (weathering === 0) return old - p
  const weathered =
    S.footWeight * smooth(S.footStart, S.footWidth, p) + (1 - S.footWeight) * smooth(S.wallStart, S.wallWidth, p)
  return old + weathering * (weathered - old) - p
}

export function bedrockProfileDerivative(phase: number, weathering = 0): number {
  const p = phase - Math.floor(phase)
  const old = derivative(S.riserStart, S.riserWidth, p)
  if (weathering === 0) return old - 1
  const weathered =
    S.footWeight * derivative(S.footStart, S.footWidth, p) +
    (1 - S.footWeight) * derivative(S.wallStart, S.wallWidth, p)
  return old + weathering * (weathered - old) - 1
}

// Sum of maxima is conservative even in the small overlap of foot and wall.
export const bedrockProfileLipschitz = (w: number): number =>
  (1 - w) * (1.5 / S.riserWidth - 1) + w * (1.5 * (S.footWeight / S.footWidth + (1 - S.footWeight) / S.wallWidth) - 1)

const riserCurvature = (phase: number, delta: number, start: number, width: number): number => {
  if (2 * delta >= 1) return 6 / width ** 2
  let curvature = 0
  for (let cycle = Math.floor(phase - delta); cycle <= Math.floor(phase + delta); cycle++) {
    const lo = Math.max(0, (phase - delta - cycle - start) / width)
    const hi = Math.min(1, (phase + delta - cycle - start) / width)
    if (lo <= hi)
      curvature = Math.max(curvature, Math.abs(6 - 12 * lo) / width ** 2, Math.abs(6 - 12 * hi) / width ** 2)
  }
  return curvature
}

export function bedrockProfileCurvature(phase: number, delta: number, weathering: number): number {
  return (
    (1 - weathering) * riserCurvature(phase, delta, S.riserStart, S.riserWidth) +
    weathering *
      (S.footWeight * riserCurvature(phase, delta, S.footStart, S.footWidth) +
        (1 - S.footWeight) * riserCurvature(phase, delta, S.wallStart, S.wallWidth))
  )
}

/** Angular joints, rounded only at their corners: |value| <= 1, |d| <= 4, |d2| <= 4/round. */
export function bedrockJoint(phase: number): number {
  const a = Math.abs(phase - Math.floor(phase) - 0.5),
    e = S.jointRound
  if (a < e) return 1 - 2 * e - (2 * a * a) / e
  if (a > 0.5 - e) return -1 + 2 * e + (2 * (0.5 - a) ** 2) / e
  return 1 - 4 * a
}

export function bedrockJointDerivative(phase: number): number {
  const p = phase - Math.floor(phase) - 0.5,
    a = Math.abs(p),
    e = S.jointRound
  const slope = a < e ? (-4 * a) / e : a > 0.5 - e ? (-4 * (0.5 - a)) / e : -4
  return Math.sign(p) * slope
}

export function bedrockPhaseWarp(x: number, y: number, z: number, radius: number, weathering: number): number {
  const k = (2 * Math.PI * radius) / S.warpPeriod
  const warp =
    S.warpA * Math.sin(k * (0.8 * x + 0.48 * y - 0.36 * z)) +
    S.warpB * Math.sin(k * S.warpRatio * (-0.6 * x + 0.8 * y) + 2.7)
  if (weathering === 0) return warp
  const j = radius / S.jointPeriod
  return (
    warp +
    weathering *
      (S.jointA * bedrockJoint(j * (0.36 * x - 0.48 * y + 0.8 * z)) +
        S.jointB * bedrockJoint(j * S.jointRatio * (-0.8 * x - 0.6 * y) + 0.41))
  )
}
