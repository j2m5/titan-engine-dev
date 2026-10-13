export type CloudMapRef = { resourceId: number }
export type ScalarDecode = {
  channel: 'r' | 'g' | 'b' | 'a' | 'luminance'
  inputRange: [number, number]
  exponent: number
  invert: boolean
  sampleSpace: 'encoded' | 'linear'
}
export type CloudPattern =
  | { kind: 'uniform'; coverage: number }
  | { kind: 'procedural'; coverage: number; scaleMeters: number; bandStrength: number }
  | { kind: 'mask'; map: CloudMapRef; decode: ScalarDecode }
  | { kind: 'appearance'; map: CloudMapRef; decode: ScalarDecode; coverageRange: [number, number] }
export type CloudColor =
  | { kind: 'constant'; srgb: [number, number, number] }
  | { kind: 'map'; map: CloudMapRef; strength: number }
export type CloudLayerConfig = {
  id: string
  baseAltitudeMeters: number
  thicknessMeters: number
  extinctionPerMeter: number
  pattern: CloudPattern
  color: CloudColor
  detail: { seed: number; shapeScaleMeters: number; erosionScaleMeters: number; erosionStrength: number }
  castsShadow: boolean
}
export type CloudConfig =
  | { enabled: false }
  | {
      enabled: true
      farAppearance: 'base-texture' | 'separate-layer'
      mapping: { frame: 'planet-fixed'; projection: 'equirectangular'; longitudeOffsetRadians: number }
      lod: { fullDistanceMeters: number; cutoffDistanceMeters: number }
      layers: CloudLayerConfig[]
    }
export type EnabledCloudConfig = Extract<CloudConfig, { enabled: true }>
export type CloudConfigIssue = { path: string; message: string }
export type CloudConfigResult =
  | { state: 'legacy' }
  | { state: 'off' }
  | { state: 'configured'; config: EnabledCloudConfig }
  | { state: 'invalid'; issues: CloudConfigIssue[] }
